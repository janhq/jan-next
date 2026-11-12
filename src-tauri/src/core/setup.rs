use std::{fs, sync::Arc, time::Duration};
use tauri::{App, AppHandle, Emitter, Listener, Manager, Runtime, WindowEvent, Wry};

#[cfg(feature = "desktop")]
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent},
};
use tauri_plugin_store::Store;

use crate::core::app::commands::get_jan_data_folder_path;
use crate::core::mcp::constants::DEFAULT_MCP_CONFIG;
use crate::core::mcp::helpers::add_server_config;

use super::{mcp::helpers::run_mcp_commands, state::AppState};

/// The MCP store schema this build writes. `migrate_mcp_servers` walks every
/// store older than this through the gates below, then pins this value. The
/// upgrade-compat fixture test (tests/upgrade_compat.rs) asserts committed
/// past-release stores sit below it, so bumping this constant without adding
/// that release's store fixture breaks the build instead of skipping a
/// migration silently.
pub const CURRENT_MCP_SCHEMA_VERSION: i64 = 5;

/// The schema version a profile's MCP migration starts from.
///
/// Every step in `migrate_mcp_servers` upgrades an entry of an existing
/// `mcp_config.json`. With no file - a first start, or a deleted config - none
/// of them has anything to act on and each would only log an error for the
/// missing file, burying a real first-run failure. `setup_mcp` writes the
/// current default config right after, so such a profile starts at the current
/// schema instead.
///
/// `pub` for the upgrade-compat fixture test.
pub fn mcp_migration_start(stored: i64, config_exists: bool) -> i64 {
    if config_exists {
        stored
    } else {
        CURRENT_MCP_SCHEMA_VERSION
    }
}

// Migrate MCP servers configuration
pub fn migrate_mcp_servers(
    app_handle: tauri::AppHandle,
    store: Arc<Store<Wry>>,
) -> Result<(), String> {
    // `exists()` reads a stat error as "missing", which would pin the current
    // schema for a profile that does have a config. An inconclusive check counts
    // as present so the steps run and a failed read retries at the next start.
    let config_exists = get_jan_data_folder_path(app_handle.clone())
        .join("mcp_config.json")
        .try_exists()
        .unwrap_or(true);
    let mcp_version = mcp_migration_start(
        store
            .get("mcp_version")
            .and_then(|v| v.as_i64())
            .unwrap_or(0),
        config_exists,
    );
    if mcp_version < 1 {
        log::info!("Migrating MCP schema version 1");
        let result = add_server_config(
            app_handle.clone(),
            "exa".to_string(),
            serde_json::json!({
                  "command": "npx",
                  "args": ["-y", "exa-mcp-server"],
                  "env": { "EXA_API_KEY": "YOUR_EXA_API_KEY_HERE" },
                  "active": false
            }),
        );
        if let Err(e) = result {
            log::error!("Failed to add server config: {e}");
        }
    }
    if mcp_version < 2 {
        log::info!("Migrating MCP schema version 2: Adding Jan Browser MCP");
        let result = add_server_config(
            app_handle.clone(),
            "Jan Browser MCP".to_string(),
            serde_json::json!({
                "command": "npx",
                "args": ["-y", "search-mcp-server@latest"],
                "env": {
                    "BRIDGE_HOST": "127.0.0.1",
                    "BRIDGE_PORT": "17389"
                },
                "active": false,
                "official": true
            }),
        );
        if let Err(e) = result {
            log::error!("Failed to add Jan Browser MCP server config: {e}");
        }
    }
    if mcp_version < 3 {
        log::info!("Migrating MCP schema version 3: Updating Exa to streamable HTTP");
        if let Err(e) = migrate_exa_to_http(app_handle.clone()) {
            log::error!("Failed to migrate Exa to HTTP: {e}");
        }
    }
    if mcp_version < 4 {
        log::info!(
            "Migrating MCP schema version 4: Removing default Exa MCP (native web search cutover)"
        );
        if let Err(e) = remove_exa_server(app_handle.clone()) {
            log::error!("Failed to remove Exa MCP server: {e}");
        }
    }
    let mut schema = CURRENT_MCP_SCHEMA_VERSION;
    if mcp_version < 5 {
        // Version 4 only reaches an entry the user had deactivated, and it ran
        // once for everyone on 0.8.4 or later, so what it missed is left to this
        // step: the default 0.8.3 wrote for every user. See `remove_default_exa`.
        log::info!(
            "Migrating MCP schema version 5: Removing the hosted Exa MCP default 0.8.3 wrote"
        );
        let removed = remove_default_exa(app_handle);
        if let Err(e) = &removed {
            log::error!("Failed to remove the default Exa MCP server: {e}");
        }
        schema = schema_after_exa_cutover(&removed);
    }
    store.set("mcp_version", schema);
    store.save().expect("Failed to save store");
    Ok(())
}

