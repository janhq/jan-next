use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use tauri::{AppHandle, Manager, Runtime, State};
use tauri_plugin_llamacpp::state::LlamacppState;

use crate::core::server::proxy;
use crate::core::state::AppState;

#[derive(serde::Deserialize)]
pub struct StartServerConfig {
    pub host: String,
    pub port: u16,
    pub prefix: String,
    pub api_key: String,
    pub trusted_hosts: Vec<String>,
    pub proxy_timeout: u64,
    /// "Allow cross-origin requests" toggle. Absent means on, the UI default.
    pub cors_enabled: Option<bool>,
}

#[tauri::command]
pub async fn start_server<R: Runtime>(
    app_handle: AppHandle<R>,
    state: State<'_, AppState>,
    config: StartServerConfig,
) -> Result<u16, String> {
    let StartServerConfig {
        host,
        port,
        prefix,
        api_key,
        trusted_hosts,
        proxy_timeout,
        cors_enabled,
    } = config;
    let server_handle = state.server_handle.clone();
    let llama_state: State<Arc<LlamacppState>> = app_handle.state();
    let llama_state_arc = llama_state.inner().clone();

    let actual_port = proxy::start_server(
        server_handle,
        llama_state_arc,
        host,
        port,
        prefix,
        api_key,
        vec![trusted_hosts],
        proxy_timeout,
        state.provider_configs.clone(),
        cors_enabled.unwrap_or(true),
    )
    .await
    .map_err(|e| e.to_string())?;

    #[cfg(feature = "desktop")]
    crate::core::setup::show_tray(&app_handle);

    Ok(actual_port)
}

#[tauri::command]
pub async fn stop_server<R: Runtime>(
    app_handle: AppHandle<R>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let server_handle = state.server_handle.clone();

    proxy::stop_server(server_handle)
        .await
        .map_err(|e| e.to_string())?;

    #[cfg(feature = "desktop")]
    crate::core::setup::remove_tray(&app_handle);
    #[cfg(not(feature = "desktop"))]
    let _ = app_handle;

    Ok(())
}

/// Whether closing the main window while the Local API Server runs should hide
/// the app to the tray instead of quitting (Windows/Linux only).
pub static SERVER_RUN_IN_BACKGROUND: AtomicBool = AtomicBool::new(true);

#[tauri::command]
pub fn set_server_run_in_background(enabled: bool) {
    SERVER_RUN_IN_BACKGROUND.store(enabled, Ordering::SeqCst);
}

#[tauri::command]
pub async fn get_server_status(state: State<'_, AppState>) -> Result<bool, String> {
    let server_handle = state.server_handle.clone();

    Ok(proxy::is_server_running(server_handle).await)
}
