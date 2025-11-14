#[derive(Debug)]
pub enum MotorState {
    Stop,
    DebugRun,
    Run,
    Test,
    Fault,
}

pub enum MotorFeedbackCommand {
    GetSpeed,
    GetPosition,
    GetCurrent,
    GetUdc,
    GetConfig,
    GetNone,
}
impl MotorFeedbackCommand {
    pub fn to_string(&self) -> String {
        match self {
            MotorFeedbackCommand::GetSpeed => "get_speed\r\n".into(),
            MotorFeedbackCommand::GetPosition => "get_position\r\n".into(),
            MotorFeedbackCommand::GetCurrent => "get_current\r\n".into(),
            MotorFeedbackCommand::GetUdc => "get_udc\r\n".into(),
            MotorFeedbackCommand::GetConfig => "get_config\r\n".into(),
            MotorFeedbackCommand::GetNone => "get_none\r\n".into(),
        }
    }
}

pub enum MotorRunCommand {
    SetSpeed(f32),
    SetPosition(f32),
    Stop,
}
impl MotorRunCommand {
    pub fn to_string(&self, state: &MotorState) -> Option<String> {
        match self {
            MotorRunCommand::SetSpeed(speed) => {
                match state {
                    MotorState::Stop | MotorState::DebugRun => Some(format!("set_speed {}\r\n", speed)),
                    _ => None,
                }
            }
            MotorRunCommand::SetPosition(pos) => {
                match state {
                    MotorState::Stop | MotorState::DebugRun => Some(format!("set_position {}\r\n", pos)),
                    _ => None,
                }
            }
            MotorRunCommand::Stop => Some("stop\r\n".into()),
        }
    }
}

pub enum MotorConfigCommand {
    ConfigPositionPid { kp: f32, ki: f32, kd: f32, output_max: f32 },
    ConfigSpeedPi { kp: f32, ki: f32, output_max: f32 },
    ConfigCurrentPi { kp: f32, ki: f32 },
    ConfigIdqFilter(f32),
    ConfigEncoder { pole_pairs: u32, encoder_direct: i32, encoder_offset: f32, encoder_type: String },
    ConfigId(u8),
    ConfigUdc(f32),
    Save,
}

impl MotorConfigCommand {
    pub fn to_string(&self, state: &MotorState) -> Option<String> {
        match self {
            MotorConfigCommand::ConfigPositionPid { kp, ki, kd, output_max } => {
                if output_max <= &0f32 {
                    None
                } else {
                    match state {
                        MotorState::Stop => Some(format!("config_position_pid {} {} {} {}\r\n", kp, ki, kd, output_max)),
                        _ => None,
                    }
                }
            }

            MotorConfigCommand::ConfigSpeedPi { kp, ki, output_max } => {
                if output_max <= &0f32 {
                    None
                } else {
                    match state {
                        MotorState::Stop => Some(format!("config_speed_pi {} {} {}\r\n", kp, ki, output_max)),
                        _ => None,
                    }
                }
            }

            MotorConfigCommand::ConfigCurrentPi { kp, ki } => {
                match state {
                    MotorState::Stop => Some(format!("config_current_pi {} {}\r\n", kp, ki)),
                    _ => None,
                }
            }

            MotorConfigCommand::ConfigIdqFilter(fc) => {
                match state {
                    MotorState::Stop => Some(format!("config_idq_filter {}\r\n", fc)),
                    _ => None,
                }
            }

            MotorConfigCommand::ConfigEncoder { pole_pairs, encoder_direct, encoder_offset, encoder_type } => {
                match state {
                    MotorState::Stop => Some(format!("config_encoder {} {} {} {}\r\n", pole_pairs, encoder_direct, encoder_offset, encoder_type)),
                    _ => None,
                }
            }

            MotorConfigCommand::ConfigId(id) => {
                match state {
                    MotorState::Stop => Some(format!("config_id {}\r\n", id)),
                    _ => None,
                }
            }

            MotorConfigCommand::ConfigUdc(udc) => {
                match state {
                    MotorState::Stop => Some(format!("config_udc {}\r\n", udc)),
                    _ => None,
                }
            }

            MotorConfigCommand::Save => {
                match state {
                    MotorState::Stop => Some("save\r\n".into()),
                    _ => None,
                }
            }
        }
    }
}

pub enum MotorCalibrationCommand {
    Calibration
}

impl MotorCalibrationCommand {
    pub fn to_string(&self, state: &MotorState) -> Option<String> {
        match self {
            MotorCalibrationCommand::Calibration => {
                match state {
                    MotorState::Stop => Some("calibration\r\n".into()),
                    _ => None,
                }
            }
        }
    }
}