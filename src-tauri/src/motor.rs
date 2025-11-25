use crate::calibration_parser::CalibrationParser;
use crate::command::{MotorCalibrationCommand, MotorConfigCommand, MotorConfigSave, MotorFeedbackCommand, MotorRunCommand, MotorState};
use crate::config_parser::{ConfigParser, MotorConfig};
use crate::error::MotorError;
use crate::exit_signal::ExitSignal;
use crate::serial::SerialDevice;
use log::{error, warn};
use scan_fmt::scan_fmt;
use serde::{Deserialize, Serialize};
use std::sync::atomic::Ordering::Relaxed;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
pub use tauri::{AppHandle, Emitter, Manager};
use tokio::select;
use tokio::sync::Mutex;
use tokio::task::JoinHandle;
use tokio::time::{timeout, Duration};
// const MAX_HISTORY: usize = 100000;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Timestamped<T> {
    pub timestamp: u64, // 毫秒
    pub value: T,
    pub r#type: String,
}

impl<T> Timestamped<T> {
    pub fn new(value: T, r#type: String) -> Self {
        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;
        Self { timestamp: ts, value, r#type }
    }
}


#[derive(Debug, Copy, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum MotorFeedbackState {
    None,
    Speed,
    Position,
    Current,
    Udc,
}

#[derive(Debug)]
pub struct Motor {
    pub serial: Arc<SerialDevice>,
    pub state: Mutex<MotorState>,
    pub feedback: Mutex<MotorFeedbackState>,
    pub motor_config: Mutex<Option<MotorConfig>>,
    pub app: AppHandle,
    pub unsaved: AtomicBool, // 是否有未保存的配置

    parser_feedback_handle: Mutex<Option<JoinHandle<()>>>,
    parser_feedback_exit_signal: Arc<ExitSignal>,

    // pub speed_history: Mutex<VecDeque<Timestamped<f32>>>,
    // pub position_history: Mutex<VecDeque<Timestamped<f32>>>,
    // pub current_history: Mutex<VecDeque<Timestamped<(f32, f32, f32)>>>,
    // pub udc_history: Mutex<VecDeque<Timestamped<f32>>>,
}
impl Motor {
    pub fn new(serial: Arc<SerialDevice>, app: AppHandle) -> Arc<Self> {
        Arc::new(Self {
            serial,
            state: Mutex::new(MotorState::Stop),
            feedback: Mutex::new(MotorFeedbackState::None),
            motor_config: Mutex::new(None),
            app,
            // speed_history: Mutex::new(VecDeque::with_capacity(MAX_HISTORY)),
            // position_history: Mutex::new(VecDeque::with_capacity(MAX_HISTORY)),
            // current_history: Mutex::new(VecDeque::with_capacity(MAX_HISTORY)),
            // udc_history: Mutex::new(VecDeque::with_capacity(MAX_HISTORY)),
            unsaved: AtomicBool::new(false),
            parser_feedback_handle: Default::default(),
            parser_feedback_exit_signal: ExitSignal::new(),
        })
    }

    async fn send_command(self: &Arc<Self>, cmd: String) -> Result<(), MotorError> {
        self.app.emit("serial-sent", &cmd).unwrap();
        self.serial.send(cmd.as_str()).await.map_err(|e| MotorError::SerialError(e))
    }

    pub async fn set_feedback(self: &Arc<Self>, new_feedback: MotorFeedbackState) -> Result<(), MotorError> {
        let mut feedback = self.feedback.lock().await;
        if *feedback == new_feedback {
            return Ok(());
        }
        let cmd = match new_feedback {
            MotorFeedbackState::None => MotorFeedbackCommand::GetNone.to_string(),
            MotorFeedbackState::Speed => MotorFeedbackCommand::GetSpeed.to_string(),
            MotorFeedbackState::Position => MotorFeedbackCommand::GetPosition.to_string(),
            MotorFeedbackState::Current => MotorFeedbackCommand::GetCurrent.to_string(),
            MotorFeedbackState::Udc => MotorFeedbackCommand::GetUdc.to_string(),
        };
        match self.send_command(cmd).await {
            Ok(()) => {
                *feedback = new_feedback;
                Ok(())
            }
            Err(e) => Err(e)
        }
    }

