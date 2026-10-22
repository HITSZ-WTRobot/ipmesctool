use crate::calibration_parser::{CalibrationParser, CalibrationState, CalibrationStatus};
use crate::command::{
    MotorCalibrationCommand, MotorConfigCommand, MotorRunCommand, MotorState, MAX_MOTOR_ID,
};
use crate::config_parser::{ConfigParser, MotorConfig};
use crate::error::MotorError;
use crate::exit_signal::ExitSignal;
use crate::serial::{SerialDevice, TELEMETRY_CAPACITY};
use crate::telemetry::{TelemetryMode, TelemetrySample};
use log::warn;
use std::borrow::Cow;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::select;
use tokio::sync::{broadcast, Mutex};
use tokio::task::JoinHandle;
use tokio::time::{timeout, Duration};

/// 固件同步命令回包的等待上限。
const COMMAND_TIMEOUT: Duration = Duration::from_secs(5);
/// 校准由固件主循环异步逐阶段上报，沿用既有总时长上限。
const CALIBRATION_TIMEOUT: Duration = Duration::from_secs(120);
/// 串口读取任务在断开时广播的哨兵行。
const DISCONNECTED_SENTINEL: &str = "__DISCONNECTED__";
/// `get_config` 是只读命令，没有对应的写入命令类型。
const GET_CONFIG_COMMAND: &str = "get_config\r\n";

// A fixed per-Motor identity lets consumers reject delayed events after reconnect.
static NEXT_SESSION_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryState<'a> {
    session_id: Cow<'a, str>,
    mode: TelemetryMode,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct TelemetrySamplesEvent<'a> {
    session_id: &'a str,
    samples: &'a [TelemetrySample],
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct DisconnectedEvent<'a> {
    session_id: &'a str,
}

/// 固件同步命令的结束标记：`ok` 或 `error <reason>`。
enum Ack {
    Ok,
    Error(String),
}

/// 识别固件回包中的结束标记；数据行返回 `None`。
fn classify_ack(line: &str) -> Option<Ack> {
    if line == "ok" {
        return Some(Ack::Ok);
    }
    if line == "error" {
        return Some(Ack::Error("unspecified".to_string()));
    }
    if let Some(reason) = line.strip_prefix("error ") {
        let reason = reason.trim();
        return Some(Ack::Error(if reason.is_empty() {
            "unspecified".to_string()
        } else {
            reason.to_string()
        }));
    }
    None
}

/// 一次等待的结束方式。
enum WaitOutcome {
    /// 收到 `ok`，该请求的边界已确定。
    Ack,
    /// 已收到完整 `error <reason>` 行或确认断开：边界确定，连接可继续使用。
    Failed(MotorError),
    /// 超时/丢行：回包边界未知，必须关闭串口，避免迟到回包被下一条命令误认。
    Uncertain(MotorError),
}

fn require_finite(value: f32, name: &str) -> Result<(), MotorError> {
    if value.is_finite() {
        Ok(())
    } else {
        Err(MotorError::InvalidParameter(format!(
            "{name} must be a finite number"
        )))
    }
}

/// 按固件 setter 的实际取值范围校验配置参数（uart_com.cpp + motor.cpp）。
fn validate_config_command(cmd: &MotorConfigCommand) -> Result<(), MotorError> {
    match cmd {
        MotorConfigCommand::ConfigPositionPid {
            kp,
            ki,
            kd,
            output_max,
        } => {
            require_finite(*kp, "kp")?;
            require_finite(*ki, "ki")?;
            require_finite(*kd, "kd")?;
            require_finite(*output_max, "output_max")?;
            if *kp <= 0.0 || *ki <= 0.0 {
                return Err(MotorError::InvalidParameter(
                    "kp and ki must be greater than zero".to_string(),
                ));
            }
            if *kd < 0.0 {
                return Err(MotorError::InvalidParameter(
                    "kd must not be negative".to_string(),
                ));
            }
            if *output_max <= 0.0 {
                return Err(MotorError::InvalidParameter(
                    "output_max must be greater than zero".to_string(),
                ));
            }
        }
        MotorConfigCommand::ConfigSpeedPi { kp, ki, output_max } => {
            require_finite(*kp, "kp")?;
            require_finite(*ki, "ki")?;
            require_finite(*output_max, "output_max")?;
            if *kp <= 0.0 || *ki <= 0.0 {
                return Err(MotorError::InvalidParameter(
                    "kp and ki must be greater than zero".to_string(),
                ));
            }
            if *output_max <= 0.0 {
                return Err(MotorError::InvalidParameter(
                    "output_max must be greater than zero".to_string(),
                ));
            }
        }
        MotorConfigCommand::ConfigSpeedSweepCurrent(current) => {
            require_finite(*current, "speed_sweep_current")?;
            if *current <= 0.0 {
                return Err(MotorError::InvalidParameter(
                    "speed_sweep_current must be greater than zero".to_string(),
                ));
            }
        }
        MotorConfigCommand::ConfigCurrentLimit(current_limit) => {
            require_finite(*current_limit, "current_limit")?;
            if *current_limit <= 0.0 {
                return Err(MotorError::InvalidParameter(
                    "current_limit must be greater than zero".to_string(),
                ));
            }
        }
        MotorConfigCommand::ConfigCurrentPi { d_kp, d_ki, q_kp, q_ki } => {
            for (gain, name) in [(d_kp, "d_kp"), (d_ki, "d_ki"), (q_kp, "q_kp"), (q_ki, "q_ki")] {
                require_finite(*gain, name)?;
                if *gain <= 0.0 {
                    return Err(MotorError::InvalidParameter(format!(
                        "{name} must be greater than zero"
                    )));
                }
            }
        }
        MotorConfigCommand::ConfigEncoder {
            pole_pairs,
            encoder_direction,
            encoder_offset,
            encoder_type,
        } => {
            if !(1..=255).contains(pole_pairs) {
                return Err(MotorError::InvalidParameter(
                    "pole_pairs must be in 1..=255".to_string(),
                ));
            }
            require_finite(*encoder_offset, "encoder_offset")?;
            if !encoder_direction.is_writable() {
                return Err(MotorError::InvalidParameter(
                    "encoder_direction must be CW or CCW".to_string(),
                ));
            }
            if !encoder_type.is_writable() {
                return Err(MotorError::InvalidParameter(
                    "encoder_type must be AS5600, MT6701_IIC, MT6701_SPI or AS5047P".to_string(),
                ));
            }
        }
        // 固件 motor_t::set_id 拒绝 id > k_max_id（motor.hpp，标准帧 ID 范围）。
        MotorConfigCommand::ConfigId(id) => {
            if *id > MAX_MOTOR_ID {
                return Err(MotorError::InvalidParameter(format!(
                    "id must be in 0..={} because the firmware set_id rejects larger values",
                    MAX_MOTOR_ID
                )));
            }
        }
    }
    Ok(())
}

