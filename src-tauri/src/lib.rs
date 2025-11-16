use crate::invokes::{connect_motor, disconnect_motor, get_motor_config, get_motor_state, list_serial_ports, set_motor_feedback, AppState};
use log::debug;
use std::sync::Arc;
use tauri::{Emitter, Manager};
use tokio::sync::Mutex;

mod serial;
mod motor;
mod error;
mod command;
mod config_parser;
mod invokes;

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

                app.emit("serial-port-changed", current)
                    .unwrap();
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
            get_motor_state,
            set_motor_feedback,
            get_motor_config,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
