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

Package manager is **bun** (not npm/yarn/pnpm). Rust protocol regression tests cover configuration parsing, calibration reports, state/parameter boundaries, and command acknowledgements; there is no frontend test suite.

## 工作流程

- 变更的需求需要即时更新到 CLAUDE.md，确保文档与代码保持一致。
- 在开发中合适的时间进行 git 提交，保持每次提交的粒度合理、可回溯。

## Architecture

**ipmesctool** is a Tauri v2 desktop app for configuring and debugging BLDC motor controllers over serial port.

### Two-process architecture

- **Rust backend** (`src-tauri/`) — serial communication, command parsing, motor state machine. Runs on tokio async runtime.
- **React frontend** (`src/`) — UI for PID configuration, encoder setup, calibration, control commands, and the serial console.

The frontend calls Rust via Tauri's `invoke()` mechanism. Each `#[tauri::command]` in `src-tauri/src/invokes.rs` maps to a frontend `invoke()` call. Rust pushes serial lines, motor state changes, and calibration progress via Tauri's event emitter (`app.emit()`); the frontend subscribes with `listen()` from `@tauri-apps/api/event`.

### Rust backend structure (`src-tauri/src/`)

| File | Purpose |
|------|---------|
| `main.rs` | Entry point, calls `lib::run()` |
| `lib.rs` | Tauri builder setup: registers plugins, initializes `AppState`, starts serial port monitor, registers all invoke handlers |
| `invokes.rs` | All `#[tauri::command]` handlers — the API surface between frontend and backend. Manages `AppState` (global motor + app handle) |
| `serial.rs` | `SerialDevice` — tokio-serial wrapper. Opens the port, splits received lines on LF (including firmware CRLF), and broadcasts lines via `tokio::sync::broadcast` |
| `motor.rs` | `Motor` — serializes command/reply transactions, maintains firmware state/configuration, and emits raw console and calibration events |
| `command.rs` | Command enums (`MotorRunCommand`, `MotorConfigCommand`, `MotorCalibrationCommand`) — each serial command knows what motor states it's valid in |
| `config_parser.rs` | `ConfigParser` — parses GPMD_Code's seven space-separated configuration rows and their `key=value` fields |
| `calibration_parser.rs` | `CalibrationParser` — tracks separator-delimited asynchronous calibration reports and preserves results/failure stages |
| `error.rs` | `MotorError` enum (uses `thiserror`) |
| `exit_signal.rs` | `ExitSignal` — a `tokio::sync::watch`-based signal for cleanly stopping async loops |

**Key backend patterns:**
- Firmware reference: GPMD_Code `APP/uart_com.cpp`. Commands are CRLF-terminated; synchronous replies end with `ok` or `error <reason>`.
- Every request uses the same request lock and subscribes before sending. An `ok` is required before reporting command success; firmware errors are propagated. Timeout or broadcast lag closes the port to prevent a late acknowledgement from being assigned to a later command.
- Firmware states are `Initialization`, `Calibration`, `CurrentControl`, `SpeedControl`, `PositionControl`, `Ready`, and `Fault`; `Unknown` is never assumed runnable. Configuration and calibration require `Ready`; control/stop allow `Ready` and the three control modes; `clear_fault` requires `Fault`.
- `get_config` reads `state`, uint32 `id`, `motor` (`rs`, `ld`, `lq`), `current_pi`, `speed_pi`, `position_pid`, and `encoder`, then waits for the final acknowledgement. Missing or malformed configuration is an error, not a partial success.
- Configuration setters persist to Flash themselves; there is no `save` command or unsaved flag. `config_id` writes only 0–2047 (the firmware's standard FDCAN ID limit), although the wire field is uint32. `config_current_pi <kp> <ki>` writes the same gains to d/q, although readback may contain different d/q gains after calibration.
- Speed commands use mechanical rpm, position commands use accumulated mechanical degrees, and current commands use q-axis amperes. UI rad/s and radians are converted before invoking the backend.
- Encoder writes accept pole pairs 1–255, direction `CW`/`CCW`, offset in electrical radians, and `AS5600`, `MT6701_IIC`, `MT6701_SPI`, or `AS5047P`. Unconfigured `None`/`Unknown` readback is displayed but cannot be written.
- Calibration's initial `ok` only acknowledges startup. Its asynchronous `calibration_status`/`stage`/`result`/`failed_stage` blocks finish at the closing separator of a success/failure report. Failures preserve the reported motor state; successful calibration requests automatic saving in the firmware main loop (there is no separate Flash acknowledgement).
- UART has no live telemetry, bus-voltage/filter setters, or motor-electrical-parameter setters. The old waveform/feedback and manual-save paths are removed, not emulated. The raw console sends one command per request and uses the same acknowledgement/state rules.

### Frontend structure (`src/`)

| Directory | Purpose |
|-----------|---------|
| `pages/` | 5 pages: device-info, pid-config, encoder-config, calibration, serial-console. Lazy-loaded via `React.lazy()` |
| `components/` | App shell (sidebar, device connector, motor state indicator, control console) + shadcn/ui primitives under `ui/` |
| `stores/` | Jotai atoms for global state |
| `lib/` | `cn()` utility, unit conversion helpers (rad/deg, rpm/rps) |
| `motor.ts` | Zod schemas mirroring Rust's `MotorConfig` struct |

**Key frontend patterns:**
- **State management**: Jotai atoms. `pageAtom` drives which page is visible. Pages are *persistent* — they render once and stay mounted, hidden via `display: none`. This preserves editing state across page switches; device disconnection clears configuration/state and PID drafts.
- **UI framework**: shadcn/ui (new-york style) with Tailwind CSS v4. Component aliases use `@/` prefix mapped to `src/`.
- **Protocol data**: `motorConfigSchema` validates configuration at the frontend boundary. Global atoms hold configuration/connection/state; `serial-sent`, `serial-received`, `motor-state-change`, `motor-disconnected`, and `calibration-state` update the relevant UI. No UART waveform buffer exists.
- **Dark mode**: `next-themes` provider, defaults to dark.

### Data flow

```
Hardware → SerialDevice::read_loop → broadcast channel
  → Motor command/reply transaction → confirmed configuration/state
  → Tauri serial/state/calibration events → React listeners and Jotai/UI
```

For commands (config changes, run commands), the flow reverses:
```
React → invoke("config_motor_position_pid", {...})
  → Rust handler → serialized Motor transaction → SerialDevice::send → Hardware
  → ok/error → get_config readback → confirmed cache or surfaced error
```
