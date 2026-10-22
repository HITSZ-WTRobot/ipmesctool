use crate::calibration_parser::CalibrationState;
use crate::command::{MotorConfigCommand, MotorRunCommand};
use crate::config_parser::{EncoderDirection, EncoderType, MotorConfig};
use crate::motor::{Motor, TelemetryState};
use crate::serial::SerialDevice;
use crate::telemetry::TelemetryMode;
use std::sync::Arc;
use tauri::AppHandle;
use tokio::sync::Mutex;

pub struct AppState {
    pub app: AppHandle,
    pub motor: Arc<Mutex<Option<Arc<Motor>>>>,
}

/// 克隆 `Arc<Motor>` 后立即释放 `AppState.motor` 锁：长事务（校准最长 120s）不得
/// 阻塞断开连接、状态读取等其它命令。
macro_rules! with_motor {
    ($state:expr, |$motor:ident| $body:expr) => {{
        let $motor = {
            let guard = $state.motor.lock().await;
            match guard.as_ref() {
                Some(motor) => Arc::clone(motor),
                None => return Err("Motor is not connected".to_string()),
            }
        };
        $body
    }};
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
pub async fn connect_motor(
    port_name: String,
    baud_rate: u32,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    // 先短临界区检查占用；串口连接与 get_config 校验期间不持有 AppState 锁。
    {
        let guard = state.motor.lock().await;
        if let Some(existing) = guard.as_ref() {
            return Err(format!(
                "Motor is already connected in port {}",
                existing.serial.port_name
            ));
        }
    }

    let port = SerialDevice::new(port_name.clone(), baud_rate);
    port.connect().await?;

    let motor = Motor::new(port, state.app.clone());
    motor.start_console_loop().await;

    // 连接必须用 get_config 校验：失败时干净地关闭串口。
    if let Err(e) = motor.initialize().await {
        let _ = motor.disconnect().await;
        return Err(format!("failed to verify device on {port_name}: {e}"));
    }

    let mut motor_guard = state.motor.lock().await;
    if motor_guard.is_some() {
        // 并发连接的竞态：放弃本次连接，保留先注册的那一个。
        drop(motor_guard);
        let _ = motor.disconnect().await;
        return Err("Motor is already connected".to_string());
    }
    *motor_guard = Some(motor);
    Ok(())
}

#[tauri::command]
pub async fn disconnect_motor(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let motor = state.motor.lock().await.take();
    if let Some(motor) = motor {
        motor.disconnect().await.map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("Motor is not connected".to_string())
    }
}

#[tauri::command]
pub async fn get_motor_port(state: tauri::State<'_, AppState>) -> Result<String, String> {
    with_motor!(state, |motor| Ok(motor.serial.port_name.clone()))
}

#[tauri::command]
pub async fn get_motor_state(state: tauri::State<'_, AppState>) -> Result<String, String> {
    with_motor!(state, |motor| {
        let motor_state = *motor.state.lock().await;
        Ok(motor_state.to_string())
    })
}

#[tauri::command]
pub async fn set_telemetry_mode(
    mode: TelemetryMode,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    with_motor!(state, |motor| motor
        .set_telemetry_mode(mode)
        .await
        .map_err(|e| e.to_string()))
}

#[tauri::command]
pub async fn get_telemetry_state(
    state: tauri::State<'_, AppState>,
) -> Result<TelemetryState<'static>, String> {
    with_motor!(state, |motor| Ok(motor.get_telemetry_state().await))
}

#[tauri::command]
pub async fn get_motor_config(state: tauri::State<'_, AppState>) -> Result<MotorConfig, String> {
    with_motor!(state, |motor| {
        let cached = motor.motor_config.lock().await;
        if let Some(config) = cached.as_ref() {
            return Ok(config.clone());
        }
        drop(cached);
        motor.load_config().await.map_err(|e| e.to_string())
    })
}

#[tauri::command]
pub async fn refresh_motor_config(
    state: tauri::State<'_, AppState>,
) -> Result<MotorConfig, String> {
    with_motor!(state, |motor| motor
        .load_config()
        .await
        .map_err(|e| e.to_string()))
}

