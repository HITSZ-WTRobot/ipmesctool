use thiserror::Error;

#[derive(Error, Debug)]
pub enum MotorError {
    #[error("serial port error: {0}")]
    SerialError(String),
    #[error("parse error: {0}")]
    ParseError(String),
    #[error("invalid state: {0}")]
    InvalidState(String),
    #[error("invalid parameter: {0}")]
    InvalidParameter(String),
    /// 固件显式回包 `error <reason>`，reason 原样保留。
    #[error("firmware error: {0}")]
    FirmwareError(String),
    /// 固件已接受命令（收到 `ok`），但随后读回确认配置失败。
    #[error("command accepted but config refresh failed: {0}")]
    ConfigRefreshFailed(String),
    #[error("calibration failed: {0}")]
    CalibrationError(String),
    #[error("timeout")]
    Timeout,
    #[error("disconnected")]
    Disconnected,
}
