use tauri::{App, Emitter, Manager, Runtime, WindowEvent};
#[cfg(feature = "desktop")]
use tauri::AppHandle;

#[cfg(feature = "desktop")]
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent},
};



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
