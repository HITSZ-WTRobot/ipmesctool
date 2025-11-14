use crate::command::{MotorCalibrationCommand, MotorConfigCommand, MotorFeedbackCommand, MotorRunCommand, MotorState};
use crate::config_parser::{ConfigParser, MotorConfig};
use crate::error::MotorError;
use crate::serial::SerialDevice;
use log::{error, warn};
use scan_fmt::scan_fmt;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;
use tokio::time::{timeout, Duration};

// const MAX_HISTORY: usize = 100000;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Timestamped<T> {
    pub timestamp: u64, // 毫秒
    pub value: T,
}

impl<T> Timestamped<T> {
    pub fn new(value: T) -> Self {
        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;
        Self { timestamp: ts, value }
    }
}


#[derive(Debug, Copy, Clone, PartialEq, Eq)]
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

    // pub speed_history: Mutex<VecDeque<Timestamped<f32>>>,
    // pub position_history: Mutex<VecDeque<Timestamped<f32>>>,
    // pub current_history: Mutex<VecDeque<Timestamped<(f32, f32, f32)>>>,
    // pub udc_history: Mutex<VecDeque<Timestamped<f32>>>,
}
impl Motor {
    pub fn new(serial: Arc<SerialDevice>, app: AppHandle) -> Self {
        Self {
            serial,
            state: Mutex::new(MotorState::Stop),
            feedback: Mutex::new(MotorFeedbackState::None),
            motor_config: Mutex::new(None),
            app,
            // speed_history: Mutex::new(VecDeque::with_capacity(MAX_HISTORY)),
            // position_history: Mutex::new(VecDeque::with_capacity(MAX_HISTORY)),
            // current_history: Mutex::new(VecDeque::with_capacity(MAX_HISTORY)),
            // udc_history: Mutex::new(VecDeque::with_capacity(MAX_HISTORY)),
        }
    }

    async fn send_command(&self, cmd: String) -> Result<(), MotorError> {
        self.serial.send(cmd.as_str()).await.map_err(|e| MotorError::SerialError(e))
    }

    pub async fn set_feedback(&self, new_feedback: MotorFeedbackState) -> Result<(), MotorError> {
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

    pub async fn get_config(&self) -> Result<MotorConfig, MotorError> {
        let mut feedback = self.feedback.lock().await;
        let cmd = MotorFeedbackCommand::GetConfig.to_string();
        self.send_command(cmd).await?;
        let mut rx = self.serial.recv_event_tx.subscribe();
        // 待解析的数据
        let mut config_parser = ConfigParser::default();
        let mut section = String::new();
        let duration = Duration::from_secs(3);
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
                        *feedback = MotorFeedbackState::None;
                        *config = Some(motor_config.clone());
                        Ok(motor_config)
                    }
                    Err(e) => Err(MotorError::ParseError(e.to_string()))
                },
            Err(_) => Err(MotorError::Timeout),
        }
    }

    pub async fn send_running_command(&self, run_cmd: &MotorRunCommand) -> Result<(), MotorError> {
        let mut state = self.state.lock().await;
        if let Some(line) = run_cmd.to_string(&state) {
            self.send_command(line).await
        } else {
            Err(MotorError::InvalidState("cannot send command in current state".into()))
        }?;
        match run_cmd {
            MotorRunCommand::Stop => *state = MotorState::Stop,
            _ => *state = MotorState::DebugRun,
        }
        Ok(())
    }

    pub async fn send_config_command(&self, config_cmd: &MotorConfigCommand) -> Result<(), MotorError> {
        let state = self.state.lock().await;
        if let Some(line) = config_cmd.to_string(&state) {
            self.send_command(line).await
        } else {
            Err(MotorError::InvalidState("cannot send command in current state".into()))
        }
    }

    pub async fn calibration(&self) -> Result<(), MotorError> {
        let mut state = self.state.lock().await;
        if let Some(line) = MotorCalibrationCommand::Calibration.to_string(&state) {
            self.send_command(line).await?;
            *state = MotorState::Test;
            drop(state);
            // TODO: 等待校准完成
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

    async fn parse_feedback_loop(&self) -> Result<(), MotorError> {
        let mut rx = self.serial.recv_event_tx.subscribe();

        // 循环解析串口消息
        loop {
            let current_feedback = {
                let fb = self.feedback.lock().await;
                *fb
            };
            // 如果没有反馈数据，就简单等待然后退出
            if current_feedback == MotorFeedbackState::None {
                tokio::time::sleep(Duration::from_millis(10)).await;
                continue;
            }
            // 等待单条串口消息
            let line_result = timeout(Duration::from_secs(3), rx.recv()).await;

            match line_result {
                Ok(Ok(line)) => {
                    let line = line.trim();
                    if line.is_empty() {
                        continue;
                    }
                    match current_feedback {
                        MotorFeedbackState::Speed => {
                            if let Ok(speed) = scan_fmt!(line, "speed: {}", f32) {
                                if let Err(e) = self.app.emit("push_speed", Timestamped::new(speed)) {
                                    error!("Tauri emit error {e}");
                                }
                            } else {
                                warn!("Failed to parse speed feedback: {}", line);
                                continue;
                            }
                        }
                        MotorFeedbackState::Position => {
                            if let Ok(position) = scan_fmt!(line, "position: {}", f32) {
                                if let Err(e) = self.app.emit("push_position", Timestamped::new(position)) {
                                    error!("Tauri emit error {e}");
                                }
                            } else {
                                warn!("Failed to parse position feedback: {}", line);
                                continue;
                            }
                        }
                        MotorFeedbackState::Current => {
                            if let Ok((ia, ib, ic)) = scan_fmt!(line, "iabc:{},{},{}", f32, f32, f32) {
                                if let Err(e) = self.app.emit("push_current", Timestamped::new((ia, ib, ic))) {
                                    error!("Tauri emit error {e}");
                                }
                            } else {
                                warn!("Failed to parse current feedback: {}", line);
                                continue;
                            }
                        }
                        MotorFeedbackState::Udc => {
                            if let Ok(udc) = scan_fmt!(line, "udc: {}", f32) {
                                if let Err(e) = self.app.emit("push_udc", Timestamped::new(udc)) {
                                    error!("Tauri emit error {e}");
                                }
                            } else {
                                warn!("Failed to parse udc feedback: {}", line);
                                continue;
                            }
                        }
                        MotorFeedbackState::None => {}
                    }
                }
                Ok(Err(_)) => {
                    // recv 错误，通常是广播关闭
                    return Err(MotorError::SerialError("broadcast closed.".to_string()));
                }
                Err(_) => {
                    // 超时
                    // 可以选择忽略继续循环，或者返回错误
                    continue;
                }
            }
        }
    }
}