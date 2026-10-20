use crate::config_parser::{EncoderDirection, EncoderType};
use serde::{Deserialize, Serialize};
use strum_macros::{Display, EnumString};

/// GPMD_Code `motor_t::state_t` 的上位机映射。
///
/// 序列化字符串与固件 `get_motor_state_name` 输出一致；未知编号映射为 `Unknown`。
#[derive(Debug, Clone, Copy, Eq, PartialEq, EnumString, Display, Serialize, Deserialize)]
pub enum MotorState {
    Initialization,
    Calibration,
    CurrentControl,
    SpeedControl,
    PositionControl,
    Ready,
    Fault,
    Unknown,
}

impl MotorState {
    /// 配置写命令仅允许在 `Ready` 状态执行（固件要求）。
    pub fn allows_config(&self) -> bool {
        matches!(self, MotorState::Ready)
    }

    /// 运行/停机命令允许在 `Ready` 或任一闭环控制状态下执行。
    pub fn allows_run_command(&self) -> bool {
        matches!(
            self,
            MotorState::Ready
                | MotorState::CurrentControl
                | MotorState::SpeedControl
                | MotorState::PositionControl
        )
    }

    /// 校准启动仅允许在 `Ready` 状态执行。
    pub fn allows_calibration(&self) -> bool {
        matches!(self, MotorState::Ready)
    }

    /// 清除故障仅允许在 `Fault` 状态执行。
    pub fn allows_clear_fault(&self) -> bool {
        matches!(self, MotorState::Fault)
    }
}

/// 进入闭环或停机/清故障的运行命令。
pub enum MotorRunCommand {
    SetSpeed(f32),
    SetPosition(f32),
    SetCurrent(f32),
    Stop,
    ClearFault,
}

impl MotorRunCommand {
    /// 返回带 CRLF 的命令行；状态不允许或参数非有限值时返回 `None`。
    pub fn to_string(&self, state: &MotorState) -> Option<String> {
        match self {
            MotorRunCommand::SetSpeed(speed) => (state.allows_run_command() && speed.is_finite())
                .then(|| format!("set_speed {speed}\r\n")),
            MotorRunCommand::SetPosition(position) => (state.allows_run_command()
                && position.is_finite())
            .then(|| format!("set_position {position}\r\n")),
            MotorRunCommand::SetCurrent(current) => (state.allows_run_command()
                && current.is_finite())
            .then(|| format!("set_current {current}\r\n")),
            MotorRunCommand::Stop => state.allows_run_command().then(|| "stop\r\n".to_string()),
            MotorRunCommand::ClearFault => state
                .allows_clear_fault()
                .then(|| "clear_fault\r\n".to_string()),
        }
    }
}

/// 固件标准帧电机驱动 ID 上限（`motor.hpp` `k_max_id = 0x7FF`）。
///
/// CLI 的 `config_id` 按 uint32 解析参数，但 `motor_t::set_id` 拒绝大于该值的 ID，
/// 因此写命令必须在此范围内；读回（`get_config` 的 `id`）仍是完整 uint32。
pub const MAX_MOTOR_ID: u32 = 0x7FF;

/// 配置写命令（固件会自动保存，无独立 save 命令）。
pub enum MotorConfigCommand {
    ConfigPositionPid {
        kp: f32,
        ki: f32,
        kd: f32,
        output_max: f32,
    },
    ConfigSpeedPi {
        kp: f32,
        ki: f32,
        output_max: f32,
    },
    ConfigCurrentPi {
        kp: f32,
        ki: f32,
    },
    ConfigEncoder {
        pole_pairs: u32,
        encoder_direction: EncoderDirection,
        encoder_offset: f32,
        encoder_type: EncoderType,
    },
    ConfigId(u32),
}

impl MotorConfigCommand {
    /// 返回带 CRLF 的命令行；状态不是 `Ready` 或参数超出固件可写范围时返回 `None`。
    ///
    /// 浮点参数要求有限值；`ConfigId` 要求 ≤ [`MAX_MOTOR_ID`]；`pole_pairs` 要求
    /// 1..=255；方向与类型必须是固件 `config_encoder` 接受的取值（`None`/`Unknown` 不可写）。
    pub fn to_string(&self, state: &MotorState) -> Option<String> {
        if !state.allows_config() {
            return None;
        }
        match self {
            MotorConfigCommand::ConfigPositionPid { kp, ki, kd, output_max } => {
                (kp.is_finite() && ki.is_finite() && kd.is_finite() && output_max.is_finite())
                    .then(|| format!("config_position_pid {kp} {ki} {kd} {output_max}\r\n"))
            }
            MotorConfigCommand::ConfigSpeedPi { kp, ki, output_max } => {
                (kp.is_finite() && ki.is_finite() && output_max.is_finite())
                    .then(|| format!("config_speed_pi {kp} {ki} {output_max}\r\n"))
            }
            MotorConfigCommand::ConfigCurrentPi { kp, ki } => {
                (kp.is_finite() && ki.is_finite())
                    .then(|| format!("config_current_pi {kp} {ki}\r\n"))
            }
            MotorConfigCommand::ConfigEncoder {
                pole_pairs,
                encoder_direction,
                encoder_offset,
                encoder_type,
            } => ((1..=255).contains(pole_pairs)
                && encoder_direction.is_writable()
                && encoder_type.is_writable()
                && encoder_offset.is_finite())
            .then(|| {
                format!(
                    "config_encoder {pole_pairs} {encoder_direction} {encoder_offset} {encoder_type}\r\n"
                )
            }),
            MotorConfigCommand::ConfigId(id) => {
                (*id <= MAX_MOTOR_ID).then(|| format!("config_id {id}\r\n"))
            }
        }
    }
}

