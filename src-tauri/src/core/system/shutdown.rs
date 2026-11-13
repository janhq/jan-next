//! Teardown work that must run before the process goes away.
//!
//! Shared by the `RunEvent::Exit` handler and the paths that exit or restart
//! the process without raising that event.

use tauri::{AppHandle, Manager, Runtime};

use crate::core::state::AppState;

/// Stops everything the app started and flushes pending writes.
///
/// Safe to run more than once: each step is a no-op when there is nothing left
/// to stop, so the `RunEvent::Exit` handler can follow it.
pub async fn shutdown_cleanup<R: Runtime>(app: &AppHandle<R>) {
    // Drain debounced settings writes so the next version, and the jan CLI,
    // never read a stale settings.json.
    crate::core::app::settings_store::flush_settings();

    let state = app.state::<AppState>();
    crate::core::speech::stop(state.speech()).await;
    crate::core::dsh::stop(state.dsh()).await;
    crate::core::dsh::web::stop(&state.dsh_web).await;

    if let Err(e) = tauri_plugin_llamacpp::cleanup_llama_processes(app.clone()).await {
        log::warn!("Failed to shut down the llama.cpp engine: {}", e);
    } else {
        log::info!("llama.cpp engine shut down successfully");
    }

    log::info!("App cleanup completed");
}