#[tauri::command]
pub async fn config_motor_position_pid(
    kp: f32,
    ki: f32,
    kd: f32,
    output_max: f32,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    with_motor!(state, |motor| {
        motor
            .send_config_command(&MotorConfigCommand::ConfigPositionPid {
                kp,
                ki,
                kd,
                output_max,
            })
            .await
            .map_err(|e| e.to_string())
    })
}

#[tauri::command]
pub async fn config_motor_speed_pi(
    kp: f32,
    ki: f32,
    output_max: f32,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    with_motor!(state, |motor| {
        motor
            .send_config_command(&MotorConfigCommand::ConfigSpeedPi { kp, ki, output_max })
            .await
            .map_err(|e| e.to_string())
    })
}

#[tauri::command]
pub async fn config_motor_speed_sweep_current(
    current: f32,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    with_motor!(state, |motor| {
        motor
            .send_config_command(&MotorConfigCommand::ConfigSpeedSweepCurrent(current))
            .await
            .map_err(|e| e.to_string())
    })
}

#[tauri::command]
pub async fn config_motor_current_limit(
    current_limit: f32,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    with_motor!(state, |motor| {
        motor
            .send_config_command(&MotorConfigCommand::ConfigCurrentLimit(current_limit))
            .await
            .map_err(|e| e.to_string())
    })
}

#[tauri::command]
pub async fn config_motor_current_pi(
    d_kp: f32,
    d_ki: f32,
    q_kp: f32,
    q_ki: f32,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    with_motor!(state, |motor| {
        motor
            .send_config_command(&MotorConfigCommand::ConfigCurrentPi {
                d_kp,
                d_ki,
                q_kp,
                q_ki,
            })
            .await
            .map_err(|e| e.to_string())
    })
}

#[tauri::command]
pub async fn config_motor_encoder(
    pole_pairs: u32,
    encoder_direction: EncoderDirection,
    encoder_offset: f32,
    encoder_type: EncoderType,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    with_motor!(state, |motor| {
        motor
            .send_config_command(&MotorConfigCommand::ConfigEncoder {
                pole_pairs,
                encoder_direction,
                encoder_offset,
                encoder_type,
            })
            .await
            .map_err(|e| e.to_string())
    })
}

#[tauri::command]
pub async fn config_motor_id(id: u32, state: tauri::State<'_, AppState>) -> Result<(), String> {
    with_motor!(state, |motor| {
        motor
            .send_config_command(&MotorConfigCommand::ConfigId(id))
            .await
            .map_err(|e| e.to_string())
    })
}

#[tauri::command]
pub async fn motor_calibration(
    state: tauri::State<'_, AppState>,
) -> Result<CalibrationState, String> {
    with_motor!(state, |motor| motor
        .calibration()
        .await
        .map_err(|e| e.to_string()))
}

#[tauri::command]
pub async fn motor_stop(state: tauri::State<'_, AppState>) -> Result<(), String> {
    with_motor!(state, |motor| motor
        .send_running_command(&MotorRunCommand::Stop)
        .await
        .map_err(|e| e.to_string()))
}

#[tauri::command]
pub async fn motor_set_speed(speed: f32, state: tauri::State<'_, AppState>) -> Result<(), String> {
    with_motor!(state, |motor| motor
        .send_running_command(&MotorRunCommand::SetSpeed(speed))
        .await
        .map_err(|e| e.to_string()))
}

#[tauri::command]
pub async fn motor_set_position(
    position: f32,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    with_motor!(state, |motor| motor
        .send_running_command(&MotorRunCommand::SetPosition(position))
        .await
        .map_err(|e| e.to_string()))
}

#[tauri::command]
pub async fn motor_set_current(
    current: f32,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    with_motor!(state, |motor| motor
        .send_running_command(&MotorRunCommand::SetCurrent(current))
        .await
        .map_err(|e| e.to_string()))
}

#[tauri::command]
pub async fn motor_clear_fault(state: tauri::State<'_, AppState>) -> Result<(), String> {
    with_motor!(state, |motor| motor
        .send_running_command(&MotorRunCommand::ClearFault)
        .await
        .map_err(|e| e.to_string()))
}

#[tauri::command]
pub async fn send_serial_command(
    command: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    with_motor!(state, |motor| motor
        .send_raw_command(&command)
        .await
        .map_err(|e| e.to_string()))
}
