use crate::invokes::*;
use log::debug;
use std::sync::Arc;
use tauri::{Emitter, Manager};
use tokio::sync::Mutex;

mod calibration_parser;
mod command;
mod config_parser;
mod error;
mod exit_signal;
mod invokes;
mod motor;
mod serial;
mod telemetry;

pub fn start_serial_monitor(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut last_ports: Vec<String> = vec![];

        loop {
            let current = match list_serial_ports().await {
                Ok(ports) => ports,
                Err(e) => {
                    debug!("Failed to list serial ports: {}", e);
                    continue;
                }
            };

            if current != last_ports {
                last_ports = current.clone();

                app.emit("serial-port-changed", current).unwrap();
            }

            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let handle = app.handle();
            let state = AppState {
                motor: Arc::new(Mutex::new(None)),
                app: handle.clone(),
            };
            start_serial_monitor(handle.clone());
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_serial_ports,
            connect_motor,
            disconnect_motor,
            get_motor_port,
            get_motor_state,
            set_telemetry_mode,
            get_telemetry_mode,
            get_motor_config,
            refresh_motor_config,
            config_motor_position_pid,
            config_motor_speed_pi,
            config_motor_current_pi,
            config_motor_encoder,
            config_motor_id,
            motor_calibration,
            motor_stop,
            motor_set_speed,
            motor_set_position,
            motor_set_current,
            motor_clear_fault,
            send_serial_command
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
