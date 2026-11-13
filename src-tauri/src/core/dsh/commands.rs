use tauri::{AppHandle, Runtime, State};

use super::plugins::{self, PluginEntry};
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

fn data_root<R: Runtime>(app: &AppHandle<R>) -> std::path::PathBuf {
    get_jan_data_folder_path(app.clone())
}

#[tauri::command]
pub async fn dsh_plugins_list<R: Runtime>(app: AppHandle<R>) -> Result<Vec<PluginEntry>, String> {
    let dir = data_dir(&app);
    plugins::list(&dir, &data_root(&app), &checkout_root(&dir))
}

#[tauri::command]
pub async fn dsh_plugin_set_enabled<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    enabled: bool,
) -> Result<(), String> {
    plugins::set_enabled(&data_dir(&app), &id, enabled)
}

/// `config` is YAML (JSON is valid YAML); empty clears it.
#[tauri::command]
pub async fn dsh_plugin_set_config<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    config: String,
) -> Result<(), String> {
    plugins::set_config(&data_dir(&app), &id, &config)
}

/// Installs an npm package into the user module folder and adds an entry for it.
#[tauri::command]
pub async fn dsh_plugin_install<R: Runtime>(app: AppHandle<R>, package: String) -> Result<(), String> {
    plugins::install(&data_dir(&app), &package).await
}

#[tauri::command]
pub async fn dsh_plugin_remove<R: Runtime>(app: AppHandle<R>, id: String) -> Result<(), String> {
    let dir = data_dir(&app);
    if let Some(package) = plugins::remove(&dir, &id)? {
        plugins::uninstall(&dir, &package).await;
    }
    Ok(())
}

#[tauri::command]
pub async fn dsh_restart<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    super::restart(&app, state.dsh(), &data_dir(&app)).await
}

/// A thread's private workspace, created on first use. Thread ids are
/// app-generated, but one is still refused if it could leave the folder.
#[tauri::command]
pub async fn dsh_thread_workspace<R: Runtime>(
    app: AppHandle<R>,
    thread_id: String,
) -> Result<String, String> {
    if thread_id.is_empty()
        || !thread_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(format!("not a thread id: {thread_id}"));
    }
    let dir = data_dir(&app).join("workspace").join("threads").join(&thread_id);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().into_owned())
}

/// Largest file the work panel previews; bigger ones open in the OS instead.
const PREVIEW_MAX_BYTES: u64 = 2 * 1024 * 1024;

/// Reads one file under `folder` for the work panel's preview: text as UTF-8,
/// anything else as base64. The folder is the thread's own, so a path the
/// agent wrote outside it (`..`, another drive) is refused.
#[tauri::command]
pub async fn dsh_read_workspace_file(folder: String, path: String) -> Result<WorkspaceFile, String> {
    let root = std::fs::canonicalize(&folder).map_err(|e| format!("{folder}: {e}"))?;
    let joined = root.join(&path);
    let file = std::fs::canonicalize(&joined).map_err(|e| format!("{path}: {e}"))?;
    if !file.starts_with(&root) {
        return Err(format!("{path} is outside the thread's folder"));
    }
    let size = std::fs::metadata(&file).map_err(|e| e.to_string())?.len();
    if size > PREVIEW_MAX_BYTES {
        return Err(format!("{path} is too large to preview ({size} bytes)"));
    }
    let bytes = std::fs::read(&file).map_err(|e| e.to_string())?;
    Ok(match String::from_utf8(bytes) {
        Ok(text) => WorkspaceFile { path: file.to_string_lossy().into_owned(), text: Some(text), base64: None },
        Err(e) => {
            use base64::Engine;
            WorkspaceFile {
                path: file.to_string_lossy().into_owned(),
                text: None,
                base64: Some(base64::engine::general_purpose::STANDARD.encode(e.into_bytes())),
            }
        }
    })
}

#[derive(serde::Serialize)]
pub struct WorkspaceFile {
    /// Absolute path, for Open and Show in folder.
    path: String,
    text: Option<String>,
    base64: Option<String>,
}

/// The checkout the runtime was last linked to (`node_modules` is a junction
/// to `<root>/examples/node_modules`); empty before the first start.
fn checkout_root(dir: &std::path::Path) -> std::path::PathBuf {
    std::fs::read_link(dir.join("node_modules"))
        .ok()
        .and_then(|p| p.parent().and_then(|p| p.parent()).map(|p| p.to_path_buf()))
        .unwrap_or_default()
}

/// Starts DSH's own web host from the checkout at `root` and returns its URL.
#[tauri::command]
pub async fn dsh_web_start<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    root: String,
) -> Result<String, String> {
    super::web::start(&state.dsh_web, &data_dir(&app), std::path::Path::new(&root)).await
}

#[tauri::command]
pub async fn dsh_web_status(state: State<'_, AppState>) -> Result<super::web::DshWebStatus, String> {
    Ok(super::web::status(&state.dsh_web).await)
}

#[tauri::command]
pub async fn dsh_web_stop(state: State<'_, AppState>) -> Result<(), String> {
    super::web::stop(&state.dsh_web).await;
    Ok(())
}
