use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, Runtime, State};
use tauri_plugin_llamacpp::cleanup_llama_processes;

use crate::core::app::commands::{
    default_data_folder_path, get_configuration_file_path, get_jan_data_folder_path,
    write_app_configuration,
};
use crate::core::app::constants::{
    JAN_DATA_DIRS_COMMON, JAN_DATA_DIRS_CONVERSATIONS, JAN_DATA_DIRS_MODELS,
    JAN_DATA_FILES_CONFIGS, JAN_DATA_FILES_SETTINGS,
};
use crate::core::app::models::AppConfiguration;
use crate::core::mcp::helpers::{stop_mcp_servers_with_context, ShutdownContext};
use crate::core::state::AppState;

fn is_safe_to_delete(path: &std::path::Path) -> bool {
    let count = path.components().count();
    count >= 3
}

/// Name prefix of the folder a reset moves its targets into. The sweep only
/// ever deletes a recorded path whose name carries it.
const RESET_TRASH_PREFIX: &str = ".reset-trash-";

/// Records the trash folder awaiting deletion. Lives in the app config dir,
/// which survives the reset, so a trash folder under a custom data folder is
/// still found after the reset points the config back at the default.
const PENDING_TRASH_FILE: &str = ".pending-reset-trash";

/// Data-folder entries a reset with these choices removes.
fn reset_targets(keep_app_data: bool, keep_models_and_configs: bool) -> Vec<&'static str> {
    // Extensions, logs and caches go on every reset.
    let mut targets = JAN_DATA_DIRS_COMMON.to_vec();
    if !keep_app_data {
        targets.extend(JAN_DATA_DIRS_CONVERSATIONS);
    }
    if !keep_models_and_configs {
        targets.extend(JAN_DATA_DIRS_MODELS);
        targets.extend(JAN_DATA_FILES_CONFIGS);
    }
    // The settings files span every category; only a full wipe drops them.
    if !keep_app_data && !keep_models_and_configs {
        targets.extend(JAN_DATA_FILES_SETTINGS);
    }
    targets
}

/// Move each target out of the data folder into `trash`.
///
/// A rename within one folder is atomic and instant, so the reset is decided
/// in milliseconds and an exit that cannot be refused (a native macOS quit
/// skips `ExitRequested`) leaves the data either untouched or fully staged,
/// never half-deleted. The slow deletion of `trash` happens later.
fn stage_for_deletion(data_folder: &std::path::Path, targets: &[&str], trash: &std::path::Path) {
    for name in targets {
        let path = data_folder.join(name);
        if fs::symlink_metadata(&path).is_err() {
            continue;
        }
        if let Err(e) = fs::create_dir_all(trash) {
            log::warn!("Failed to create {}: {e}", trash.display());
        }
        log::info!("Staging for deletion: {}", path.display());
        let dest = trash.join(name);
        if let Err(e) = rename_with_retry(&path, &dest) {
            log::warn!("Failed to move {}: {e}; staging its contents", path.display());
            let left = stage_contents(&path, &dest);
            if left > 0 {
                log::warn!("{left} locked entries stay in {}", path.display());
            }
        }
    }
}

/// Rename, retrying briefly: a lock held by a process the reset just stopped,
/// an indexer or antivirus is usually released within moments.
fn rename_with_retry(from: &std::path::Path, to: &std::path::Path) -> std::io::Result<()> {
    const ATTEMPTS: u32 = 3;
    let mut attempt = 1;
    loop {
        match fs::rename(from, to) {
            Err(_) if attempt < ATTEMPTS => {
                std::thread::sleep(std::time::Duration::from_millis(250));
                attempt += 1;
            }
            result => return result,
        }
    }
}

/// Move what can be moved from `from` into `to`, one entry at a time, and
/// return how many entries had to stay. Windows refuses to move a folder with
/// a file open anywhere in it, and deleting it in place stops at the first
/// such file, so this leaves behind only the files that are actually locked.
fn stage_contents(from: &std::path::Path, to: &std::path::Path) -> usize {
    let is_dir = fs::symlink_metadata(from).is_ok_and(|m| m.is_dir());
    if !is_dir {
        if let Err(e) = fs::remove_file(from) {
            log::warn!("Failed to remove {}: {e}", from.display());
            return 1;
        }
        return 0;
    }
    let entries = match fs::create_dir_all(to).and_then(|()| fs::read_dir(from)) {
        Ok(entries) => entries,
        Err(e) => {
            log::warn!("Failed to stage {}: {e}", from.display());
            return 1;
        }
    };
    let mut left = 0;
    for entry in entries.flatten() {
        let src = entry.path();
        let dest = to.join(entry.file_name());
        if fs::rename(&src, &dest).is_err() {
            left += stage_contents(&src, &dest);
        }
    }
    if left == 0 {
        if let Err(e) = fs::remove_dir(from) {
            log::warn!("Failed to remove {}: {e}", from.display());
            left = 1;
        }
    }
    left
}

