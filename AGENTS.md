# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

| Command | Description |
|---------|-------------|
| `bun run dev` | Start Vite dev server (frontend only, port 1420) |
| `bun run build` | TypeScript check (`tsc`) + Vite production build |
| `bun run lint` | ESLint on `src/**/*.{ts,tsx,js,jsx}` |
| `bun run tauri dev` | Full Tauri dev mode (Rust build + Vite + native window) |
| `bun run tauri build` | Tauri production build |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | Run Rust protocol regression tests |
| `bun test src/lib/telemetry-history.test.ts` | Run chunked-history range/snapshot/pruning boundary tests |

Package manager is **bun** (not npm/yarn/pnpm). Rust protocol regression tests cover configuration parsing, calibration reports, state/parameter boundaries, command acknowledgements, telemetry frames, and stream/ack isolation. Pure history boundary tests use Bun with Node's test/assert APIs; there is no frontend UI test suite.

## 工作流程

- 变更的需求需要即时更新到 CLAUDE.md，确保文档与代码保持一致。
- 在开发中合适的时间进行 git 提交，保持每次提交的粒度合理、可回溯。

## Architecture

**ipmesctool** is a Tauri v2 desktop app for configuring and debugging BLDC motor controllers over serial port.

### Two-process architecture

- **Rust backend** (`src-tauri/`) — serial communication, command parsing, motor state machine. Runs on tokio async runtime.
- **React frontend** (`src/`) — UI for PID configuration, encoder setup, calibration, control commands, serial console, and waveform plots.

The frontend calls Rust via Tauri's `invoke()` mechanism. Each `#[tauri::command]` in `src-tauri/src/invokes.rs` maps to a frontend `invoke()` call. Rust pushes serial lines, motor state changes, calibration progress, telemetry mode, and batched waveform samples via Tauri's event emitter (`app.emit()`); the frontend subscribes with `listen()` from `@tauri-apps/api/event`.

### Rust backend structure (`src-tauri/src/`)

| File | Purpose |
|------|---------|
| `main.rs` | Entry point, calls `lib::run()` |
| `lib.rs` | Tauri builder setup: registers plugins, initializes `AppState`, starts serial port monitor, registers all invoke handlers |
| `invokes.rs` | Motor `#[tauri::command]` handlers — the API surface between frontend and backend. Manages `AppState` (global motor + app handle) |
| `serial.rs` | `SerialDevice` — tokio-serial wrapper. Splits LF/CRLF lines; ordinary responses use `tokio::sync::broadcast`, telemetry uses a separate bounded queue with receive timestamps |
| `motor.rs` | `Motor` — serializes command/reply transactions and no-ack stream controls, maintains state/configuration, and emits console, calibration, and batched telemetry events |
| `command.rs` | Command enums (`MotorRunCommand`, `MotorConfigCommand`, `MotorCalibrationCommand`) — each serial command knows what motor states it's valid in |
| `config_parser.rs` | `ConfigParser` — parses GPMD_Code's nine space-separated configuration rows and their `key=value` fields |
| `calibration_parser.rs` | `CalibrationParser` — tracks separator-delimited asynchronous calibration reports and preserves results/failure stages |
| `telemetry.rs` | Stream modes, exact `get_*` command mapping, and strict finite-number parsing of `iabc`/`idq`/`speed`/`position` frames |
| `telemetry_export.rs` | Native CSV save dialog and file write; accepts content and a suggested filename, never a frontend-supplied destination path |
| `error.rs` | `MotorError` enum (uses `thiserror`) |
| `exit_signal.rs` | `ExitSignal` — a `tokio::sync::watch`-based signal for cleanly stopping async loops |

