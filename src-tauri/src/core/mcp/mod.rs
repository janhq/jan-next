// Tauri command surface + the AppHandle-driven server lifecycle are
// desktop-only.
pub mod commands;
pub mod constants;
pub mod helpers;
pub mod lockfile;
pub mod models;
// OAuth for remote MCP servers: Tauri-free so the CLI drives it today and the
// desktop activation stack can adopt it unchanged.
pub mod oauth;
pub mod progress;
// The server direction: Jan's own toolset offered to other agents. Tauri-free,
// so it is built in both feature configs.
pub mod server;
pub mod truncate;

#[cfg(test)]
mod tests;
