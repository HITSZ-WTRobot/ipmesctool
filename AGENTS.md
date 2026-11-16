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
| `bun test src/lib/telemetry-history.test.ts src/lib/telemetry-export.test.ts` | Run history boundaries and original-unit CSV regressions |

Package manager is **bun** (not npm/yarn/pnpm). Rust protocol regression tests cover full configuration parsing, calibration reports, state/parameter boundaries, command acknowledgements, telemetry frames, stream/ack isolation, and stale state-report handling. History and CSV tests use Bun with Node's test/assert APIs; there is no frontend UI test suite.

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
| `config_parser.rs` | `ConfigParser` — parses GPMD_Code's fourteen required configuration tags and their `key=value` fields |
| `calibration_parser.rs` | `CalibrationParser` — tracks separator-delimited asynchronous calibration reports and preserves results/failure stages |
| `telemetry.rs` | Seven stream modes, exact no-ack command mapping, and strict finite-number frame parsing |
| `telemetry_export.rs` | Native CSV save dialog and file write; accepts content and a suggested filename, never a frontend-supplied destination path |
| `error.rs` | `MotorError` enum (uses `thiserror`) |
| `exit_signal.rs` | `ExitSignal` — a `tokio::sync::watch`-based signal for cleanly stopping async loops |

**Key backend patterns:**
- Firmware reference: GPMD_Code `APP/uart_com.cpp`. Commands are CRLF-terminated; synchronous replies end with `ok` or `error <reason>`.
- Every ordinary request uses the same request lock and subscribes before sending. An `ok` is required before reporting ordinary command success; firmware errors are propagated. Timeout or ordinary-response broadcast lag closes the port to prevent a late acknowledgement from being assigned to a later command. Stream selection uses the same lock but must not wait for an acknowledgement.
- Firmware states are `Initialization`, `Calibration`, `CurrentControl`, `SpeedControl`, `PositionControl`, `Ready`, and `Fault`; `Unknown` is never assumed runnable. Configuration and calibration require `Ready`; control/stop allow `Ready` and the three control modes; `clear_fault` requires `Fault`.
- `get_config` requires fourteen data tags before the final acknowledgement: `state`, `fault`, uint32 `id`, `protection`, `motor`, `current_pi`, `speed_pi`, `speed_sweep`, `position_pid`, `encoder`, `hfi`, `observer_flux`, `transition`, and `backup`. `motor` includes `rs`, `ld`, `lq`, `flux` (Wb), and `flux_speed` (mechanical rpm); `speed_sweep` includes `iq_amplitude` (A), `speed_filter`, `current_filter`, and `pll_frequency` (Hz). Missing, non-finite, or invalid fields fail the snapshot; do not fill legacy defaults. Firmware documentation omits `fault` and `backup`; the actual `uart_com.cpp` output is authoritative.
- Configuration setters persist to Flash themselves except `config_backup`, which changes only runtime state; there is no `save` command or unsaved flag. `config_id` writes only 0–2047 (the firmware's standard FDCAN ID limit), although the wire field is uint32. `config_current_pi <d_kp> <d_ki> <q_kp> <q_ki>` writes independent finite positive d/q gains. `config_speed_sweep_current <A>` sets calibration sine q-axis amplitude. `config_current_limit <A>` is an absolute per-phase overcurrent threshold: exceeding it triggers Fault, not soft command clipping. Sweep amplitude and protection threshold are independently finite and positive. All known raw configuration commands share typed Ready/validation/ack/readback handling.
- `config_flux_speed <rpm>` accepts mechanical speed amplitude 100–3000. `config_speed_filter <Hz>`, `config_current_filter <Hz>`, and `config_speed_pll <Hz>` require positive finite frequencies whose single-precision angular coefficients do not overflow (PLL also checks the squared coefficient). `config_hfi <voltage> <current_filter> <kp> <ki> <speed_filter>` accepts voltage ≥ 0 V, filters strictly between 0 and 2500 Hz, and positive PLL gains. `config_observer_flux <gamma> <kp> <ki>` limits gains to (0, 1e12], (0, 1e6], and (0, 1e8]; `config_observer_transition <low> <high>` requires 0 ≤ low < high ≤ 1e6 electrical rpm. All are Ready-only and require confirmed readback.
- `config_backup 0|1` is Ready-only and not persisted; enabling requires positive HFI voltage. `hfi_enable` requires CurrentControl, SpeedControl, or PositionControl plus firmware backup/voltage validity; `hfi_disable` is allowed in any connected state. `get_hfi`, `get observer flux`, and `get observer transition` return data plus `ok`, unlike stream controls.
- `fault <flags>` (mask 1=overcurrent, mask 2=encoder) and `hfi_state <n>` are asynchronous ordinary console reports. HFI states are 0=Bypass, 1=Starting, 2=Observing, 3=VoltageLimit, 4=Invalid; an enable acknowledgement does not establish convergence. Serial caches reports before broadcasting; state revisions prevent a delayed configuration-state line from replacing a newer run/fault report. `get_motor_diagnostics` and `motor-diagnostics` use `{sessionId,fault,hfiState}` (`hfiState` is null until reported).
- `iap` is Ready-only: after `ok`, firmware resets into its UART Bootloader and the tool directly closes/releases the native Motor, emitting one session-tagged disconnect. Do not send `get_none` or configuration/state readback afterward. Raw console exposes this handoff; the tool does not implement a Ymodem image uploader.
- Speed commands use mechanical rpm, position commands use accumulated mechanical degrees, and current commands use q-axis amperes. UI rad/s and radians are converted before invoking the backend.
- Encoder writes accept pole pairs 1–255, direction `CW`/`CCW`, offset in electrical radians, and `AS5600`, `MT6701_IIC`, `MT6701_SPI`, or `AS5047P`. Unconfigured `None`/`Unknown` readback is displayed but cannot be written.
- Calibration's initial `ok` only acknowledges startup. Its asynchronous `calibration_status`/`stage`/`result`/`failed_stage` blocks finish at the closing separator of a success/failure report. Stages include `flux_forward`, `flux_reverse`, and `flux_stopping`; the final `result magnet_flux=<value> Wb` must be retained. Flux identification rotates the motor in both directions. Failures preserve the reported motor state; successful calibration requests automatic saving in the firmware main loop (there is no separate Flash acknowledgement).
- UART supports seven mutually exclusive streams selected by `get_iabc`, `get_idq`, `get_speed`, `get_position`, `get_angle`, `get observer pos`, and `get observer speed`; `get_none` stops them. All eight controls have no `ok`: typed/raw callers report host write completion only. Initialization sends `get_none` before `get_config`; ordinary disconnect best-effort sends `get_none` before closing (IAP is the exception). Stream selection never changes motor state.
- Stream frames are `iabc:a,b,c` (A), `idq:d,q` (A), `speed:reference,feedback` (mechanical rpm), `position:reference,feedback` (accumulated mechanical degrees), `angle:encoder,observer` and `observer_pos:encoder,observer` (electrical degrees), and `observer_speed:encoder,observer` (electrical rpm). `angle` and `observer_pos` currently carry identical firmware values. Valid/malformed stream-prefixed lines stay out of the ordinary-response broadcast. A 256-sample drop-oldest queue emits batches about every 33 ms as `{sessionId,samples}`, with samples `{mode,time,values,raw}`; `time` is monotonic host receive seconds since connection, not device sample time. Each Motor has an immutable monotonically allocated string session ID; telemetry/diagnostics queries and events use it, and `motor-disconnected` uses `{sessionId}`. Stream data is not also emitted as `serial-received`.
- UART has no bus-voltage setter or direct Rs/Ld/Lq/flux setter. Speed/current filters and encoder PLL are writable. Manual-save paths remain removed. Raw console sends one command per request with shared acknowledgement/state rules except the explicit no-ack stream commands and IAP handoff.

### Frontend structure (`src/`)

| Directory | Purpose |
|-----------|---------|
| `pages/` | 7 persistent lazy pages: device-info, pid-config, encoder-config, calibration, observer-config, serial-console, plot |
| `components/` | App shell (sidebar, device connector, motor state indicator, control console) + shadcn/ui primitives under `ui/` |
| `stores/` | Jotai atoms for global state |
| `lib/` | `cn()` utility, unit conversions, chunked telemetry history, and original-unit CSV generation/native export |
| `motor.ts` | Zod schemas mirroring Rust's `MotorConfig` struct |

**Key frontend patterns:**
- **State management**: Jotai atoms; `pageAtom` drives persistent pages hidden with `display: none`, preserving drafts across navigation. Disconnect clears configuration/state/diagnostics and drafts. PID edits include four independent d/q gains behind unlock confirmation; reconnect relocks them. Calibration owns sweep amplitude, flux identification speed, and three filter/PLL frequencies. The observer page owns HFI/flux/transition configuration, runtime backup and HFI controls; device information owns phase-current protection and displays flux/fault/HFI readback. Numeric firmware cards reuse `PidConfigCard`, validate float32 ranges, require write confirmation/Ready, and accept readback only from the original connected native session; new configuration reseeds drafts.
- **UI framework**: shadcn/ui (new-york style) with Tailwind CSS v4. Component aliases use `@/` prefix mapped to `src/`.
- **Protocol data**: `motorConfigSchema` validates configuration at the frontend boundary. Global atoms hold configuration/connection/state; serial, motor, calibration, and telemetry events update the relevant UI. App mounts `useTelemetry()` once, independent of persistent page visibility. Histories retain full-resolution samples by host receive time, default 300 seconds with 60/300/600/900-second choices; the newest received time trims all sources. `TelemetryHistory` uses 512-point blocks, binary-search window reads, and copy-on-write snapshots instead of copying all retained points on each batch. The serial console retains 5000 lines; telemetry raw lines are appended from the same sample batch. Disconnect clears mode but retains history and rejects disconnected samples. A new connection clears history and queries its native session ID before accepting matching events; old-session mode/sample/disconnect events are ignored. `useTelemetry` is the sole disconnect-event consumer; Device mirrors the connected-to-disconnected transition to clear configuration and release the native Motor.
- **Diagnostics**: App mounts `useMotorDiagnostics()` once. It subscribes before querying, authenticates against `telemetryNativeSessionIdAtom`, buffers pre-authentication reports, and uses revisions to prevent an older query response from replacing a newer report. Old-session events and disconnected readbacks are ignored; displayed HFI state comes from firmware reports, never inferred from command acknowledgement.
- **Waveform UI**: `Debug.Plot` uses uPlot with seven flat source buttons (single-click switch while acquiring, selection only while stopped), separate acquisition start/stop, 1/5/10-second display windows, fixed-snapshot pause/history scrolling, and clear-all. Only the visible window is converted. Stopping acquisition sends `get_none`, not motor `stop`. Mechanical speed/angle follow global units; electrical degree/rpm streams retain protocol units without pole-pair conversion. Hover and two persistent sample-point cursors provide readings/deltas; per-series visibility, validated fixed/auto Y ranges, and visible-window statistics remain available. Source/unit/session changes reset source-specific measurements/settings. Hidden pages preserve history, frozen snapshots survive pruning, and disconnect still permits browsing/export. The x axis is host receive time, not an assumed 1 kHz device clock.
- **CSV export**: Current-source full history (the frozen snapshot while paused), visible-window points, or all live sources can be saved through a native Tauri dialog. CSV uses UTF-8 BOM, CRLF, full-precision original A/rpm/deg values, escaped raw lines, and 18 columns distinguishing mechanical and electrical signals regardless of display units/hidden curves. All-source export merges time-ordered iterators without sorting a full sample array. `export_telemetry_csv` writes only the dialog-selected path; cancellation returns false and errors propagate.
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