**Key backend patterns:**
- Firmware reference: GPMD_Code `APP/uart_com.cpp`. Commands are CRLF-terminated; synchronous replies end with `ok` or `error <reason>`.
- Every ordinary request uses the same request lock and subscribes before sending. An `ok` is required before reporting ordinary command success; firmware errors are propagated. Timeout or ordinary-response broadcast lag closes the port to prevent a late acknowledgement from being assigned to a later command. Stream selection uses the same lock but must not wait for an acknowledgement.
- Firmware states are `Initialization`, `Calibration`, `CurrentControl`, `SpeedControl`, `PositionControl`, `Ready`, and `Fault`; `Unknown` is never assumed runnable. Configuration and calibration require `Ready`; control/stop allow `Ready` and the three control modes; `clear_fault` requires `Fault`.
- `get_config` reads `state`, uint32 `id`, `protection` (`current_limit`, A), `motor` (`rs`, `ld`, `lq`), `current_pi`, `speed_pi`, `speed_sweep` (`iq_amplitude`, A), `position_pid`, and `encoder`, then waits for the final acknowledgement. All nine rows are required; missing or malformed configuration is an error, not a partial success.
- Configuration setters persist to Flash themselves; there is no `save` command or unsaved flag. `config_id` writes only 0–2047 (the firmware's standard FDCAN ID limit), although the wire field is uint32. `config_current_pi <d_kp> <d_ki> <q_kp> <q_ki>` writes independent d/q gains; all four must be finite and strictly positive. `config_speed_sweep_current <A>` sets the calibration speed-loop identification sine q-axis amplitude. `config_current_limit <A>` sets the absolute per-phase overcurrent protection threshold: exceeding it triggers Fault, not soft command clipping. Sweep amplitude and protection threshold must each be finite and greater than zero; firmware imposes no relation between them. The changed raw-console commands share typed Ready/validation/ack/readback handling.
- Speed commands use mechanical rpm, position commands use accumulated mechanical degrees, and current commands use q-axis amperes. UI rad/s and radians are converted before invoking the backend.
- Encoder writes accept pole pairs 1–255, direction `CW`/`CCW`, offset in electrical radians, and `AS5600`, `MT6701_IIC`, `MT6701_SPI`, or `AS5047P`. Unconfigured `None`/`Unknown` readback is displayed but cannot be written.
- Calibration's initial `ok` only acknowledges startup. Its asynchronous `calibration_status`/`stage`/`result`/`failed_stage` blocks finish at the closing separator of a success/failure report. Failures preserve the reported motor state; successful calibration requests automatic saving in the firmware main loop (there is no separate Flash acknowledgement).
- UART supports mutually exclusive `get_iabc`, `get_idq`, `get_speed`, `get_position`, and `get_none` streams. These commands never return `ok`; `set_telemetry_mode` and raw console report host write completion only. Initialization sends `get_none` before `get_config`; disconnect best-effort sends `get_none` before closing. Mode selection does not change motor state.
- Stream frames are `iabc:a,b,c` (A), `idq:d,q` (A), `speed:reference,feedback` (mechanical rpm), and `position:reference,feedback` (accumulated mechanical degrees). Valid and malformed stream-prefixed lines stay out of the ordinary-response broadcast. A 256-sample queue drops oldest samples on overflow; `telemetry-samples` emits batches about every 33 ms as `{sessionId,samples}`, with each sample `{mode,time,values,raw}`. `time` is monotonic host receive seconds since connection, not device sample time. Each Motor has an immutable, monotonically allocated string session ID: `get_telemetry_state` and `telemetry-mode` use `{sessionId,mode}`, and `motor-disconnected` uses `{sessionId}`. Stream data is not also emitted as `serial-received`.
- UART has no bus-voltage/filter setters or motor-electrical-parameter setters. Manual-save paths remain removed. The raw console sends one command per request, using the same acknowledgement/state rules except for the explicit no-ack stream commands.

### Frontend structure (`src/`)

| Directory | Purpose |
|-----------|---------|
| `pages/` | 6 pages: device-info, pid-config, encoder-config, calibration, serial-console, plot. Lazy-loaded via `React.lazy()` |
| `components/` | App shell (sidebar, device connector, motor state indicator, control console) + shadcn/ui primitives under `ui/` |
| `stores/` | Jotai atoms for global state |
| `lib/` | `cn()` utility, unit conversions, chunked telemetry history, and original-unit CSV generation/native export |
| `motor.ts` | Zod schemas mirroring Rust's `MotorConfig` struct |

**Key frontend patterns:**
- **State management**: Jotai atoms. `pageAtom` drives which page is visible. Pages are *persistent* — they render once and stay mounted, hidden via `display: none`. This preserves editing state across page switches; device disconnection clears configuration/state and configuration drafts. The PID page edits position PID, speed PI, and four independent d/q current PI gains (protected by an unlock confirmation). Calibration owns the speed-sweep identification current under 校准参数; device information owns the absolute phase-current threshold under 电流保护. Each changed setting is Ready-only and reads confirmed configuration after saving; new configuration reseeds drafts, and reconnect relocks current PI.
- **UI framework**: shadcn/ui (new-york style) with Tailwind CSS v4. Component aliases use `@/` prefix mapped to `src/`.
- **Protocol data**: `motorConfigSchema` validates configuration at the frontend boundary. Global atoms hold configuration/connection/state; serial, motor, calibration, and telemetry events update the relevant UI. App mounts `useTelemetry()` once, independent of persistent page visibility. Histories retain full-resolution samples by host receive time, default 300 seconds with 60/300/600/900-second choices; the newest received time trims all sources. `TelemetryHistory` uses 512-point blocks, binary-search window reads, and copy-on-write snapshots instead of copying all retained points on each batch. The serial console retains 5000 lines; telemetry raw lines are appended from the same sample batch. Disconnect clears mode but retains history and rejects disconnected samples. A new connection clears history and queries its native session ID before accepting matching events; old-session mode/sample/disconnect events are ignored. `useTelemetry` is the sole disconnect-event consumer; Device mirrors the connected-to-disconnected transition to clear configuration and release the native Motor.
- **Waveform UI**: `Debug.Plot` uses uPlot with four flat source buttons (single-click switch while acquiring, selection only while stopped), separate acquisition start/stop, 1/5/10-second display windows, fixed-snapshot pause/history scrolling, and clear-all. Only the visible window is converted for rendering. Stopping acquisition sends `get_none`, not motor `stop`. Speed/angle display units follow the global switches. Hover and two persistent sample-point cursors provide readings and deltas; per-series visibility, validated fixed/auto Y ranges, and visible-window min/max/mean/peak-to-peak statistics are available. Source/unit/session changes reset measurements and source-specific chart settings. Hidden pages preserve history, and snapshots survive rolling live-history pruning. Disconnect still permits browsing/export; a new connection starts a fresh session. The x axis is explicitly host receive time, not an assumed 1 kHz device clock.
- **CSV export**: Current-source full history (the frozen snapshot while paused), visible-window points, or all live source histories can be saved through a native Tauri dialog. CSV uses a UTF-8 BOM, CRLF, full-precision original A/rpm/deg values, unit-bearing columns and escaped raw lines, independent of display conversion/hidden curves. All-source export merges time-ordered iterators without sorting a full sample array. `export_telemetry_csv` writes only the dialog-selected path; cancellation returns false and errors propagate.
- **Dark mode**: `next-themes` provider, defaults to dark.

### Data flow

```
Hardware → SerialDevice::read_loop
  → ordinary-response broadcast → Motor command/reply transaction → confirmed state/configuration
  → bounded telemetry queue → Motor 33 ms sample batches → uPlot / bounded raw console log
  → Tauri serial/state/calibration/telemetry events → React listeners and Jotai/UI
```

For commands (config changes, run commands), the flow reverses:
```
React → invoke("config_motor_position_pid", {...})
  → Rust handler → serialized Motor transaction → SerialDevice::send → Hardware
  → ok/error → get_config readback → confirmed cache or surfaced error
```