fn prepare_config_command(
    cmd: &MotorConfigCommand,
    state: &MotorState,
) -> Result<(String, Option<MotorState>), MotorError> {
    if !state.allows_config() {
        return Err(MotorError::InvalidState(format!(
            "configuration is only allowed in Ready state, current state {state}"
        )));
    }
    validate_config_command(cmd)?;
    let command = cmd.to_string(state).ok_or_else(|| {
        MotorError::InvalidParameter(
            "configuration values are outside the supported range".to_string(),
        )
    })?;
    Ok((command, None))
}

fn prepare_run_command(
    cmd: &MotorRunCommand,
    state: &MotorState,
) -> Result<(String, Option<MotorState>), MotorError> {
    let next_state = match cmd {
        MotorRunCommand::SetSpeed(speed) => {
            require_finite(*speed, "speed")?;
            MotorState::SpeedControl
        }
        MotorRunCommand::SetPosition(position) => {
            require_finite(*position, "position")?;
            MotorState::PositionControl
        }
        MotorRunCommand::SetCurrent(current) => {
            require_finite(*current, "current")?;
            MotorState::CurrentControl
        }
        MotorRunCommand::Stop => MotorState::Ready,
        MotorRunCommand::ClearFault => MotorState::Ready,
    };

    let allowed = match cmd {
        MotorRunCommand::ClearFault => state.allows_clear_fault(),
        _ => state.allows_run_command(),
    };
    if !allowed {
        return Err(MotorError::InvalidState(format!(
            "command is not allowed in state {state}"
        )));
    }

    let command = cmd.to_string(state).ok_or_else(|| {
        MotorError::InvalidParameter(
            "run command rejected for the current state or parameters".to_string(),
        )
    })?;
    Ok((command, Some(next_state)))
}

/// 解析 raw console 中 `set_* <value>` 的唯一数值参数。
fn parse_raw_value(command: &str, name: &str) -> Result<f32, MotorError> {
    let mut tokens = command.split_whitespace();
    tokens.next();
    let value = tokens.next();
    if tokens.next().is_some() {
        return Err(MotorError::InvalidParameter(format!(
            "{name} expects exactly one numeric argument"
        )));
    }
    let value = value
        .and_then(|token| token.parse::<f32>().ok())
        .ok_or_else(|| {
            MotorError::InvalidParameter(format!("{name} expects one numeric argument"))
        })?;
    require_finite(value, name)?;
    Ok(value)
}

/// 已迁移的配置命令必须共用类型化命令的校验、状态与读回流程。
fn parse_raw_config_command(command: &str) -> Result<Option<MotorConfigCommand>, MotorError> {
    let mut tokens = command.split_whitespace();
    let name = tokens.next().unwrap_or_default();
    let config = match name {
        "config_current_limit" => MotorConfigCommand::ConfigCurrentLimit(parse_raw_value(command, name)?),
        "config_speed_sweep_current" => MotorConfigCommand::ConfigSpeedSweepCurrent(parse_raw_value(command, name)?),
        "config_current_pi" => {
            let mut next_gain = || {
                tokens.next().and_then(|value| value.parse::<f32>().ok()).ok_or_else(|| {
                    MotorError::InvalidParameter(
                        "config_current_pi expects exactly four numeric arguments".to_string(),
                    )
                })
            };
            let config = MotorConfigCommand::ConfigCurrentPi {
                d_kp: next_gain()?,
                d_ki: next_gain()?,
                q_kp: next_gain()?,
                q_ki: next_gain()?,
            };
            if tokens.next().is_some() {
                return Err(MotorError::InvalidParameter(
                    "config_current_pi expects exactly four numeric arguments".to_string(),
                ));
            }
            config
        }
        _ => return Ok(None),
    };
    Ok(Some(config))
}

