// Tauri command surface + the AppHandle-driven server lifecycle are
// desktop-only.
pub mod commands;
pub mod constants;
pub mod helpers;
pub mod lockfile;
pub mod models;
// OAuth for remote MCP servers.
pub mod oauth;
pub mod progress;
pub mod truncate;

#[cfg(test)]
mod tests;