fn remove_path(path: &std::path::Path) -> std::io::Result<()> {
    let removed = if path.is_dir() {
        fs::remove_dir_all(path)
    } else {
        fs::remove_file(path)
    };
    if let Err(e) = &removed {
        log::warn!("Failed to remove {}: {e}", path.display());
    }
    removed
}

fn pending_trash_record<R: Runtime>(app_handle: &tauri::AppHandle<R>) -> Option<PathBuf> {
    get_configuration_file_path(app_handle.clone())
        .parent()
        .map(|dir| dir.join(PENDING_TRASH_FILE))
}

fn record_pending_trash(record: &std::path::Path, trash: &std::path::Path) -> std::io::Result<()> {
    fs::write(record, trash.to_string_lossy().as_bytes())
}

/// Delete the trash folder a factory reset left behind, then forget it.
fn sweep_pending_trash(record: &std::path::Path) {
    let Ok(recorded) = fs::read_to_string(record) else {
        return;
    };
    let trash = PathBuf::from(recorded.trim());
    let is_reset_trash = trash
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.starts_with(RESET_TRASH_PREFIX));
    if is_reset_trash && is_safe_to_delete(&trash) {
        if trash.exists() {
            log::info!("Deleting factory reset leftovers: {}", trash.display());
            // A partial failure (a file locked on Windows) keeps the record,
            // so the next start retries instead of losing the folder for good.
            if remove_path(&trash).is_err() && trash.exists() {
                return;
            }
        }
    } else {
        log::warn!("Ignoring unexpected reset trash path: {}", trash.display());
    }
    // A reset during the sweep records its own trash; leave that record.
    if fs::read_to_string(record).ok().as_deref() != Some(recorded.as_str()) {
        return;
    }
    if let Err(e) = fs::remove_file(record) {
        log::warn!("Failed to remove {}: {e}", record.display());
    }
}

/// Finish a factory reset's deletion on the first start after it. Blocking:
/// run it off the main thread.
pub fn sweep_reset_trash<R: Runtime>(app_handle: &tauri::AppHandle<R>) {
    if let Some(record) = pending_trash_record(app_handle) {
        sweep_pending_trash(&record);
    }
}

/// Clear the WebKit/WRY webview profile (localStorage, cookies, IndexedDB,
/// stale state) stored in the bundle-id app-data dir (e.g. `jan.ai.app/`).
/// Distinct from the product-name data folder; only removed on explicit opt-in.
fn clear_webview_profile<R: Runtime>(
    app_handle: &tauri::AppHandle<R>,
    data_folder: &std::path::Path,
) {
    let webview_dir = match crate::core::app::paths::app_data_dir_for(app_handle) {
        Ok(dir) => dir,
        Err(e) => {
            log::warn!("Cannot resolve webview profile dir: {e}");
            return;
        }
    };

    // Never touch the dir if it is the user's data folder or contains it.
    if webview_dir == data_folder || data_folder.starts_with(&webview_dir) {
        log::warn!(
            "Skipping webview clear: data folder lives inside {}",
            webview_dir.display()
        );
        return;
    }

    if !webview_dir.is_dir() || !is_safe_to_delete(&webview_dir) {
        return;
    }

    log::info!("Clearing webview profile: {}", webview_dir.display());
    if let Err(e) = fs::remove_dir_all(&webview_dir) {
        log::warn!(
            "Failed to clear webview profile {}: {e}",
            webview_dir.display()
        );
    }
}

const WEBDATA_RESET_SENTINEL: &str = ".pending-webdata-reset";

/// Flags describing what a pending reset should prune from webview localStorage.
/// Consumed by the frontend on next startup before stores hydrate.
#[derive(serde::Serialize, serde::Deserialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct WebdataResetFlags {
    pub keep_app_data: bool,
    pub keep_models_and_configs: bool,
    pub clear_web_data: bool,
}