#[derive(Debug)]
pub struct Motor {
    pub serial: Arc<SerialDevice>,
    session_id: String,
    /// 固件上报的电机状态；未知/初始化/校准状态一律不视为可运行。
    pub state: Mutex<MotorState>,
    /// 最近一次 `get_config` 的确认结果。
    pub motor_config: Mutex<Option<MotorConfig>>,
    pub app: AppHandle,
    /// 所有请求（含 raw console）共用一把锁：写与回包必须一一配对。
    request_lock: Mutex<()>,
    telemetry_mode: Mutex<TelemetryMode>,
    console_handle: Mutex<Option<JoinHandle<()>>>,
    console_exit_signal: Arc<ExitSignal>,
}

impl Motor {
    pub fn new(serial: Arc<SerialDevice>, app: AppHandle) -> Arc<Self> {
        Arc::new(Self {
            serial,
            session_id: NEXT_SESSION_ID.fetch_add(1, Ordering::Relaxed).to_string(),
            state: Mutex::new(MotorState::Unknown),
            motor_config: Mutex::new(None),
            app,
            request_lock: Mutex::new(()),
            telemetry_mode: Mutex::new(TelemetryMode::None),
            console_handle: Mutex::new(None),
            console_exit_signal: ExitSignal::new(),
        })
    }

    fn emit_state(&self, state: MotorState) {
        if let Err(e) = self.app.emit("motor-state-change", state) {
            warn!("failed to emit motor-state-change: {e}");
        }
    }

    /// 原始控制台发送记录：去掉 CRLF，前端按行显示。
    fn emit_sent(&self, command: &str) {
        let line = command.trim_end_matches(|c: char| c == '\r' || c == '\n');
        if let Err(e) = self.app.emit("serial-sent", line) {
            warn!("failed to emit serial-sent: {e}");
        }
    }

    fn emit_telemetry_mode(&self, mode: TelemetryMode) {
        let state = TelemetryState {
            session_id: Cow::Borrowed(&self.session_id),
            mode,
        };
        if let Err(e) = self.app.emit("telemetry-mode", state) {
            warn!("failed to emit telemetry-mode: {e}");
        }
    }