/// The schema version to record once the version 5 cutover has been tried: the
/// current one when it worked, and the one before it when it did not - a config
/// that could not be read or written just then - so the next startup tries
/// again instead of skipping it for good. The steps before it have run and are
/// not repeated.
///
/// `pub` for the upgrade-compat fixture test.
pub fn schema_after_exa_cutover(removed: &Result<(), String>) -> i64 {
    if removed.is_ok() {
        CURRENT_MCP_SCHEMA_VERSION
    } else {
        CURRENT_MCP_SCHEMA_VERSION - 1
    }
}

fn migrate_exa_to_http(app_handle: tauri::AppHandle) -> Result<(), String> {
    let config_path = get_jan_data_folder_path(app_handle).join("mcp_config.json");

    let config_str =
        fs::read_to_string(&config_path).map_err(|e| format!("Failed to read MCP config: {e}"))?;

    let mut config: serde_json::Value = serde_json::from_str(&config_str)
        .map_err(|e| format!("Failed to parse MCP config: {e}"))?;

    if let Some(servers) = config.get_mut("mcpServers").and_then(|s| s.as_object_mut()) {
        servers.insert(
            "exa".to_string(),
            serde_json::json!({
                "type": "http",
                "url": "https://mcp.exa.ai/mcp".to_string(),
                "command": "",
                "args": [],
                "env": {},
                "active": true
            }),
        );
    }

    fs::write(
        &config_path,
        serde_json::to_string_pretty(&config)
            .map_err(|e| format!("Failed to serialize MCP config: {e}"))?,
    )
    .map_err(|e| format!("Failed to write MCP config: {e}"))?;

    Ok(())
}

/// Whether an `exa` MCP server entry is one the version 4 cutover removes: not
/// currently active, and carrying no API key.
///
/// Note what `active: false` does *not* mean here. It is not evidence that the
/// user never turned the server on: 0.8.3's own `migrate_exa_to_http` wrote
/// the entry with `active: true` and an empty `env` for everybody, so a 0.8.3
/// upgrader fails the `inactive` half and keeps the entry. The entries this
/// actually removes are the ones a user deactivated themselves; version 5
/// (`is_hosted_default_exa_server`) is what reaches the rest.
///
/// It inspects `active` and `env` only -- not `url` or `type` -- so an inactive
/// *custom* exa entry with an empty env also matches. Callers must reject
/// non-object values before calling (see `remove_exa_entry`).
///
/// `pub` for the upgrade-compat fixture test, which pins the decision against
/// real 0.8.3 bytes.
pub fn is_default_exa_server(exa: &serde_json::Value) -> bool {
    let inactive = exa.get("active").and_then(|v| v.as_bool()) != Some(true);
    let no_key = exa
        .get("env")
        .and_then(|env| env.as_object())
        .map(|env| env.is_empty())
        .unwrap_or(true);
    inactive && no_key
}

/// The hosted Exa endpoint 0.8.3 registered as an MCP server.
const HOSTED_EXA_URL: &str = "https://mcp.exa.ai/mcp";

/// Whether an `exa` entry is the default 0.8.3's `migrate_exa_to_http` wrote:
/// the hosted endpoint over http, with no command, no args, no key and no
/// headers, whether or not it is active (0.8.3 wrote it active for everyone, so
/// `active` says nothing about what the user wants).
///
/// Narrow on purpose, because a match deletes the entry and whatever the user
/// put in it. It is the six fields 0.8.3 wrote and nothing else: a key in `env`,
/// any `headers` (they carry authentication), any other field, and any other
/// url, transport, command or args keep the entry. A proxy, a self-hosted Exa,
/// or a server the user set up by hand under the name `exa` is not the default
/// and is never removed. Non-object values do not match.
///
/// `pub` for the upgrade-compat fixture test.
pub fn is_hosted_default_exa_server(exa: &serde_json::Value) -> bool {
    let Some(exa) = exa.as_object() else {
        return false;
    };
    // Whatever this migration does not know is the user's, and is kept.
    let only_known_fields = exa.keys().all(|key| {
        matches!(
            key.as_str(),
            "type" | "url" | "command" | "args" | "env" | "active" | "headers"
        )
    });
    let is = |key: &str, want: &str| exa.get(key).and_then(|v| v.as_str()) == Some(want);
    let empty_str = |key: &str| exa.get(key).is_none_or(|v| v.as_str() == Some(""));
    let empty_list = |key: &str| {
        exa.get(key)
            .is_none_or(|v| v.as_array().is_some_and(|a| a.is_empty()))
    };
    let empty_map = |key: &str| {
        exa.get(key)
            .is_none_or(|v| v.as_object().is_some_and(|m| m.is_empty()))
    };
    only_known_fields
        && is("type", "http")
        && is("url", HOSTED_EXA_URL)
        && empty_str("command")
        && empty_list("args")
        && empty_map("env")
        && empty_map("headers")
}

