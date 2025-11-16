use crate::config_parser::MotorConfig;
use crate::motor::{Motor, MotorFeedbackState};
use crate::serial::SerialDevice;
use std::sync::Arc;
use tauri::AppHandle;
use tokio::sync::Mutex;

pub struct AppState {
    pub app: AppHandle,
    pub motor: Arc<Mutex<Option<Arc<Motor>>>>,
}

#[tauri::command]
pub async fn list_serial_ports() -> Result<Vec<String>, String> {
    let ports = tokio_serial::available_ports()
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|p| p.port_name)
        .collect();
    Ok(ports)
}

#[tauri::command]
pub async fn connect_motor(port_name: String, baud_rate: u32, state: tauri::State<'_, AppState>) -> Result<(), String> {
    let mut motor_guard = state.motor.lock().await;
    if motor_guard.is_some() {
        Err(format!("Motor is already connected in port {}", motor_guard.as_ref().unwrap().serial.port_name))
    } else {
        let port = SerialDevice::new(port_name, baud_rate);
        port.connect().await?;
        let motor = Motor::new(port, state.app.clone());
        motor.start_parse_feedback_loop().await;
        *motor_guard = Some(motor);
        drop(motor_guard);
        Ok(())
    }
}

#[tauri::command]
pub async fn disconnect_motor(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let mut motor_guard = state.motor.lock().await;
    if let Some(motor) = motor_guard.take() {
        motor.serial.disconnect().await?;
        *motor_guard = None;
        Ok(())
    } else {
        Err("Motor is not connected".to_string())
    }
}

#[tauri::command]
pub async fn get_motor_state(state: tauri::State<'_, AppState>) -> Result<String, String> {
    let motor_guard = state.motor.lock().await;
    if let Some(motor) = motor_guard.as_ref() {
        let motor_state = motor.state.lock().await;
        Ok((*motor_state).to_string().clone())
    } else {
        Err("Motor is not connected".to_string())
    }
}

#[tauri::command]
pub async fn set_motor_feedback(state: tauri::State<'_, AppState>, feedback: MotorFeedbackState) -> Result<(), String> {
    let motor_guard = state.motor.lock().await;
    if let Some(motor) = motor_guard.as_ref() {
        motor.set_feedback(feedback).await.map_err(|e| e.to_string())
    } else {
        Err("Motor is not connected".to_string())
    }
}

#[tauri::command]
pub async fn get_motor_config(state: tauri::State<'_, AppState>) -> Result<MotorConfig, String> {
    let motor_guard = state.motor.lock().await;
    if let Some(motor) = motor_guard.as_ref() {
        motor.get_config().await.map_err(|e| e.to_string())
    } else {
        Err("Motor is not connected".to_string())
    }
}