    pub async fn get_telemetry_state(&self) -> TelemetryState<'static> {
        let mode = *self.telemetry_mode.lock().await;
        TelemetryState {
            session_id: Cow::Owned(self.session_id.clone()),
            mode,
        }
    }

    /// The firmware deliberately sends no ack for these commands. This reports
    /// successful serial writing only and never changes the motor state.
    pub async fn set_telemetry_mode(
        self: &Arc<Self>,
        mode: TelemetryMode,
    ) -> Result<(), MotorError> {
        let _guard = self.request_lock.lock().await;
        self.set_telemetry_mode_locked(mode).await
    }

    async fn set_telemetry_mode_locked(&self, mode: TelemetryMode) -> Result<(), MotorError> {
        self.serial
            .send(mode.command())
            .await
            .map_err(MotorError::SerialError)?;
        let mut current = self.telemetry_mode.lock().await;
        if !self.serial.connected.load(Ordering::Relaxed) {
            return Err(MotorError::Disconnected);
        }
        *current = mode;
        self.emit_sent(mode.command());
        self.emit_telemetry_mode(mode);
        Ok(())
    }

    async fn clear_telemetry(&self) {
        let mut mode = self.telemetry_mode.lock().await;
        *mode = TelemetryMode::None;
        self.serial.clear_telemetry();
        self.emit_telemetry_mode(TelemetryMode::None);
    }

    /// Serialize the final no-ack stream stop with all ordinary transactions.
    /// Always close the port, even when the final write fails.
    pub async fn disconnect(self: &Arc<Self>) -> Result<(), MotorError> {
        let _guard = self.request_lock.lock().await;
        let result = if self.serial.connected.load(Ordering::Relaxed) {
            self.set_telemetry_mode_locked(TelemetryMode::None).await
        } else {
            Ok(())
        };
        let close_result = self.serial.disconnect().await.map_err(MotorError::SerialError);
        self.clear_telemetry().await;
        self.stop_console_loop().await;
        result.and(close_result)
    }

    fn emit_calibration_state(&self, state: &CalibrationState) {
        if let Err(e) = self.app.emit("calibration-state", state) {
            warn!("failed to emit calibration-state: {e}");
        }
    }

    /// 与固件状态同步，仅在变化时通知前端，并让配置缓存中的 state 保持一致。
    pub async fn set_state(&self, next: MotorState) {
        let mut current = self.state.lock().await;
        if *current == next {
            return;
        }
        *current = next;
        drop(current);
        if let Some(config) = self.motor_config.lock().await.as_mut() {
            config.state = next;
        }
        self.emit_state(next);
    }

    /// 超时/丢行后回包边界无法确定：关闭串口，由用户重新连接。
    async fn close_on_uncertain_boundary(&self) {
        warn!(
            "serial reply boundary unknown, closing port {}",
            self.serial.port_name
        );
        let _ = self.serial.disconnect().await;
    }

    /// Forward ordinary console lines and flush bounded telemetry batches at ~30Hz.
    pub async fn start_console_loop(self: &Arc<Self>) {
        let mut rx = self.serial.recv_event_tx.subscribe();
        let this = Arc::clone(self);
        let app = self.app.clone();
        let exit_signal = Arc::clone(&self.console_exit_signal);
        let handle = tokio::spawn(async move {
            let mut tick = tokio::time::interval(Duration::from_millis(33));
            tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            let mut batch = Vec::with_capacity(TELEMETRY_CAPACITY);
            loop {
                select! {
                    line = rx.recv() => match line {
                        Ok(line) if line == DISCONNECTED_SENTINEL => {
                            this.clear_telemetry().await;
                            if let Err(e) = app.emit("motor-disconnected", DisconnectedEvent { session_id: &this.session_id }) {
                                warn!("failed to emit motor-disconnected: {e}");
                            }
                            break;
                        }
                        Ok(line) => {
                            if let Err(e) = app.emit("serial-received", &line) {
                                warn!("failed to emit serial-received: {e}");
                            }
                        }
                        Err(broadcast::error::RecvError::Lagged(n)) => {
                            warn!("serial console lagged, {n} lines dropped");
                        }
                        Err(broadcast::error::RecvError::Closed) => break,
                    },
                    _ = tick.tick() => {
                        if this.serial.connected.load(Ordering::Relaxed) {
                            this.serial.drain_telemetry(&mut batch);
                            if !batch.is_empty() {
                                if let Err(e) = app.emit("telemetry-samples", TelemetrySamplesEvent { session_id: &this.session_id, samples: &batch }) {
                                    warn!("failed to emit telemetry-samples: {e}");
                                }
                                batch.clear();
                            }
                        }
                    }
                    _ = exit_signal.wait() => break,
                }
            }
        });
        *self.console_handle.lock().await = Some(handle);
    }

    /// 停止常驻控制台任务（用户主动断开时先触发，避免误报断开事件）。
    pub async fn stop_console_loop(&self) {
        self.console_exit_signal.trigger();
        if let Some(handle) = self.console_handle.lock().await.take() {
            let _ = handle.await;
        }
    }

    /// 串行执行一次「写入 + 等待 ack」事务（自行获取请求锁）。
    async fn transact<P, H>(
        self: &Arc<Self>,
        wait: Duration,
        prepare: P,
        handler: H,
    ) -> Result<(), MotorError>
    where
        P: FnOnce(&MotorState) -> Result<(String, Option<MotorState>), MotorError>,
        H: FnMut(&str) -> Result<(), MotorError>,
    {
        let _guard = self.request_lock.lock().await;
        self.transact_locked(wait, prepare, handler).await
    }

    /// `transact` 的实现：调用方必须已持有 `request_lock`。用于「读取快照 +
    /// 提交结果」必须在同一锁周期内完成的事务（见 `load_config`）。
    ///
    /// `prepare` 负责校验当前状态并生成命令行；`handler` 处理 ack 之前的非
    /// 结束行（例如 `get_config` 的数据行）。只有收到 `ok` 才返回成功；
    /// `error <reason>`、超时、断开都会传播。
    async fn transact_locked<P, H>(
        self: &Arc<Self>,
        wait: Duration,
        prepare: P,
        mut handler: H,
    ) -> Result<(), MotorError>
    where
        P: FnOnce(&MotorState) -> Result<(String, Option<MotorState>), MotorError>,
        H: FnMut(&str) -> Result<(), MotorError>,
    {
        let state = *self.state.lock().await;
        let (command, next_state) = prepare(&state)?;

        // 订阅必须早于写入：固件回包可能紧随写入之后到达。
        let mut rx = self.serial.recv_event_tx.subscribe();
        self.emit_sent(&command);
        self.serial
            .send(&command)
            .await
            .map_err(MotorError::SerialError)?;

        let outcome = timeout(wait, async {
            loop {
                match rx.recv().await {
                    Ok(line) if line == DISCONNECTED_SENTINEL => {
                        return WaitOutcome::Failed(MotorError::Disconnected);
                    }
                    Ok(line) => match classify_ack(&line) {
                        Some(Ack::Ok) => return WaitOutcome::Ack,
                        Some(Ack::Error(reason)) => {
                            return WaitOutcome::Failed(MotorError::FirmwareError(reason));
                        }
                        None => {
                            if let Err(e) = handler(&line) {
                                return WaitOutcome::Uncertain(e);
                            }
                        }
                    },
                    Err(broadcast::error::RecvError::Lagged(n)) => {
                        return WaitOutcome::Uncertain(MotorError::SerialError(format!(
                            "serial receive lagged, {n} lines dropped"
                        )));
                    }
                    Err(broadcast::error::RecvError::Closed) => {
                        return WaitOutcome::Failed(MotorError::Disconnected);
                    }
                }
            }
        })
        .await;

        match outcome {
            Ok(WaitOutcome::Ack) => {}
            Ok(WaitOutcome::Failed(e)) => return Err(e),
            Ok(WaitOutcome::Uncertain(e)) => {
                self.close_on_uncertain_boundary().await;
                return Err(e);
            }
            Err(_) => {
                self.close_on_uncertain_boundary().await;
                return Err(MotorError::Timeout);
            }
        }

        // 只有 ack 之后才同步新状态（set_state 同时刷新配置缓存里的 state）。
        if let Some(next) = next_state {
            self.set_state(next).await;
        }
        Ok(())
    }

    /// 读取 `get_config`（9 行数据 + ok），成功时更新配置缓存并同步状态。
    ///
    /// 「读快照 + 提交缓存/状态」必须在同一个请求锁周期内完成，否则提交前可能被
    /// 并发的运行命令写入更新的状态，再被这份旧快照覆盖。
    pub async fn load_config(self: &Arc<Self>) -> Result<MotorConfig, MotorError> {
        let _guard = self.request_lock.lock().await;

        let mut parser = ConfigParser::default();
        let mut parse_error: Option<String> = None;

        self.transact_locked(
            COMMAND_TIMEOUT,
            |_state| Ok((GET_CONFIG_COMMAND.to_string(), None)),
            |line| {
                // 记录首个错误但继续读到 ack，保证写入与回包不错位。
                if parse_error.is_none() {
                    if let Err(e) = parser.parse_line(line) {
                        parse_error = Some(e);
                    }
                }
                Ok(())
            },
        )
        .await?;

        if let Some(e) = parse_error {
            return Err(MotorError::ParseError(e));
        }
        let config = parser
            .try_into_motor_config()
            .map_err(MotorError::ParseError)?;
        *self.motor_config.lock().await = Some(config.clone());
        // 固件上报的状态是权威值：任何成功的 get_config（含 raw / 校准后刷新）都同步状态。
        self.set_state(config.state).await;
        Ok(config)
    }

    /// 刷新配置缓存；失败时失效缓存并返回原始错误，调用方不得静默成功。
    pub async fn refresh_config_cache(self: &Arc<Self>) -> Result<MotorConfig, MotorError> {
        match self.load_config().await {
            Ok(config) => Ok(config),
            Err(e) => {
                warn!("failed to refresh motor config cache: {e}");
                *self.motor_config.lock().await = None;
                Err(e)
            }
        }
    }

    /// Stop any stream left running by a previous client before reading config.
    pub async fn initialize(self: &Arc<Self>) -> Result<MotorConfig, MotorError> {
        self.set_telemetry_mode(TelemetryMode::None).await?;
        self.load_config().await
    }

    /// 写配置命令：仅 Ready 可用，收到 ok 后按固件确认值刷新缓存。
    pub async fn send_config_command(
        self: &Arc<Self>,
        config_cmd: &MotorConfigCommand,
    ) -> Result<(), MotorError> {
        self.transact(
            COMMAND_TIMEOUT,
            |state| prepare_config_command(config_cmd, state),
            |_| Ok(()),
        )
        .await?;
        // 写入已被固件接受；读回失败必须显式报错并失效缓存，不能当作成功。
        self.refresh_config_cache()
            .await
            .map_err(|e| MotorError::ConfigRefreshFailed(e.to_string()))?;
        Ok(())
    }

    /// 运行/停机/清故障命令：仅收到 ok 后才更新电机状态。
    pub async fn send_running_command(
        self: &Arc<Self>,
        run_cmd: &MotorRunCommand,
    ) -> Result<(), MotorError> {
        self.transact(
            COMMAND_TIMEOUT,
            |state| prepare_run_command(run_cmd, state),
            |_| Ok(()),
        )
        .await
    }

    /// 启动校准并处理固件异步上报的分隔块，直到终态块的结束分隔线。
    ///
    /// 等待期间不持有状态锁；失败时按固件上报的状态回写（不伪造 Ready），
    /// 边界不确定（超时/丢行）时关闭串口而不是继续猜回包。
    pub async fn calibration(self: &Arc<Self>) -> Result<CalibrationState, MotorError> {
        let guard = self.request_lock.lock().await;

        let state = *self.state.lock().await;
        if !state.allows_calibration() {
            return Err(MotorError::InvalidState(format!(
                "calibration is only allowed in Ready state, current state {state}"
            )));
        }
        let command = MotorCalibrationCommand::Calibration
            .to_string(&state)
            .ok_or_else(|| {
                MotorError::InvalidState(format!("calibration not allowed in state {state}"))
            })?;

        let mut rx = self.serial.recv_event_tx.subscribe();
        self.emit_sent(&command);
        self.serial
            .send(&command)
            .await
            .map_err(MotorError::SerialError)?;

        let mut parser = CalibrationParser::new();
        let mut started = false;
        let mut parse_error: Option<String> = None;
        let mut reported_state: Option<MotorState> = None;

        let wait = timeout(CALIBRATION_TIMEOUT, async {
            loop {
                let line = match rx.recv().await {
                    Ok(line) => line,
                    Err(broadcast::error::RecvError::Lagged(n)) => {
                        return WaitOutcome::Uncertain(MotorError::SerialError(format!(
                            "serial receive lagged, {n} lines dropped"
                        )));
                    }
                    Err(broadcast::error::RecvError::Closed) => {
                        return WaitOutcome::Failed(MotorError::Disconnected);
                    }
                };
                if line == DISCONNECTED_SENTINEL {
                    return WaitOutcome::Failed(MotorError::Disconnected);
                }

                if !started {
                    // 启动阶段的 `ok` / `error ...` 与后续异步块分开处理。
                    match classify_ack(&line) {
                        Some(Ack::Ok) => {
                            started = true;
                            self.set_state(MotorState::Calibration).await;
                        }
                        Some(Ack::Error(reason)) => {
                            return WaitOutcome::Failed(MotorError::FirmwareError(reason));
                        }
                        None => {}
                    }
                    continue;
                }

                match parser.parse(&line) {
                    Ok(true) => self.emit_calibration_state(&parser.state),
                    Ok(false) => {}
                    Err(e) => {
                        if parse_error.is_none() {
                            parse_error = Some(e);
                        }
                    }
                }

                // 报告中的 state 行是权威值：出现即同步（失败时通常为 Fault）。
                if let Some(motor_state) = parser.state.motor_state {
                    if reported_state != Some(motor_state) {
                        reported_state = Some(motor_state);
                        self.set_state(motor_state).await;
                    }
                }

                // 结束分隔线不再改变 payload，必须每行都检查；只有 success 才算成功。
                if parser.is_done() {
                    return if parser.state.status == CalibrationStatus::Success {
                        WaitOutcome::Ack
                    } else {
                        WaitOutcome::Failed(MotorError::CalibrationError(
                            match &parser.state.failed_stage {
                                Some(stage) => format!("calibration failed at stage {stage}"),
                                None => "calibration failed".to_string(),
                            },
                        ))
                    };
                }
            }
        })
        .await;

        // 超时同样是“回包边界未知”：保留最后已知状态，关闭端口且不伪造 Ready。
        let outcome = match wait {
            Ok(outcome) => outcome,
            Err(_) => WaitOutcome::Uncertain(MotorError::Timeout),
        };

        let must_close = matches!(outcome, WaitOutcome::Uncertain(_));
        let result = match outcome {
            // 成功终态必须带固件上报的 state；缺失即解析失败，保留最后已知状态。
            WaitOutcome::Ack => match parser.state.motor_state {
                Some(_) => Ok(()),
                None => Err(MotorError::ParseError(
                    "calibration succeeded without a motor state report".to_string(),
                )),
            },
            WaitOutcome::Failed(e) => Err(e),
            WaitOutcome::Uncertain(e) => Err(e),
        };

        let report = parser.state.clone();

        // 成功或失败都要把最终 payload 送达前端（含 failed_stage / results）。
        self.emit_calibration_state(&report);

        if must_close {
            // 边界不确定：保持 request_lock 直到关闭完成，避免下一条请求挤进错配窗口。
            self.close_on_uncertain_boundary().await;
        }

        drop(guard);

        match result {
            Ok(()) => {
                if let Some(e) = parse_error {
                    return Err(MotorError::ParseError(e));
                }
                // 校准成功后固件会自动保存配置：读回失败必须显式报错。
                self.refresh_config_cache()
                    .await
                    .map_err(|e| MotorError::ConfigRefreshFailed(e.to_string()))?;
                Ok(report)
            }
            Err(e) => Err(e),
        }
    }

    /// 原始控制台：只允许单行命令，受支持的命令走正常生命周期以保持状态/缓存正确。
    pub async fn send_raw_command(self: &Arc<Self>, input: &str) -> Result<(), MotorError> {
        if input.contains('\r') || input.contains('\n') {
            return Err(MotorError::InvalidParameter(
                "command must be a single line without CRLF".to_string(),
            ));
        }
        let command = input.trim();
        if command.is_empty() {
            return Err(MotorError::InvalidParameter("command is empty".to_string()));
        }

        if let Some(mode) = TelemetryMode::from_command(command) {
            return self.set_telemetry_mode(mode).await;
        }

        match command {
            "calibration" => return self.calibration().await.map(|_| ()),
            "stop" => return self.send_running_command(&MotorRunCommand::Stop).await,
            "clear_fault" => {
                return self
                    .send_running_command(&MotorRunCommand::ClearFault)
                    .await
            }
            "get_config" => {
                self.load_config().await?;
                return Ok(());
            }
            _ => {}
        }

        if let Some(config) = parse_raw_config_command(command)? {
            return self.send_config_command(&config).await;
        }

        let name = command.split_whitespace().next().unwrap_or_default();
        match name {
            "set_speed" => {
                let speed = parse_raw_value(command, "set_speed")?;
                return self
                    .send_running_command(&MotorRunCommand::SetSpeed(speed))
                    .await;
            }
            "set_position" => {
                let position = parse_raw_value(command, "set_position")?;
                return self
                    .send_running_command(&MotorRunCommand::SetPosition(position))
                    .await;
            }
            "set_current" => {
                let current = parse_raw_value(command, "set_current")?;
                return self
                    .send_running_command(&MotorRunCommand::SetCurrent(current))
                    .await;
            }
            _ => {}
        }

        let line = format!("{command}\r\n");
        self.transact(COMMAND_TIMEOUT, move |_state| Ok((line, None)), |_| Ok(()))
            .await?;

        if name.starts_with("config_") {
            // 配置写命令会改动固件配置：确认后刷新缓存，读回失败必须显式报错。
            self.refresh_config_cache()
                .await
                .map_err(|e| MotorError::ConfigRefreshFailed(e.to_string()))?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config_parser::{EncoderDirection, EncoderType};

    /// 回包优先级：只有完整 `ok` / `error <reason>` 行才是结束标记。
    #[test]
    fn classifies_ack_lines() {
        assert!(matches!(classify_ack("ok"), Some(Ack::Ok)));

        match classify_ack("error parameter") {
            Some(Ack::Error(reason)) => assert_eq!(reason, "parameter"),
            _ => panic!("`error parameter` must be a firmware error"),
        }
        match classify_ack("error") {
            Some(Ack::Error(reason)) => assert_eq!(reason, "unspecified"),
            _ => panic!("bare `error` must be a firmware error"),
        }

        // 数据行与无关行不得被当作结束标记。
        assert!(classify_ack("state Ready").is_none());
        assert!(classify_ack("calibration_status running").is_none());
        assert!(classify_ack("errors noted").is_none());
    }

    fn position_pid(kp: f32, ki: f32, kd: f32, output_max: f32) -> MotorConfigCommand {
        MotorConfigCommand::ConfigPositionPid {
            kp,
            ki,
            kd,
            output_max,
        }
    }

    /// 固件 setter 的取值范围必须在本地就被拒绝，避免发出必然失败的请求。
    #[test]
    fn rejects_out_of_range_config_values() {
        assert!(validate_config_command(&position_pid(3.0, 3.0, 0.0, 2000.0)).is_ok());
        assert!(validate_config_command(&position_pid(0.0, 3.0, 0.0, 2000.0)).is_err());
        assert!(validate_config_command(&position_pid(3.0, 3.0, -1.0, 2000.0)).is_err());
        assert!(validate_config_command(&position_pid(3.0, 3.0, 0.0, 0.0)).is_err());
        assert!(validate_config_command(&position_pid(f32::NAN, 3.0, 0.0, 2000.0)).is_err());

        assert!(validate_config_command(&MotorConfigCommand::ConfigSpeedPi {
            kp: 0.03,
            ki: 0.8,
            output_max: 2.0,
        })
        .is_ok());
        assert!(validate_config_command(&MotorConfigCommand::ConfigSpeedPi {
            kp: 0.03,
            ki: 0.8,
            output_max: -1.0,
        })
        .is_err());

        assert!(validate_config_command(&MotorConfigCommand::ConfigSpeedSweepCurrent(0.5)).is_ok());
        assert!(
            validate_config_command(&MotorConfigCommand::ConfigSpeedSweepCurrent(0.0)).is_err()
        );
        assert!(
            validate_config_command(&MotorConfigCommand::ConfigSpeedSweepCurrent(-0.5)).is_err()
        );
        assert!(
            validate_config_command(&MotorConfigCommand::ConfigSpeedSweepCurrent(f32::NAN))
                .is_err()
        );

        assert!(validate_config_command(&MotorConfigCommand::ConfigCurrentPi {
            d_kp: 0.4,
            d_ki: 186.0,
            q_kp: 0.3,
            q_ki: 150.0,
        }).is_ok());

        assert!(validate_config_command(&MotorConfigCommand::ConfigId(0)).is_ok());
        assert!(validate_config_command(&MotorConfigCommand::ConfigId(MAX_MOTOR_ID)).is_ok());
        assert!(validate_config_command(&MotorConfigCommand::ConfigId(MAX_MOTOR_ID + 1)).is_err());
        assert!(validate_config_command(&MotorConfigCommand::ConfigId(u32::MAX)).is_err());
    }

    #[test]
    fn current_pi_rejects_invalid_gains_on_each_axis() {
        for axis in 0..4 {
            for invalid in [0.0, -0.1, f32::NAN, f32::INFINITY, f32::NEG_INFINITY] {
                let mut gains = [0.4, 180.0, 0.3, 150.0];
                gains[axis] = invalid;
                let config = MotorConfigCommand::ConfigCurrentPi {
                    d_kp: gains[0],
                    d_ki: gains[1],
                    q_kp: gains[2],
                    q_ki: gains[3],
                };
                assert!(matches!(
                    prepare_config_command(&config, &MotorState::Ready),
                    Err(MotorError::InvalidParameter(_))
                ));
                assert!(config.to_string(&MotorState::Ready).is_none());
            }
        }
    }

    #[test]
    fn current_limit_requires_positive_finite_value_and_ready() {
        for invalid in [0.0, -1.0, f32::NAN, f32::INFINITY, f32::NEG_INFINITY] {
            let config = MotorConfigCommand::ConfigCurrentLimit(invalid);
            assert!(matches!(
                prepare_config_command(&config, &MotorState::Ready),
                Err(MotorError::InvalidParameter(_))
            ));
            assert!(config.to_string(&MotorState::Ready).is_none());
        }
        for value in [f32::MIN_POSITIVE, 1.0, f32::MAX] {
            let config = MotorConfigCommand::ConfigCurrentLimit(value);
            assert!(prepare_config_command(&config, &MotorState::Ready).is_ok());
        }
        for state in [
            MotorState::Initialization,
            MotorState::Calibration,
            MotorState::CurrentControl,
            MotorState::SpeedControl,
            MotorState::PositionControl,
            MotorState::Fault,
            MotorState::Unknown,
        ] {
            for config in [
                MotorConfigCommand::ConfigCurrentLimit(10.0),
                MotorConfigCommand::ConfigCurrentPi { d_kp: 0.4, d_ki: 180.0, q_kp: 0.3, q_ki: 150.0 },
            ] {
                assert!(matches!(
                    prepare_config_command(&config, &state),
                    Err(MotorError::InvalidState(_))
                ));
                assert!(config.to_string(&state).is_none());
            }
        }
    }

    #[test]
    fn raw_current_configuration_rejects_old_arity_and_invalid_values() {
        for input in [
            "config_current_pi",
            "config_current_pi 0.4 180",
            "config_current_pi 0.4 180 0.3",
            "config_current_pi 0.4 180 0.3 150 extra",
            "config_current_pi 0.4 invalid 0.3 150",
            "config_current_limit",
            "config_current_limit 1 2",
            "config_speed_sweep_current 1 2",
        ] {
            assert!(matches!(parse_raw_config_command(input), Err(MotorError::InvalidParameter(_))));
        }
        for input in [
            "config_current_pi 0.4 180 0.3 150",
            "config_current_limit 10",
            "config_speed_sweep_current 0.5",
        ] {
            let config = parse_raw_config_command(input).unwrap().unwrap();
            assert!(prepare_config_command(&config, &MotorState::Ready).is_ok());
            assert!(matches!(prepare_config_command(&config, &MotorState::Fault), Err(MotorError::InvalidState(_))));
        }
        for input in [
            "config_current_pi 0 180 0.3 150",
            "config_current_pi 0.4 180 NaN 150",
            "config_current_pi 0.4 180 0.3 -1",
            "config_current_limit 0",
            "config_current_limit inf",
            "config_speed_sweep_current -0.5",
        ] {
            let result = parse_raw_config_command(input).and_then(|config| {
                prepare_config_command(&config.unwrap(), &MotorState::Ready)
            });
            assert!(matches!(result, Err(MotorError::InvalidParameter(_))));
        }
    }

    #[test]
    fn rejects_unwritable_encoder_values() {
        let encoder =
            |pole_pairs: u32, direction: EncoderDirection, offset: f32, ty: EncoderType| {
                MotorConfigCommand::ConfigEncoder {
                    pole_pairs,
                    encoder_direction: direction,
                    encoder_offset: offset,
                    encoder_type: ty,
                }
            };

        assert!(validate_config_command(&encoder(
            7,
            EncoderDirection::CCW,
            1.6083,
            EncoderType::MT6701SPI
        ))
        .is_ok());
        assert!(validate_config_command(&encoder(
            0,
            EncoderDirection::CCW,
            0.0,
            EncoderType::AS5600
        ))
        .is_err());
        assert!(validate_config_command(&encoder(
            256,
            EncoderDirection::CCW,
            0.0,
            EncoderType::AS5600
        ))
        .is_err());
        assert!(validate_config_command(&encoder(
            7,
            EncoderDirection::None,
            0.0,
            EncoderType::AS5600
        ))
        .is_err());
        assert!(
            validate_config_command(&encoder(7, EncoderDirection::CW, 0.0, EncoderType::None))
                .is_err()
        );
        assert!(validate_config_command(&encoder(
            7,
            EncoderDirection::CW,
            f32::INFINITY,
            EncoderType::AS5600
        ))
        .is_err());
    }

    #[test]
    fn parses_raw_reference_arguments() {
        assert_eq!(
            parse_raw_value("set_speed 100", "set_speed").unwrap(),
            100.0
        );
        assert!(parse_raw_value("set_speed", "set_speed").is_err());
        assert!(parse_raw_value("set_speed 1 2", "set_speed").is_err());
        assert!(parse_raw_value("set_speed NaN", "set_speed").is_err());
        assert!(parse_raw_value("set_speed abc", "set_speed").is_err());
    }
}