/// Sentinel lives in the app config dir (alongside settings.json), which
/// survives the data-folder wipe.
fn webdata_reset_sentinel_path<R: Runtime>(app_handle: &tauri::AppHandle<R>) -> Option<PathBuf> {
    get_configuration_file_path(app_handle.clone())
        .parent()
        .map(|dir| dir.join(WEBDATA_RESET_SENTINEL))
}

fn write_webdata_reset_sentinel<R: Runtime>(
    app_handle: &tauri::AppHandle<R>,
    keep_app_data: bool,
    keep_models_and_configs: bool,
    clear_web_data: bool,
) {
    let Some(path) = webdata_reset_sentinel_path(app_handle) else {
        return;
    };
    let flags = WebdataResetFlags {
        keep_app_data,
        keep_models_and_configs,
        clear_web_data,
    };
    match serde_json::to_string(&flags) {
        Ok(json) => {
            if let Err(e) = fs::write(&path, json) {
                log::warn!("Failed to write webdata reset sentinel: {e}");
            }
        }
        Err(e) => log::warn!("Failed to serialize webdata reset flags: {e}"),
    }
}

/// Read and remove the pending-reset sentinel. Returns the flags if one existed
/// so the frontend can prune the matching localStorage keys before hydration.
#[tauri::command]
pub fn take_pending_webdata_reset<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
) -> Option<WebdataResetFlags> {
    let path = webdata_reset_sentinel_path(&app_handle)?;
    if !path.is_file() {
        return None;
    }
    let flags = fs::read_to_string(&path)
        .ok()
        .and_then(|content| serde_json::from_str::<WebdataResetFlags>(&content).ok());
    if let Err(e) = fs::remove_file(&path) {
        log::warn!("Failed to remove webdata reset sentinel: {e}");
    }
    flags
}

/// Set by the first `factory_reset` and never cleared: the reset ends in a
/// restart, so a second call (double click, retry from the hidden webview)
/// must not start another teardown that interleaves with it.
static FACTORY_RESET_STARTED: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

/// Whether a factory reset is wiping data. The event loop stays live during
/// the wipe, so the app lifecycle handlers use this to keep the hidden
/// windows hidden and the process alive until the reset restarts it.
pub fn factory_reset_in_progress() -> bool {
    FACTORY_RESET_STARTED.load(std::sync::atomic::Ordering::SeqCst)
}