/// One-time cutover to native web search: drop the default Exa MCP server so the
/// built-in web_search/web_fetch tools own web search.
///
/// Version 4's match is narrow: the entry has to be inactive *and* keyless, but
/// 0.8.3 shipped it `active: true` with an empty `env`, so for upgraders the
/// cutover was close to a no-op. `remove_default_exa` (version 5) is the step
/// that reaches them.
fn remove_exa_server(app_handle: tauri::AppHandle) -> Result<(), String> {
    let config_path = get_jan_data_folder_path(app_handle).join("mcp_config.json");
    remove_exa_entry(&config_path, is_default_exa_server).map(|_| ())
}

/// Version 5 of the cutover: remove the hosted Exa default 0.8.3 wrote.
///
/// Nothing is lost by it: the built-in web tools default to Exa, and keyless
/// Exa is the same hosted endpoint, so web search keeps working against the same
/// server without a second set of Exa tools next to the built-in ones. An entry
/// with a key, or any other url, is left alone (`is_hosted_default_exa_server`),
/// and a user who wants the MCP entry back re-adds it with `jan cli mcp add`.
fn remove_default_exa(app_handle: tauri::AppHandle) -> Result<(), String> {
    let config_path = get_jan_data_folder_path(app_handle).join("mcp_config.json");
    remove_default_exa_from_config(&config_path).map(|_| ())
}

/// Version 5's removal against a config file. `Ok(true)` when it removed the
/// entry. `pub` for the upgrade-compat fixture test.
pub fn remove_default_exa_from_config(config_path: &std::path::Path) -> Result<bool, String> {
    remove_exa_entry(config_path, is_hosted_default_exa_server)
}

/// Remove the `exa` entry of an `mcp_config.json` when `matches` says it is the
/// one to remove. A missing file, a missing `mcpServers`, or no `exa` entry is
/// nothing to do.
fn remove_exa_entry(
    config_path: &std::path::Path,
    matches: fn(&serde_json::Value) -> bool,
) -> Result<bool, String> {
    if !config_path.exists() {
        return Ok(false);
    }
    let config_str =
        fs::read_to_string(config_path).map_err(|e| format!("Failed to read MCP config: {e}"))?;
    let mut config: serde_json::Value = serde_json::from_str(&config_str)
        .map_err(|e| format!("Failed to parse MCP config: {e}"))?;

    let Some(servers) = config.get_mut("mcpServers").and_then(|s| s.as_object_mut()) else {
        return Ok(false);
    };

    // `is_object()` is load-bearing, not defensive noise: serde_json's `get`
    // returns None on a non-object, so without it a malformed `exa` (a string,
    // a number, null) would read as "inactive, no key" and be deleted. Before
    // this predicate was extracted the guard was an `.and_then(as_object)` that
    // left such an entry alone, and this migration runs once against every
    // user's config at startup -- it must not start deleting things it used to
    // skip.
    let is_default_exa = servers
        .get("exa")
        .is_some_and(|exa| exa.is_object() && matches(exa));

    if is_default_exa {
        servers.remove("exa");
        fs::write(
            config_path,
            serde_json::to_string_pretty(&config)
                .map_err(|e| format!("Failed to serialize MCP config: {e}"))?,
        )
        .map_err(|e| format!("Failed to write MCP config: {e}"))?;
    }
    Ok(is_default_exa)
}

/// Resolve when the frontend emits `app-ready`, or after `timeout` (so a window
/// that never signals still proceeds).
async fn wait_for_app_ready<R: Runtime>(app: &AppHandle<R>, timeout: Duration) {
    let (tx, rx) = tokio::sync::oneshot::channel::<()>();
    let handler = app.once_any("app-ready", move |_| {
        let _ = tx.send(());
    });
    if tokio::time::timeout(timeout, rx).await.is_err() {
        log::info!("app-ready not received within {timeout:?}; starting MCP servers anyway");
        app.unlisten(handler);
    }
}

