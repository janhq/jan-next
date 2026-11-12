pub mod commands;
pub mod constants;
pub mod helpers;
pub mod models;
// Resolves the OS app-data root. Every `dirs::data_dir()` / `path().data_dir()`
// call in the app goes through here so Windows has an env lever at all.
pub mod paths;
// Desktop settings.json store, driven by Tauri commands + a flush thread.
pub mod settings_store;
