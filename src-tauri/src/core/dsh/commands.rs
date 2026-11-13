use tauri::{AppHandle, Runtime, State};

use super::{DshLaunch, DshStatus};
use crate::core::app::commands::get_jan_data_folder_path;
use crate::core::state::AppState;

fn data_dir<R: Runtime>(app: &AppHandle<R>) -> std::path::PathBuf {
    get_jan_data_folder_path(app.clone()).join("dsh")
}

/// Starts the runtime for `launch`, restarting it when the launch differs from
/// the running one. Idempotent for the same launch.
#[tauri::command]
pub async fn dsh_start<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    launch: DshLaunch,
) -> Result<(), String> {
    super::start(&app, state.dsh(), &data_dir(&app), launch).await
}

/// Writes one JSON-RPC frame to the runtime's stdin.
#[tauri::command]
pub async fn dsh_send(state: State<'_, AppState>, line: String) -> Result<(), String> {
    super::send(state.dsh(), &line).await
}

#[tauri::command]
pub async fn dsh_stop(state: State<'_, AppState>) -> Result<(), String> {
    super::stop(state.dsh()).await;
    Ok(())
}

#[tauri::command]
pub async fn dsh_status(state: State<'_, AppState>) -> Result<DshStatus, String> {
    Ok(super::status(state.dsh()).await)
}

/// Validates a checkout path for the settings page.
#[tauri::command]
pub async fn dsh_check_root(root: String) -> Result<(), String> {
    super::check_root(std::path::Path::new(&root))
}
