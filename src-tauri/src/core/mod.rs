pub mod app;
// Download manager, native file dialogs/IO commands, and the system/tray
// command surface are desktop-only; the CLI uses std::fs and its own tools.
pub mod downloads;
pub mod dsh;
pub mod filesystem;
pub mod mcp_config;
#[cfg(windows)]
pub mod microphone;
// Desktop-only: the webview navigation guard.
pub mod navigation;
pub mod openai_schema;
pub mod server;
// Desktop-only app setup (tray, theme, window wiring); pulls in Tauri GUI types
// (Wry/AppHandle) the headless `jan` CLI build does not link.
pub mod setup;
pub mod speech;
pub mod state;
pub mod system;
pub mod threads;
