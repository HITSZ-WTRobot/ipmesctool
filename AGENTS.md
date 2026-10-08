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

Package manager is **bun** (not npm/yarn/pnpm). There is no test suite.

## 工作流程

- 变更的需求需要即时更新到 CLAUDE.md，确保文档与代码保持一致。
- 在开发中合适的时间进行 git 提交，保持每次提交的粒度合理、可回溯。

## Architecture

**ipmesctool** is a Tauri v2 desktop app for configuring and debugging BLDC motor controllers over serial port.

### Two-process architecture

- **Rust backend** (`src-tauri/`) — serial communication, command parsing, motor state machine. Runs on tokio async runtime.
- **React frontend** (`src/`) — UI for PID configuration, encoder setup, calibration, waveform charts, serial console.

The frontend calls Rust via Tauri's `invoke()` mechanism. Each `#[tauri::command]` in `src-tauri/src/invokes.rs` maps to one frontend `invoke()` call. Rust pushes real-time data to the frontend via Tauri's event emitter (`app.emit()`), which the frontend listens to with `listen()` from `@tauri-apps/api/event`.

### Rust backend structure (`src-tauri/src/`)

| File | Purpose |
|------|---------|
| `main.rs` | Entry point, calls `lib::run()` |
| `lib.rs` | Tauri builder setup: registers plugins, initializes `AppState`, starts serial port monitor, registers all invoke handlers |
| `invokes.rs` | All `#[tauri::command]` handlers — the API surface between frontend and backend. Manages `AppState` (global motor + app handle) |
| `serial.rs` | `SerialDevice` — tokio-serial wrapper. Opens port, runs a read loop that splits incoming data on `\r\n` and broadcasts lines via `tokio::sync::broadcast` |
| `motor.rs` | `Motor` — wraps `SerialDevice`, manages state machine (`Stop`/`DebugRun`/`Run`/`Test`/`Fault`), parses feedback data, emits typed events |
| `command.rs` | Command enums (`MotorRunCommand`, `MotorConfigCommand`, `MotorCalibrationCommand`) — each serial command knows what motor states it's valid in |
| `config_parser.rs` | `ConfigParser` — incremental line-by-line parser that builds a `MotorConfig` struct from `get_config` serial output |
| `calibration_parser.rs` | `CalibrationParser` — state-machine parser for the multi-step calibration procedure |
| `error.rs` | `MotorError` enum (uses `thiserror`) |
| `exit_signal.rs` | `ExitSignal` — a `tokio::sync::watch`-based signal for cleanly stopping async loops |

**Key backend patterns:**
- The serial read loop broadcasts every `\r\n`-delimited line to all subscribers via `broadcast::channel`.
- `Motor::parse_feedback_loop` subscribes to these lines, checks the current `MotorFeedbackState`, and parses/emits typed feedback events (`motor_feedback_update`).
- Config commands are only allowed in `MotorState::Stop`. Run commands (`set_speed`, `set_position`) are allowed in `Stop` or `DebugRun`.
- The `unsaved` flag (`AtomicBool`) tracks whether config changes have been written to flash — shown as a red warning in the footer.

### Frontend structure (`src/`)

| Directory | Purpose |
|-----------|---------|
| `pages/` | 6 pages: device-info, pid-config, encoder-config, calibration, chart (waveform), serial-console. Lazy-loaded via `React.lazy()` |
| `components/` | App shell (sidebar, device connector, motor state indicator, debug console) + shadcn/ui primitives under `ui/` |
| `stores/` | Jotai atoms for global state |
| `lib/` | `cn()` utility, unit conversion helpers (rad/deg, rpm/rps) |
| `motor.ts` | Zod schemas mirroring Rust's `MotorConfig` struct |

**Key frontend patterns:**
- **State management**: Jotai atoms. `pageAtom` drives which page is visible. Pages are *persistent* — they render once and stay mounted, hidden via `display: none`. This preserves chart data and input state across page switches.
- **UI framework**: shadcn/ui (new-york style) with Tailwind CSS v4. Component aliases use `@/` prefix mapped to `src/`.
- **Feedback buffer** (`stores/feedback.ts`): Real-time sensor data (speed, position, current, Udc) is stored in plain arrays outside Jotai (`motorFeedbackBuffer`). Only UI control state (which type is selected, pause toggle, time window) lives in atoms. This avoids re-rendering on every high-frequency data point.
- **Dark mode**: `next-themes` provider, defaults to dark.

### Data flow

```
Hardware → Serial port → SerialDevice::read_loop → broadcast channel
  → Motor::parse_feedback_loop → Tauri emit("motor_feedback_update") 
  → React listen() → push to motorFeedbackBuffer → uPlot/PixiJS charts
```

For commands (config changes, run commands), the flow reverses:
```
React → invoke("config_motor_position_pid", {...}) 
  → Rust #[tauri::command] → Motor::send_config_command → SerialDevice::send → Hardware
```
