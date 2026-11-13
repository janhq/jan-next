//! Teardown work that must run before the process goes away.
//!
//! Shared by the `RunEvent::Exit` handler and the paths that exit or restart
//! the process without raising that event.

use tauri::{AppHandle, Manager, Runtime};

use crate::core::mcp::helpers::background_cleanup_mcp_servers;
use crate::core::state::AppState;

/// How long MCP servers get to stop before we move on to the engine.
const MCP_CLEANUP_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);

/// Stops everything the app started and flushes pending writes.
///
/// Safe to run more than once: each step is a no-op when there is nothing left
/// to stop, so the `RunEvent::Exit` handler can follow it.
pub async fn shutdown_cleanup<R: Runtime>(app: &AppHandle<R>) {
    // Drain debounced settings writes so the next version, and the jan CLI,
    // never read a stale settings.json.
    crate::core::app::settings_store::flush_settings();

    // No agent shell (or child it spawned) may outlive the app.
    tauri_plugin_agent_tools::tools::proc::kill_all();

    let state = app.state::<AppState>();
    crate::core::speech::stop(state.speech()).await;
    match tokio::time::timeout(
        MCP_CLEANUP_TIMEOUT,
        background_cleanup_mcp_servers(app, &state),
    )
    .await
    {
        Ok(_) => log::info!("MCP cleanup completed successfully"),
        Err(_) => log::warn!(
            "MCP cleanup timed out after {} seconds",
            MCP_CLEANUP_TIMEOUT.as_secs()
        ),
    }

    if let Err(e) = tauri_plugin_llamacpp::cleanup_llama_processes(app.clone()).await {
        log::warn!("Failed to shut down the llama.cpp engine: {}", e);
    } else {
        log::info!("llama.cpp engine shut down successfully");
    }

    log::info!("App cleanup completed");
}
