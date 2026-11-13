//! Shared agent orchestration: the server-side loop and its upstream/provider
//! plumbing, consumed by both the API-server proxy and `tauri-plugin-agent`.
//!
//! The toolset the loop drives -- the built-in tools, their capability gate,
//! permissions, and skill storage -- lives in `tauri_plugin_agent_tools`, which
//! builds with or without Tauri so the desktop app and the headless CLI share
//! one implementation. This module owns orchestration only.

/// Completion pings for backgrounded `bash` commands.
pub mod bg_shell;
/// Where each dispatched subagent works: its own worktree or a read-only root.
pub mod child_workspace;
// Tauri IPC surface for the desktop agent; the CLI drives the loop directly.
pub mod commands;
pub mod compaction;
pub mod context;
/// The continuation state a compaction leaves in place of the span it covers.
pub mod continuation;
pub mod correlation;
pub mod events;
pub mod genai_bridge;
pub mod git;
// `~/.jan/config.toml` is the user's own layer; its `[[hooks]]` apply in the
// desktop app and the API server. Most of the rest of the module (provider
// records, settings writers) has no desktop consumer, hence the allow.
#[allow(dead_code)]
pub mod global_config;
pub mod hooks_config;
pub mod interaction;
pub mod r#loop;
pub mod memory;
/// Pure per-model context-window resolution, for the compaction budget.
pub mod model_window;
pub mod otel;
pub mod plan;
pub mod plugin_commands;
pub mod plugins;
pub mod project;
pub mod prompt;
/// The compaction budget for the desktop API server's orchestration runs.
pub(crate) mod proxy_budget;
pub mod provenance;
/// Routes known to reject a resent `reasoning_content` field.
pub mod reasoning_routes;
pub mod reminder;
pub mod request_headers;
pub mod secrets;
pub mod session;
pub mod session_log;
pub mod skills;
pub mod store_migration;
pub mod subagent;
pub mod subagent_session;
pub mod todo;
pub mod transcript;
pub mod upstream;

// Byte-level prefix-stability tests: the regression suite for epic #8956.
#[cfg(test)]
mod prefix_stability;

/// Render a path for embedding in a hook/plugin-tool shell command in tests.
///
/// Forward slashes and single quotes read the same in bash and PowerShell, so
/// a `C:\Users\...` temp path survives either shell, and the quotes keep a path
/// containing spaces a single word.
#[cfg(test)]
pub(crate) fn shell_quoted_path(path: &std::path::Path) -> String {
    format!("'{}'", path.to_string_lossy().replace('\\', "/"))
}
