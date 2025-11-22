use crate::command::MotorConfigCommand;
use crate::config_parser::{EncoderDirection, EncoderType, MotorConfig};
use crate::motor::{Motor, MotorFeedbackState};
use crate::serial::SerialDevice;
use std::sync::atomic::Ordering;
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
pub async fn get_motor_port(state: tauri::State<'_, AppState>) -> Result<String, ()> {
    match state.motor.lock().await.as_ref() {
        Some(motor) => Ok(motor.serial.port_name.clone()),
        None => Err(()),
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
        let config = motor.motor_config.lock().await;
        if let Some(config) = (*config).as_ref() {
            // 如果配置已存在就直接返回
            Ok(config.clone())
        } else {
            drop(config);
            // 否则先加载再返回
            motor.load_config().await.map_err(|e| e.to_string())
        }
    } else {
        Err("Motor is not connected".to_string())
    }
}

#[tauri::command]
pub async fn refresh_motor_config(state: tauri::State<'_, AppState>) -> Result<MotorConfig, String> {
    let motor_guard = state.motor.lock().await;
    if let Some(motor) = motor_guard.as_ref() {
        motor.load_config().await.map_err(|e| e.to_string())
    } else {
        Err("Motor is not connected".to_string())
    }
}

#[tauri::command]
pub async fn config_motor_position_pid(kp: f32, ki: f32, kd: f32, output_max: f32, state: tauri::State<'_, AppState>) -> Result<(), String> {
    let motor_guard = state.motor.lock().await;
    if let Some(motor) = motor_guard.as_ref() {
        motor.send_config_command(
            &MotorConfigCommand::ConfigPositionPid { kp, ki, kd, output_max },
        ).await.map_err(|e| e.to_string())
    } else {
        Err("Motor is not connected".to_string())
    }
}

#[tauri::command]
pub async fn config_motor_speed_pi(kp: f32, ki: f32, output_max: f32, state: tauri::State<'_, AppState>) -> Result<(), String> {
    let motor_guard = state.motor.lock().await;
    if let Some(motor) = motor_guard.as_ref() {
        motor.send_config_command(
            &MotorConfigCommand::ConfigSpeedPi { kp, ki, output_max },
        ).await.map_err(|e| e.to_string())
    } else {
        Err("Motor is not connected".to_string())
    }
}

#[tauri::command]
pub async fn config_motor_current_pi(id_kp: f32, id_ki: f32, iq_kp: f32, iq_ki: f32, state: tauri::State<'_, AppState>) -> Result<(), String> {
    let motor_guard = state.motor.lock().await;
    if let Some(motor) = motor_guard.as_ref() {
        motor.send_config_command(
            &MotorConfigCommand::ConfigCurrentPi { id_kp, id_ki, iq_kp, iq_ki },
        ).await.map_err(|e| e.to_string())
    } else {
        Err("Motor is not connected".to_string())
    }
}

#[tauri::command]
pub async fn config_motor_encoder(pole_pairs: u32, encoder_direction: EncoderDirection, encoder_offset: f32, encoder_type: EncoderType, state: tauri::State<'_, AppState>) -> Result<(), String> {
    let motor_guard = state.motor.lock().await;
    if let Some(motor) = motor_guard.as_ref() {
        motor.send_config_command(
            &MotorConfigCommand::ConfigEncoder { pole_pairs, encoder_direct: encoder_direction as i8, encoder_offset, encoder_type: encoder_type.to_string() },
        ).await.map_err(|e| e.to_string())
    } else {
        Err("Motor is not connected".to_string())
    }
}

#[tauri::command]
pub async fn motor_calibration(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let motor_guard = state.motor.lock().await;
    if let Some(motor) = motor_guard.as_ref() {
        motor.calibration().await.map_err(|e| e.to_string())
    } else {
        Err("Motor is not connected".to_string())
    }
}

#[tauri::command]
pub async fn is_motor_config_unsaved(state: tauri::State<'_, AppState>) -> Result<bool, String> {
    let motor_guard = state.motor.lock().await;
    if let Some(motor) = motor_guard.as_ref() {
        Ok(motor.unsaved.load(Ordering::Relaxed))
    } else {
        Err("Motor is not connected".to_string())
    }
}

#[tauri::command]
pub async fn save_motor_config(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let motor_guard = state.motor.lock().await;
    if let Some(motor) = motor_guard.as_ref() {
        motor.save_config().await.map_err(|e| e.to_string())
    } else {
        Err("Motor is not connected".to_string())
    }
}

#[tauri::command]
pub async fn config_motor_id(state: tauri::State<'_, AppState>, id: u8) -> Result<(), String> {
    let motor_guard = state.motor.lock().await;
    if let Some(motor) = motor_guard.as_ref() {
        motor.send_config_command(
            &MotorConfigCommand::ConfigId(id),
        ).await.map_err(|e| e.to_string())
    } else {
        Err("Motor is not connected".to_string())
    }
}