//! Project-scoped agent state the desktop still manages: skill storage,
//! `agent.toml`, and the user's `[[hooks]]`. The agent loop itself is gone
//! from this fork; the built-in tools live in `tauri_plugin_agent_tools` and
//! the webview drives them.

// Tauri IPC surface for skill CRUD.
pub mod commands;
pub mod git;
// `~/.jan/config.toml` is the user's own layer; only its `[[hooks]]` and the
// settings the store reads have a desktop consumer, hence the allow.
#[allow(dead_code)]
pub mod global_config;
pub mod hooks_config;
pub mod project;
pub mod skills;
pub mod store_migration;