/// Bring the main window back, unless a factory reset hid it to wipe data.
/// Every user-facing "show Jan" path (tray click, tray menu, macOS dock
/// reopen) goes through here so none of them hands back a live webview over a
/// half-deleted data folder.
pub fn show_main_window<R: Runtime>(app: &AppHandle<R>) {
    if factory_reset_in_progress() {
        log::info!("Not showing the window while a factory reset is running");
        return;
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Whether an exit request must be refused because a reset is running, so a
/// quit during the teardown cannot cut the reset short. The reset's own
/// `restart()` arrives as `RESTART_EXIT_CODE` and must go through. Not every
/// exit reaches this check (a native macOS quit does not); the staged
/// deletion is what keeps those from leaving a half-wiped folder.
pub fn exit_blocked_by_reset(reset_in_progress: bool, code: Option<i32>) -> bool {
    reset_in_progress && code != Some(tauri::RESTART_EXIT_CODE)
}

/// Wipe the selected data categories and restart the app.
///
/// Async so it runs on the async runtime: as a sync command it ran on the main
/// thread, and the teardown below (MCP servers, engine worker, `remove_dir_all`
/// of the models folder) froze the event loop for up to ~30s with the window
/// stuck on screen.
#[tauri::command]
pub async fn factory_reset<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    state: State<'_, AppState>,
    keep_app_data: Option<bool>,
    keep_models_and_configs: Option<bool>,
    clear_web_data: Option<bool>,
) -> Result<(), String> {
    let keep_app_data = keep_app_data.unwrap_or(false);
    let keep_models_and_configs = keep_models_and_configs.unwrap_or(false);
    let clear_web_data = clear_web_data.unwrap_or(false);

    // Refuse before touching anything, so a refused reset leaves the app
    // running and visible and the frontend sees the error.
    let data_folder = get_jan_data_folder_path(app_handle.clone());
    if data_folder.exists() && !is_safe_to_delete(&data_folder) {
        log::error!(
            "Refusing factory reset: path is too close to filesystem root: {}",
            data_folder.display()
        );
        return Err(format!(
            "Refusing to reset {}: too close to the filesystem root",
            data_folder.display()
        ));
    }
    if FACTORY_RESET_STARTED.swap(true, std::sync::atomic::Ordering::SeqCst) {
        log::warn!("Factory reset already in progress; ignoring repeat request");
        return Ok(());
    }

    // Hide rather than close: now that the event loop keeps running, closing
    // the last window would start a normal app exit in the middle of the wipe.
    {
        let windows = app_handle.webview_windows();
        for (label, window) in windows.iter() {
            window.hide().unwrap_or_else(|_| {
                log::warn!("Failed to hide window: {label:?}");
            });
        }
    }
    log::info!(
        "Factory reset (keep_app_data={}, keep_models_and_configs={}, clear_web_data={}), data folder: {:?}",
        keep_app_data,
        keep_models_and_configs,
        clear_web_data,
        data_folder
    );

    let _ = stop_mcp_servers_with_context(&app_handle, &state, ShutdownContext::FactoryReset).await;

    {
        let mut active_servers = state.mcp_active_servers.lock().await;
        active_servers.clear();
    }

    use crate::core::mcp::lockfile::cleanup_own_locks;
    if let Err(e) = cleanup_own_locks(&app_handle) {
        log::warn!("Failed to cleanup lock files: {}", e);
    }
    let _ = cleanup_llama_processes(app_handle.clone()).await;

    let full_wipe = !keep_app_data && !keep_models_and_configs;
    if data_folder.exists() {
        // Discard before moving: the in-memory copy would otherwise be
        // flushed back by a pending debounced write or the exit-time flush.
        if full_wipe {
            crate::core::app::settings_store::discard_settings();
        }
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        let trash = data_folder.join(format!("{RESET_TRASH_PREFIX}{stamp}"));
        // Record first, so a trash folder is never left that no sweep knows of.
        let recorded = pending_trash_record(&app_handle)
            .map(|record| record_pending_trash(&record, &trash))
            .transpose();
        let targets = reset_targets(keep_app_data, keep_models_and_configs);
        let folder = data_folder.clone();
        let staged = tauri::async_runtime::spawn_blocking(move || {
            stage_for_deletion(&folder, &targets, &trash);
            // Without a record the next start cannot find the trash, so it
            // has to go now, slow as that is.
            if !matches!(recorded, Ok(Some(()))) {
                log::warn!("Could not record reset trash; deleting it now");
                if trash.exists() {
                    let _ = remove_path(&trash);
                }
            }
        })
        .await;
        if let Err(e) = staged {
            log::error!("Factory reset data deletion failed: {e}");
        }
    }

    // Reset app configuration to defaults unless user chose to keep configs
    if !keep_models_and_configs {
        let default_config = AppConfiguration {
            data_folder: default_data_folder_path(app_handle.clone()),
        };
        let _ = write_app_configuration(app_handle.clone(), default_config);
    }

    // Persisted UI state (model-provider, setup flag) lives in webview
    // localStorage, not the data folder. Renderer-side removal races the
    // restart flush, and the on-disk localStorage location is
    // platform-specific (esp. macOS WKWebView), so instead drop a sentinel
    // that the frontend consumes on next startup to clear localStorage via
    // the webview API before stores hydrate. File-level profile deletion
    // (Linux cookies/cache) stays as a best-effort supplement.
    if !keep_app_data || !keep_models_and_configs || clear_web_data {
        write_webdata_reset_sentinel(
            &app_handle,
            keep_app_data,
            keep_models_and_configs,
            clear_web_data,
        );
    }
    if clear_web_data || full_wipe {
        clear_webview_profile(&app_handle, &data_folder);
    }

    // The staged data is deleted by the next start (`sweep_reset_trash`).
    // Not `restart()`: off the main thread it parks this runtime worker
    // forever while the exit handler blocks on the same runtime for cleanup.
    app_handle.request_restart();
    Ok(())
}

#[tauri::command]
pub fn relaunch<R: Runtime>(app: AppHandle<R>) {
    app.restart()
}

#[tauri::command]
pub async fn read_logs<R: Runtime>(app: AppHandle<R>) -> Result<String, String> {
    let log_path = get_jan_data_folder_path(app).join("logs").join("app.log");
    if log_path.exists() {
        let content = fs::read_to_string(log_path).map_err(|e| e.to_string())?;
        Ok(content)
    } else {
        Err("Log file not found".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::app::constants::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn a_running_reset_blocks_exits_but_not_its_own_restart() {
        assert!(exit_blocked_by_reset(true, Some(0)));
        assert!(exit_blocked_by_reset(true, None));
        assert!(!exit_blocked_by_reset(true, Some(tauri::RESTART_EXIT_CODE)));
        assert!(!exit_blocked_by_reset(false, Some(0)));
        assert!(!exit_blocked_by_reset(false, None));
    }

    fn create_all_data(dir: &std::path::Path) {
        for subdir in JAN_DATA_SUBDIRS {
            fs::create_dir_all(dir.join(subdir)).unwrap();
            fs::write(dir.join(subdir).join("dummy.txt"), "data").unwrap();
        }
        for file in JAN_DATA_FILES {
            fs::write(dir.join(file), "data").unwrap();
        }
    }

    fn exists_any(dir: &std::path::Path, names: &[&str]) -> bool {
        names.iter().any(|n| dir.join(n).exists())
    }

    fn exists_all(dir: &std::path::Path, names: &[&str]) -> bool {
        names.iter().all(|n| dir.join(n).exists())
    }

    /// Stage a reset with these choices into a trash folder under `d`.
    fn stage(d: &std::path::Path, keep_app_data: bool, keep_models: bool) -> PathBuf {
        let trash = d.join(format!("{RESET_TRASH_PREFIX}test"));
        stage_for_deletion(d, &reset_targets(keep_app_data, keep_models), &trash);
        trash
    }

    #[test]
    fn keeping_both_categories_stages_only_common_data() {
        let tmp = tempdir().unwrap();
        let d = tmp.path();
        create_all_data(d);

        let trash = stage(d, true, true);

        assert!(!exists_any(d, JAN_DATA_DIRS_COMMON));
        assert!(exists_all(&trash, JAN_DATA_DIRS_COMMON));
        assert!(exists_all(d, JAN_DATA_DIRS_CONVERSATIONS));
        assert!(exists_all(d, JAN_DATA_DIRS_MODELS));
        assert!(exists_all(d, JAN_DATA_FILES));
    }

    #[test]
    fn keeping_models_stages_conversations_but_not_settings() {
        let tmp = tempdir().unwrap();
        let d = tmp.path();
        create_all_data(d);

        stage(d, false, true);

        assert!(!exists_any(d, JAN_DATA_DIRS_CONVERSATIONS));
        assert!(exists_all(d, JAN_DATA_DIRS_MODELS));
        assert!(exists_all(d, JAN_DATA_FILES_CONFIGS));
        assert!(exists_all(d, JAN_DATA_FILES_SETTINGS));
    }

    #[test]
    fn keeping_app_data_stages_models_and_configs_but_not_settings() {
        let tmp = tempdir().unwrap();
        let d = tmp.path();
        create_all_data(d);

        stage(d, true, false);

        assert!(!exists_any(d, JAN_DATA_DIRS_MODELS));
        assert!(!exists_any(d, JAN_DATA_FILES_CONFIGS));
        assert!(exists_all(d, JAN_DATA_DIRS_CONVERSATIONS));
        assert!(exists_all(d, JAN_DATA_FILES_SETTINGS));
    }

    #[test]
    fn full_wipe_stages_every_known_entry() {
        let tmp = tempdir().unwrap();
        let d = tmp.path();
        create_all_data(d);

        let trash = stage(d, false, false);

        assert!(!exists_any(d, JAN_DATA_SUBDIRS));
        assert!(!exists_any(d, JAN_DATA_FILES));
        assert!(exists_all(&trash, JAN_DATA_SUBDIRS));
        assert!(exists_all(&trash, JAN_DATA_FILES));
    }

    #[test]
    fn staging_with_nothing_to_move_creates_no_trash() {
        let tmp = tempdir().unwrap();
        let trash = stage(tmp.path(), false, false);
        assert!(!trash.exists());
    }

    #[test]
    fn sweep_deletes_recorded_trash_and_clears_the_record() {
        let tmp = tempdir().unwrap();
        let d = tmp.path().join("data");
        fs::create_dir_all(&d).unwrap();
        create_all_data(&d);
        let record = tmp.path().join(PENDING_TRASH_FILE);
        let trash = d.join(format!("{RESET_TRASH_PREFIX}1"));
        record_pending_trash(&record, &trash).unwrap();
        stage_for_deletion(&d, &reset_targets(false, false), &trash);

        sweep_pending_trash(&record);

        assert!(!trash.exists());
        assert!(!record.exists());
    }

    /// A read-only directory holding one file: its entries can be neither moved
    /// nor removed, which stands in for a file held open on Windows. `None`
    /// when permissions are not enforced (running as root).
    #[cfg(unix)]
    fn locked_dir(parent: &std::path::Path) -> Option<PathBuf> {
        use std::os::unix::fs::PermissionsExt;
        let locked = parent.join("locked");
        fs::create_dir_all(&locked).unwrap();
        fs::write(locked.join("held.bin"), "data").unwrap();
        fs::set_permissions(&locked, fs::Permissions::from_mode(0o555)).unwrap();
        if fs::write(locked.join("probe"), "").is_ok() {
            unlock(&locked);
            return None;
        }
        Some(locked)
    }

    #[cfg(unix)]
    fn unlock(dir: &std::path::Path) {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(dir, fs::Permissions::from_mode(0o755)).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn staging_contents_leaves_only_the_locked_entries() {
        let tmp = tempdir().unwrap();
        let models = tmp.path().join("llamacpp");
        fs::create_dir_all(models.join("free")).unwrap();
        fs::write(models.join("free").join("a.gguf"), "data").unwrap();
        fs::write(models.join("b.gguf"), "data").unwrap();
        let Some(locked) = locked_dir(&models) else {
            return;
        };
        let dest = tmp.path().join("trash").join("llamacpp");

        let left = stage_contents(&models, &dest);
        unlock(&locked);

        assert_eq!(left, 1);
        assert!(dest.join("free").join("a.gguf").exists());
        assert!(dest.join("b.gguf").exists());
        assert!(!models.join("free").exists());
        assert!(!models.join("b.gguf").exists());
        assert!(locked.join("held.bin").exists());
    }

    #[test]
    fn staging_contents_removes_the_emptied_folder() {
        let tmp = tempdir().unwrap();
        let models = tmp.path().join("llamacpp");
        fs::create_dir_all(models.join("free")).unwrap();
        fs::write(models.join("free").join("a.gguf"), "data").unwrap();
        let dest = tmp.path().join("trash").join("llamacpp");

        assert_eq!(stage_contents(&models, &dest), 0);
        assert!(!models.exists());
        assert!(dest.join("free").join("a.gguf").exists());
    }

    #[cfg(unix)]
    #[test]
    fn sweep_keeps_the_record_until_the_trash_is_gone() {
        let tmp = tempdir().unwrap();
        let record = tmp.path().join(PENDING_TRASH_FILE);
        let trash = tmp.path().join("data").join(format!("{RESET_TRASH_PREFIX}1"));
        fs::create_dir_all(&trash).unwrap();
        let Some(locked) = locked_dir(&trash) else {
            return;
        };
        record_pending_trash(&record, &trash).unwrap();

        sweep_pending_trash(&record);
        assert!(trash.exists());
        assert!(record.exists());

        unlock(&locked);
        sweep_pending_trash(&record);
        assert!(!trash.exists());
        assert!(!record.exists());
    }

    #[test]
    fn sweep_never_deletes_a_path_that_is_not_reset_trash() {
        let tmp = tempdir().unwrap();
        let keep = tmp.path().join("data").join("threads");
        fs::create_dir_all(&keep).unwrap();
        let record = tmp.path().join(PENDING_TRASH_FILE);
        record_pending_trash(&record, &keep).unwrap();

        sweep_pending_trash(&record);

        assert!(keep.exists());
        assert!(!record.exists());
    }

    #[test]
    fn sweep_without_a_record_is_a_no_op() {
        let tmp = tempdir().unwrap();
        sweep_pending_trash(&tmp.path().join(PENDING_TRASH_FILE));
    }

    #[test]
    fn test_is_safe_to_delete() {
        assert!(!is_safe_to_delete(std::path::Path::new("/")));
        assert!(!is_safe_to_delete(std::path::Path::new("/home")));
        assert!(is_safe_to_delete(std::path::Path::new("/home/user/jan")));
        assert!(is_safe_to_delete(std::path::Path::new(
            "/home/user/.local/share/jan"
        )));
    }
}