pub enum MotorCalibrationCommand {
    Calibration,
}

impl MotorCalibrationCommand {
    /// 返回带 CRLF 的命令行；仅 `Ready` 状态可启动校准。
    pub fn to_string(&self, state: &MotorState) -> Option<String> {
        state
            .allows_calibration()
            .then(|| "calibration\r\n".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_commands_require_ready_state() {
        let pid = MotorConfigCommand::ConfigPositionPid {
            kp: 1.0,
            ki: 2.0,
            kd: 0.0,
            output_max: 100.0,
        };
        assert!(pid.to_string(&MotorState::Ready).is_some());
        for state in [
            MotorState::Initialization,
            MotorState::Calibration,
            MotorState::CurrentControl,
            MotorState::SpeedControl,
            MotorState::PositionControl,
            MotorState::Fault,
            MotorState::Unknown,
        ] {
            assert!(
                pid.to_string(&state).is_none(),
                "config allowed in {state:?}"
            );
        }
    }

    #[test]
    fn run_commands_only_in_run_states() {
        let speed = MotorRunCommand::SetSpeed(100.0);
        let stop = MotorRunCommand::Stop;
        for state in [
            MotorState::Ready,
            MotorState::CurrentControl,
            MotorState::SpeedControl,
            MotorState::PositionControl,
        ] {
            assert!(
                speed.to_string(&state).is_some(),
                "speed rejected in {state:?}"
            );
            assert!(
                stop.to_string(&state).is_some(),
                "stop rejected in {state:?}"
            );
        }
        for state in [
            MotorState::Initialization,
            MotorState::Calibration,
            MotorState::Fault,
            MotorState::Unknown,
        ] {
            assert!(
                speed.to_string(&state).is_none(),
                "speed allowed in {state:?}"
            );
            assert!(
                stop.to_string(&state).is_none(),
                "stop allowed in {state:?}"
            );
        }
        assert!(MotorRunCommand::SetSpeed(f32::NAN)
            .to_string(&MotorState::Ready)
            .is_none());
        assert!(MotorRunCommand::SetCurrent(f32::INFINITY)
            .to_string(&MotorState::Ready)
            .is_none());
    }

    #[test]
    fn clear_fault_only_from_fault() {
        let clear = MotorRunCommand::ClearFault;
        assert!(clear.to_string(&MotorState::Fault).is_some());
        for state in [
            MotorState::Ready,
            MotorState::Initialization,
            MotorState::Calibration,
            MotorState::CurrentControl,
            MotorState::SpeedControl,
            MotorState::PositionControl,
            MotorState::Unknown,
        ] {
            assert!(
                clear.to_string(&state).is_none(),
                "clear_fault allowed in {state:?}"
            );
        }
    }

    #[test]
    fn calibration_only_from_ready() {
        let calibration = MotorCalibrationCommand::Calibration;
        assert!(calibration.to_string(&MotorState::Ready).is_some());
        assert!(calibration.to_string(&MotorState::Calibration).is_none());
        assert!(calibration.to_string(&MotorState::Fault).is_none());
    }

    #[test]
    fn encoder_write_rejects_unwritable_values() {
        let cmd = |pole_pairs, direction, offset, encoder_type| MotorConfigCommand::ConfigEncoder {
            pole_pairs,
            encoder_direction: direction,
            encoder_offset: offset,
            encoder_type,
        };
        assert!(cmd(7, EncoderDirection::CCW, 1.6, EncoderType::MT6701SPI)
            .to_string(&MotorState::Ready)
            .is_some());
        // 极对数越界与 0 均不可写。
        assert!(cmd(0, EncoderDirection::CW, 0.0, EncoderType::AS5600)
            .to_string(&MotorState::Ready)
            .is_none());
        assert!(cmd(256, EncoderDirection::CW, 0.0, EncoderType::AS5600)
            .to_string(&MotorState::Ready)
            .is_none());
        // 读回占位方向/类型不可写。
        assert!(cmd(7, EncoderDirection::None, 0.0, EncoderType::AS5600)
            .to_string(&MotorState::Ready)
            .is_none());
        assert!(cmd(7, EncoderDirection::CW, 0.0, EncoderType::None)
            .to_string(&MotorState::Ready)
            .is_none());
        assert!(cmd(7, EncoderDirection::CW, 0.0, EncoderType::Unknown)
            .to_string(&MotorState::Ready)
            .is_none());
        // 偏移必须有限。
        assert!(cmd(7, EncoderDirection::CW, f32::NAN, EncoderType::AS5600)
            .to_string(&MotorState::Ready)
            .is_none());
    }

    #[test]
    fn config_id_write_respects_firmware_max() {
        for id in [0, 1, MAX_MOTOR_ID] {
            assert!(
                MotorConfigCommand::ConfigId(id)
                    .to_string(&MotorState::Ready)
                    .is_some(),
                "id {id} must be writable"
            );
        }
        for id in [MAX_MOTOR_ID + 1, 0x800, u32::MAX] {
            assert!(
                MotorConfigCommand::ConfigId(id)
                    .to_string(&MotorState::Ready)
                    .is_none(),
                "id {id} exceeds firmware max and must be rejected"
            );
        }
        // 写入仍需 Ready 状态。
        assert!(MotorConfigCommand::ConfigId(1)
            .to_string(&MotorState::Fault)
            .is_none());
    }
}