    /// 从下位机加载 config 并返回
    pub async fn load_config(self: &Arc<Self>) -> Result<MotorConfig, MotorError> {
        let mut feedback = self.feedback.lock().await;
        let cmd = MotorFeedbackCommand::GetConfig.to_string();
        self.send_command(cmd).await?;
        *feedback = MotorFeedbackState::None;
        // 发送之后立即释放 feedback
        drop(feedback);
        let mut rx = self.serial.recv_event_tx.subscribe();
        // 待解析的数据
        let mut config_parser = ConfigParser::default();
        let mut section = String::new();
        let duration = Duration::from_secs(5);
        let result = timeout(duration, async {
            while let Ok(line) = rx.recv().await {
                config_parser.parse_line(&line, &mut section);

                if config_parser.is_complete() {
                    break;
                }
            }
        }).await;
        match result {
            Ok(_) =>
                match config_parser.try_into_motor_config() {
                    Ok(motor_config) => {
                        let mut config = self.motor_config.lock().await;
                        *config = Some(motor_config.clone());
                        Ok(motor_config)
                    }
                    Err(e) => Err(MotorError::ParseError(e.to_string()))
                },
            Err(_) => Err(MotorError::Timeout),
        }
    }

    pub async fn send_running_command(self: &Arc<Self>, run_cmd: &MotorRunCommand) -> Result<(), MotorError> {
        let mut state = self.state.lock().await;
        if let Some(line) = run_cmd.to_string(&state) {
            self.send_command(line).await
        } else {
            Err(MotorError::InvalidState("cannot send command in current state".into()))
        }?;
        // 更新电机状态，Feedback 状态
        match run_cmd {
            MotorRunCommand::Stop => {
                *state = MotorState::Stop;
                *self.feedback.lock().await = MotorFeedbackState::None;
            }
            MotorRunCommand::SetPosition(_) => {
                *state = MotorState::DebugRun;
                *self.feedback.lock().await = MotorFeedbackState::Position;
            }
            MotorRunCommand::SetSpeed(_) => {
                *state = MotorState::DebugRun;
                *self.feedback.lock().await = MotorFeedbackState::Speed;
            }
        }
        // 向前端同步电机状态
        self.app.emit("motor-state-change", *state).unwrap();
        Ok(())
    }

    pub async fn send_config_command(self: &Arc<Self>, config_cmd: &MotorConfigCommand) -> Result<(), MotorError> {
        let state = self.state.lock().await;
        if let Some(line) = config_cmd.to_string(&state) {
            self.send_command(line).await?;
            self.unsaved.store(true, Relaxed);
            Ok(())
        } else {
            Err(MotorError::InvalidState("cannot send command in current state".into()))
        }
    }

    pub async fn save_config(self: &Arc<Self>) -> Result<(), MotorError> {
        if self.unsaved.load(Relaxed) {
            let state = self.state.lock().await;
            if let Some(line) = MotorConfigSave.to_string(&state) {
                self.send_command(line).await?;
                self.unsaved.store(false, Relaxed);
                Ok(())
            } else {
                Err(MotorError::InvalidState("cannot send command in current state".into()))
            }
        } else {
            Ok(())
        }
    }

    pub async fn calibration(self: &Arc<Self>) -> Result<(), MotorError> {
        let mut state = self.state.lock().await;
        if let Some(line) = MotorCalibrationCommand::Calibration.to_string(&state) {
            self.send_command(line).await?;
            *state = MotorState::Test;
            // 向前端同步状态
            self.app.emit("motor-state-change", MotorState::Test).unwrap();
            // TODO: 等待校准完成
            let mut rx = self.serial.recv_event_tx.subscribe();
            let duration = Duration::from_secs(120);
            let mut parser = CalibrationParser::new();
            let result = timeout(duration, async {
                while let Ok(line) = rx.recv().await {
                    match parser.parse(&line) {
                        Ok(_) => {
                            self.app.emit("calibration-state", &parser.0).unwrap();
                            if parser.is_done() {
                                return Ok(());
                            }
                        }
                        Err(e) => {
                            return Err(MotorError::CalibrationError(e.to_string()))
                        }
                    }
                }
                Err(MotorError::SerialError("recv error".into()))
            }).await;
            // 校准完成后（不管是成功还是失败）回到停止状态
            *state = MotorState::Stop;
            // 向前端同步状态
            self.app.emit("motor-state-change", MotorState::Stop).unwrap();
            // 不管是否成功都认为有未保存的数据
            self.unsaved.store(true, Relaxed);
            match result {
                Ok(Ok(_)) => {}
                Ok(Err(e)) => {
                    return Err(e);
                }
                Err(_) => {
                    return Err(MotorError::Timeout);
                }
            }
            Ok(())
        } else {
            Err(MotorError::InvalidState("cannot calibration in current state".into()))
        }
    }

