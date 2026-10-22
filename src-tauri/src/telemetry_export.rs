use tauri_plugin_dialog::DialogExt;

/// The frontend supplies content and a suggested name, never a write path.
/// Only a path explicitly chosen in the native dialog can be written.
#[tauri::command]
pub async fn export_telemetry_csv(
    window: tauri::WebviewWindow,
    filename: String,
    csv: String,
) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dialog = window
            .dialog()
            .file()
            .set_title("导出遥测 CSV")
            .add_filter("CSV", &["csv"])
            .set_file_name(filename);
        #[cfg(desktop)]
        let dialog = dialog.set_parent(&window);
        let Some(selected) = dialog.blocking_save_file() else {
            return Ok(false);
        };
        let path = selected
            .into_path()
            .map_err(|error| format!("无法读取导出文件路径: {error}"))?;
        std::fs::write(&path, csv.as_bytes())
            .map_err(|error| format!("无法写入 CSV 文件 {}: {error}", path.display()))?;
        Ok(true)
    })
    .await
    .map_err(|error| format!("CSV 导出任务失败: {error}"))?
}
