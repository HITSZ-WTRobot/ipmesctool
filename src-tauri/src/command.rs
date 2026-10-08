use serde::{Deserialize, Serialize};
use strum_macros::{Display, EnumString};

#[derive(Debug, Clone, Copy, Eq, PartialEq, EnumString, Display, Serialize, Deserialize)]
pub enum MotorState {
    Stop,
    DebugRun,
    Run,
    Test,
    Fault,
}

impl MotorState {
    fn is_stop(&self) -> bool {
        matches!(self, MotorState::Stop)
    }

    fn allows_run_command(&self) -> bool {
        matches!(self, MotorState::Stop | MotorState::DebugRun)
    }
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
                state.allows_run_command().then(|| format!("set_speed {}\r\n", speed))
            }
            MotorRunCommand::SetPosition(pos) => {
                state.allows_run_command().then(|| format!("set_position {}\r\n", pos))
            }
            MotorRunCommand::Stop => Some("stop\r\n".into()),
        }
    }
}

pub enum MotorConfigCommand {
    ConfigPositionPid { kp: f32, ki: f32, kd: f32, output_max: f32 },
    ConfigSpeedPi { kp: f32, ki: f32, output_max: f32 },
    ConfigCurrentPi { id_kp: f32, id_ki: f32, iq_kp: f32, iq_ki: f32 },
    ConfigIdqFilter(f32),
    ConfigEncoder { pole_pairs: u32, encoder_direct: i8, encoder_offset: f32, encoder_type: String },
    ConfigId(u8),
    ConfigUdc(f32),
}

impl MotorConfigCommand {
    pub fn to_string(&self, state: &MotorState) -> Option<String> {
        if !state.is_stop() {
            return None;
        }
        match self {
            MotorConfigCommand::ConfigPositionPid { kp, ki, kd, output_max } => {
                if *output_max <= 0f32 { return None; }
                Some(format!("config_position_pid {} {} {} {}\r\n", kp, ki, kd, output_max))
            }
            MotorConfigCommand::ConfigSpeedPi { kp, ki, output_max } => {
                if *output_max <= 0f32 { return None; }
                Some(format!("config_speed_pi {} {} {}\r\n", kp, ki, output_max))
            }
            MotorConfigCommand::ConfigCurrentPi { id_kp, id_ki, iq_kp, iq_ki } => {
                Some(format!("config_current_pi {id_kp} {id_ki} {iq_kp} {iq_ki}\r\n"))
            }
            MotorConfigCommand::ConfigIdqFilter(fc) => {
                Some(format!("config_idq_filter {}\r\n", fc))
            }
            MotorConfigCommand::ConfigEncoder { pole_pairs, encoder_direct, encoder_offset, encoder_type } => {
                Some(format!("config_encoder {} {} {} {}\r\n", pole_pairs, encoder_direct, encoder_offset, encoder_type))
            }
            MotorConfigCommand::ConfigId(id) => {
                Some(format!("config_id {}\r\n", id))
            }
            MotorConfigCommand::ConfigUdc(udc) => {
                Some(format!("config_udc {}\r\n", udc))
            }
        }
    }
}

pub struct MotorConfigSave;

impl MotorConfigSave {
    pub fn to_string(&self, state: &MotorState) -> Option<String> {
        state.is_stop().then(|| "save\r\n".into())
    }
}

pub enum MotorCalibrationCommand {
    Calibration,
}

impl MotorCalibrationCommand {
    pub fn to_string(&self, state: &MotorState) -> Option<String> {
        state.is_stop().then(|| "calibration\r\n".into())
    }
}