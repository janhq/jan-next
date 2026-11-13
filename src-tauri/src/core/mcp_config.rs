//! The user's MCP server list, `<jan data folder>/mcp_config.json`.
//!
//! The app only stores and edits the file; DeepSeek Harness reads it to build
//! its mcp-client entries.

use serde_json::{json, Value};
use std::fs;
use tauri::{AppHandle, Runtime};

use crate::core::app::commands::get_jan_data_folder_path;

const MCP_CONFIG_FILE: &str = "mcp_config.json";

fn config_path<R: Runtime>(app: &AppHandle<R>) -> std::path::PathBuf {
    get_jan_data_folder_path(app.clone()).join(MCP_CONFIG_FILE)
}

/// Make `value` an object holding an `mcpServers` object. Returns whether it changed.
fn normalize(value: &mut Value) -> bool {
    let mut changed = false;
    if !value.is_object() {
        *value = json!({});
        changed = true;
    }
    let obj = value.as_object_mut().expect("object ensured above");
    if !obj.get("mcpServers").is_some_and(Value::is_object) {
        obj.insert("mcpServers".to_string(), json!({}));
        changed = true;
    }
    changed
}

fn write_pretty(path: &std::path::Path, value: &Value) -> Result<(), String> {
    let text = serde_json::to_string_pretty(value)
        .map_err(|e| format!("Failed to serialize MCP config: {e}"))?;
    fs::write(path, text).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_mcp_configs<R: Runtime>(app: AppHandle<R>) -> Result<String, String> {
    let path = config_path(&app);
    let existing = fs::read_to_string(&path).ok();
    let parsed: Option<Value> = existing
        .as_deref()
        .and_then(|text| serde_json::from_str(text).ok());
    let Some(mut value) = parsed else {
        let mut value = json!({});
        normalize(&mut value);
        write_pretty(&path, &value)?;
        return Ok(fs::read_to_string(&path).map_err(|e| e.to_string())?);
    };
    if normalize(&mut value) {
        write_pretty(&path, &value)?;
        return fs::read_to_string(&path).map_err(|e| e.to_string());
    }
    Ok(existing.unwrap_or_default())
}

#[tauri::command]
pub async fn save_mcp_configs<R: Runtime>(
    app: AppHandle<R>,
    configs: String,
) -> Result<(), String> {
    let mut value: Value =
        serde_json::from_str(&configs).map_err(|e| format!("Invalid MCP config payload: {e}"))?;
    if !value.is_object() {
        return Err("MCP config must be a JSON object".to_string());
    }
    normalize(&mut value);
    write_pretty(&config_path(&app), &value)
}