pub fn setup_mcp<R: Runtime>(app: &App<R>) {
    let state = app.state::<AppState>();
    let servers = state.mcp_servers.clone();
    let app_handle = app.handle().clone();
    tauri::async_runtime::spawn(async move {
        use crate::core::mcp::lockfile::cleanup_all_stale_locks;

        // Defer past first paint so npx/uvx spawns don't starve cold start.
        wait_for_app_ready(&app_handle, Duration::from_secs(30)).await;

        // Create default mcp_config.json if it doesn't exist
        let config_path = get_jan_data_folder_path(app_handle.clone()).join("mcp_config.json");
        if !config_path.exists() {
            log::info!("mcp_config.json not found, creating default config");
            if let Err(e) = fs::write(&config_path, DEFAULT_MCP_CONFIG) {
                log::error!("Failed to create default MCP config: {e}");
            }
        }

        if let Err(e) = cleanup_all_stale_locks(&app_handle).await {
            log::debug!("Lock file cleanup error: {}", e);
        }

        if let Err(e) = run_mcp_commands(&app_handle, servers).await {
            log::error!("Failed to run mcp commands: {e}");
        }
        if let Err(e) = app_handle.emit("mcp-update", "MCP servers updated") {
            log::warn!("Failed to emit mcp-update event: {e}");
        }
    });
}

#[cfg(feature = "desktop")]
pub const TRAY_ID: &str = "tray";

/// Tray icon forced on for the whole app lifetime at compile time; otherwise it
/// only exists while the Local API Server is running.
#[cfg(feature = "desktop")]
pub fn tray_always_visible() -> bool {
    option_env!("ENABLE_SYSTEM_TRAY_ICON").unwrap_or("false") == "true"
}

#[cfg(feature = "desktop")]
pub fn show_tray<R: Runtime>(app: &AppHandle<R>) {
    if app.tray_by_id(TRAY_ID).is_some() {
        return;
    }
    let handle = app.clone();
    // Tray creation must happen on the main thread (hard requirement on macOS).
    let _ = app.run_on_main_thread(move || {
        if handle.tray_by_id(TRAY_ID).is_none() {
            if let Err(e) = setup_tray(&handle) {
                log::error!("Failed to create tray icon: {e}");
            }
        }
    });
}

#[cfg(feature = "desktop")]
pub fn remove_tray<R: Runtime>(app: &AppHandle<R>) {
    if tray_always_visible() {
        return;
    }
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        let _ = handle.remove_tray_by_id(TRAY_ID);
    });
}

#[cfg(feature = "desktop")]
pub fn setup_tray<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<TrayIcon<R>> {
    let show_i = MenuItem::with_id(app, "open", "Open Jan", true, None::<&str>)?;
    let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let separator_i = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&show_i, &separator_i, &quit_i])?;
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| match event {
            TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } => {
                crate::core::system::commands::show_main_window(tray.app_handle());
            }
            _ => {
                log::debug!("unhandled event {event:?}");
            }
        })
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => crate::core::system::commands::show_main_window(app),
            "quit" => {
                app.exit(0);
            }
            other => {
                println!("menu item {other} not handled");
            }
        })
        .build(app)
}

pub fn setup_theme_listener<R: Runtime>(app: &App<R>) -> tauri::Result<()> {
    // Window theme listener for the main window
    if let Some(window) = app.get_webview_window("main") {
        setup_window_theme_listener(app.handle().clone(), window);
    }

    Ok(())
}

/// Window-control placement split by side. Values are `"minimize"`,
/// `"maximize"`, `"close"`; the borderless frontend renders its own buttons in
/// this order so they match the desktop's configured layout.
#[derive(serde::Serialize)]
pub struct TitlebarLayout {
    pub left: Vec<String>,
    pub right: Vec<String>,
}

impl Default for TitlebarLayout {
    fn default() -> Self {
        TitlebarLayout {
            left: vec![],
            right: vec![
                "minimize".to_string(),
                "maximize".to_string(),
                "close".to_string(),
            ],
        }
    }
}

/// macOS and Windows both place the controls themselves or on the right, so the
/// borderless titlebar always gets the default layout.
#[tauri::command]
pub fn get_titlebar_layout() -> TitlebarLayout {
    TitlebarLayout::default()
}

#[tauri::command]
pub async fn get_system_theme<R: Runtime>(app: tauri::AppHandle<R>) -> Result<String, String> {
    if let Some(window) = app.get_webview_window("main") {
        if let Ok(theme) = window.theme() {
            return Ok(match theme {
                tauri::Theme::Dark => "dark".to_string(),
                _ => "light".to_string(),
            });
        }
    }
    Ok("light".to_string())
}

fn setup_window_theme_listener<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    window: tauri::WebviewWindow<R>,
) {
    let window_label = window.label().to_string();
    let app_handle_clone = app_handle.clone();

    window.on_window_event(move |event| {
        if let WindowEvent::ThemeChanged(theme) = event {
            let theme_str = match theme {
                tauri::Theme::Light => "light",
                tauri::Theme::Dark => "dark",
                _ => "auto",
            };
            log::info!("System theme changed to: {theme_str} for window: {window_label}");
            let _ = app_handle_clone.emit("theme-changed", theme_str);
        }
    });
}
