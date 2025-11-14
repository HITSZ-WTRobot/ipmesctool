use thiserror::Error;

#[derive(Error, Debug)]
pub enum MotorError {
    #[error("serial port error: {0}")]
    SerialError(String),
    #[error("parse error: {0}")]
    ParseError(String),
    #[error("invalid state: {0}")]
    InvalidState(String),
    #[error("fault detected: {0}")]
    FaultDetected(String),
    #[error("timeout")]
    Timeout,
    #[error("emit event error: {0}")]
    TauriEmitError(tauri::Error),
}