    // pub async fn push_speed(&self, value: f32) {
    //     let mut hist = self.speed_history.lock().await;
    //     hist.push_back(Timestamped::new(value));
    //     if hist.len() > MAX_HISTORY { hist.pop_front(); }
    // }
    //
    // pub async fn push_position(&self, value: f32) {
    //     let mut hist = self.position_history.lock().await;
    //     hist.push_back(Timestamped::new(value));
    //     if hist.len() > MAX_HISTORY { hist.pop_front(); }
    // }
    //
    // pub async fn push_current(&self, value: (f32, f32, f32)) {
    //     let mut hist = self.current_history.lock().await;
    //     hist.push_back(Timestamped::new(value));
    //     if hist.len() > MAX_HISTORY { hist.pop_front(); }
    // }
    //
    // pub async fn push_udc(&self, value: f32) {
    //     let mut hist = self.udc_history.lock().await;
    //     hist.push_back(Timestamped::new(value));
    //     if hist.len() > MAX_HISTORY { hist.pop_front(); }
    // }

    pub async fn start_parse_feedback_loop(self: &Arc<Self>) {
        let this = Arc::clone(self);
        *self.parser_feedback_handle.lock().await = Some(tokio::spawn(async move {
            let _ = this.parse_feedback_loop().await;
        }));
    }

    pub async fn stop_parse_feedback_loop(self: &Arc<Self>) {
        self.parser_feedback_exit_signal.trigger();
        if let Some(handle) = self.parser_feedback_handle.lock().await.take() {
            let _ = handle.await;
        }
    }

    async fn parse_feedback_loop(self: Arc<Self>) {
        let mut rx = self.serial.recv_event_tx.subscribe();

        // 循环解析串口消息
        loop {
            // 等待单条串口消息，或中断退出
            select! {
                // 收到一行串口消息
                line_result = rx.recv() => {
                    let line_result = match line_result {
                        Ok(v) => v,
                        Err(_) => break, // channel 关闭
                    };

                    let line = line_result.trim();
                    if line.is_empty() {
                        continue;
                    }

                    if line == "__DISCONNECTED__" {
                        self.app.emit("motor-disconnected", ()).unwrap();
                        break;
                    }

                    self.app.emit("serial-received", line).unwrap();

                    let current_feedback = {
                        let fb = self.feedback.lock().await;
                        *fb
                    };

                    match current_feedback {
                        MotorFeedbackState::Speed => {
                            if let Ok(speed) = scan_fmt!(line, "speed: {}", f32) {
                                if let Err(e) = self.app.emit("motor_feedback_update", Timestamped::new(speed, "speed".to_string())) {
                                    error!("Tauri emit error {e}");
                                }
                            } else {
                                warn!("Failed to parse speed feedback: {}", line);
                                continue;
                            }
                        }
                        MotorFeedbackState::Position => {
                            if let Ok(position) = scan_fmt!(line, "position: {}", f32) {
                                if let Err(e) = self.app.emit("motor_feedback_update", Timestamped::new(position, "position".to_string())) {
                                    error!("Tauri emit error {e}");
                                }
                            } else {
                                warn!("Failed to parse position feedback: {}", line);
                                continue;
                            }
                        }
                        MotorFeedbackState::Current => {
                            if let Ok((ia, ib, ic)) = scan_fmt!(line, "iabc:{},{},{}", f32, f32, f32) {
                                if let Err(e) = self.app.emit("motor_feedback_update", Timestamped::new((ia, ib, ic), "iabc".to_string())) {
                                    error!("Tauri emit error {e}");
                                }
                            } else {
                                warn!("Failed to parse current feedback: {}", line);
                                continue;
                            }
                        }
                        MotorFeedbackState::Udc => {
                            if let Ok(udc) = scan_fmt!(line, "udc: {}", f32) {
                                if let Err(e) = self.app.emit("motor_feedback_update", Timestamped::new(udc, "udc".to_string())) {
                                    error!("Tauri emit error {e}");
                                }
                            } else {
                                warn!("Failed to parse udc feedback: {}", line);
                                continue;
                            }
                        }
                        MotorFeedbackState::None => { continue; }
                    }
                }
                _ = self.parser_feedback_exit_signal.wait() => return,
            }
        }
    }
}