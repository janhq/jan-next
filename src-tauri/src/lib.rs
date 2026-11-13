pub mod core;

use core::{
    app::commands::get_jan_data_folder_path,
    downloads::models::DownloadManagerState,
    setup,
    state::AppState,
};
use jan_utils::generate_app_token;
use std::{
    collections::HashMap,
    sync::Arc,
};
use tauri::{Emitter, Manager, RunEvent};
use tokio::sync::Mutex;

macro_rules! invoke_commands_with_extras {
    ($($extra:path),* $(,)?) => {
        tauri::generate_handler![
        // FS commands - Deperecate soon
        core::filesystem::commands::join_path,
        core::filesystem::commands::mkdir,
        core::filesystem::commands::exists_sync,
        core::filesystem::commands::readdir_sync,
        core::filesystem::commands::read_file_sync,
        core::filesystem::commands::rm,
        core::filesystem::commands::mv,
        core::filesystem::commands::file_stat,
        core::filesystem::commands::write_file_sync,
        core::filesystem::commands::write_yaml,
        core::filesystem::commands::read_yaml,
        core::filesystem::commands::decompress,
        core::filesystem::commands::open_dialog,
        core::filesystem::commands::save_dialog,
        // App configuration commands
        core::app::commands::get_app_configurations,
        core::app::commands::get_user_home_path,
        core::app::commands::update_app_configuration,
        core::app::commands::get_jan_data_folder_path,
        core::app::commands::change_app_data_folder,
        core::app::commands::app_token,
        // Backend-owned settings store (webview zustand persistence)
        core::app::settings_store::settings_get,
        core::app::settings_store::settings_set,
        core::app::settings_store::settings_remove,
        core::server::provider_secrets::set_secret,
        core::server::provider_secrets::get_secret,
        // System commands
        core::system::commands::relaunch,
        core::system::commands::factory_reset,
        core::system::commands::take_pending_webdata_reset,
        core::system::commands::read_logs,
        // Server commands
        core::server::commands::start_server,
        core::server::commands::stop_server,
        core::server::commands::get_server_status,
        // Local voice sidecar
        core::speech::commands::speech_status,
        core::speech::commands::speech_install,
        core::speech::commands::speech_start,
        core::speech::commands::speech_stop,
        core::speech::commands::speech_speak,
        core::speech::commands::speech_transcribe,
        // DeepSeek Harness agent backend
        core::dsh::commands::dsh_start,
        core::dsh::commands::dsh_send,
        core::dsh::commands::dsh_stop,
        core::dsh::commands::dsh_status,
        core::dsh::commands::dsh_check_root,
        core::dsh::commands::dsh_plugins_list,
        core::dsh::commands::dsh_plugin_set_enabled,
        core::dsh::commands::dsh_plugin_set_config,
        core::dsh::commands::dsh_plugin_install,
        core::dsh::commands::dsh_plugin_remove,
        core::dsh::commands::dsh_restart,
        core::dsh::commands::dsh_thread_workspace,
        core::dsh::commands::dsh_read_workspace_file,
        core::dsh::commands::dsh_web_start,
        core::server::commands::set_server_run_in_background,
        // Remote provider commands
        core::server::remote_provider_commands::register_provider_config,
        core::server::remote_provider_commands::unregister_provider_config,
        core::server::remote_provider_commands::delete_provider_keys,
        core::server::remote_provider_commands::get_provider_keys,
        // MCP server list (mcp_config.json)
        core::mcp_config::get_mcp_configs,
        core::mcp_config::save_mcp_configs,
        // Threads
        core::threads::commands::list_threads,
        core::threads::commands::create_thread,
        core::threads::commands::modify_thread,
        core::threads::commands::delete_thread,
        core::threads::commands::list_messages,
        core::threads::commands::create_message,
        core::threads::commands::modify_message,
        core::threads::commands::delete_message,
        core::threads::commands::get_thread_assistant,
        core::threads::commands::create_thread_assistant,
        core::threads::commands::modify_thread_assistant,
        // Download
        core::downloads::commands::download_files,
        core::downloads::commands::cancel_download_task,
        core::downloads::commands::pause_download_task,
        // App lifecycle
        confirm_exit,
        // Theme
        core::setup::get_system_theme,
        core::setup::get_titlebar_layout,
        $(
            $extra,
        )*
    ]
    };
}

static SHUTTING_DOWN: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
static GRACEFUL_IN_PROGRESS: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);
static BUSY_MODELS: std::sync::Mutex<Vec<String>> = std::sync::Mutex::new(Vec::new());

#[tauri::command]
async fn confirm_exit<R: tauri::Runtime>(_app_handle: tauri::AppHandle<R>) {
    SHUTTING_DOWN.store(true, std::sync::atomic::Ordering::SeqCst);
    tokio::spawn(async {
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        std::process::exit(0);
    });
}

/// Whether a llama.cpp engine worker is up, so the exit path knows whether it
/// owes the user a graceful shutdown.
///
/// `try_lock` rather than a blocking lock: this runs on the event loop. A held
/// lock means a start or stop is in flight, which counts as running -- the
/// graceful path is the safe answer when the state cannot be read.
fn is_llamacpp_engine_running<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> bool {
    use tauri::Manager;
    app.try_state::<std::sync::Arc<tauri_plugin_llamacpp::LlamacppState>>()
        .map(|s| match s.engine.try_lock() {
            Ok(guard) => guard.is_some(),
            Err(_) => true,
        })
        .unwrap_or(false)
}

#[cfg(not(target_os = "macos"))]
fn is_proxy_server_running<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> bool {
    use tauri::Manager;
    app.try_state::<AppState>()
        .and_then(|s| s.server_handle.try_lock().ok().map(|g| g.is_some()))
        .unwrap_or(false)
}

fn reemit_busy_if_any<R: tauri::Runtime>(app_handle: &tauri::AppHandle<R>) {
    let busy = BUSY_MODELS.lock().map(|g| g.clone()).unwrap_or_default();
    if !busy.is_empty() {
        let _ = app_handle.emit("llamacpp-busy-on-exit", &busy);
    }
}

async fn handle_graceful_exit<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    source: &'static str,
    exit_code: i32,
) {
    use std::sync::atomic::Ordering;
    let mut emitted = false;
    loop {
        if SHUTTING_DOWN.load(Ordering::SeqCst) {
            return;
        }
        match tauri_plugin_llamacpp::try_graceful_stop_engine(app_handle.clone(), 1).await {
            Ok(None) => {
                if let Ok(mut g) = BUSY_MODELS.lock() {
                    g.clear();
                }
                SHUTTING_DOWN.store(true, Ordering::SeqCst);
                app_handle.exit(exit_code);
                return;
            }
            Ok(Some(busy)) => {
                if let Ok(mut g) = BUSY_MODELS.lock() {
                    *g = busy.clone();
                }
                if !emitted {
                    log::warn!("{}: {} model(s) busy: {:?}", source, busy.len(), busy);
                    if let Err(e) = app_handle.emit("llamacpp-busy-on-exit", &busy) {
                        log::warn!("emit llamacpp-busy-on-exit failed: {}", e);
                        SHUTTING_DOWN.store(true, Ordering::SeqCst);
                        app_handle.exit(exit_code);
                        return;
                    }
                    emitted = true;
                }
                tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            }
            Err(e) => {
                log::warn!("{}: try_graceful_stop_engine failed: {}", source, e);
                SHUTTING_DOWN.store(true, Ordering::SeqCst);
                app_handle.exit(exit_code);
                return;
            }
        }
    }
}

pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|_app, argv, _cwd| {
        println!("a new app instance was opened with {argv:?} and the deep link event was already triggered");
        // when defining deep link schemes at runtime, you must also check `argv` here
    }));

    let mut app_builder = builder
        // First, so no other plugin's hook sees a navigation it refuses.
        .plugin(core::navigation::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_llamacpp::init());

    #[cfg(feature = "deep-link")]
    {
        app_builder = app_builder.plugin(tauri_plugin_deep_link::init());
    }

    {
        app_builder = app_builder.plugin(tauri_plugin_hardware::init());
    }

    let app_builder = app_builder.invoke_handler(invoke_commands_with_extras![
    ]);

    let app = app_builder
        .manage(AppState {
            app_token: Some(generate_app_token()),
            download_manager: Arc::new(Mutex::new(DownloadManagerState::default())),
            server_handle: Arc::new(Mutex::new(None)),
            background_cleanup_handle: Arc::new(Mutex::new(None)),
            provider_configs: Arc::new(Mutex::new(HashMap::new())),
            speech: Default::default(),
            dsh: Default::default(),
            dsh_web: Default::default(),
        })
        .manage(core::filesystem::grants::ReadGrants::with_home(
            dirs::home_dir(),
        ))
        .setup(|app| {
            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(log::LevelFilter::Debug)
                    .max_file_size(10_000_000)
                    .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepSome(5))
                    .targets([
                        tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                        tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Webview),
                        tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Folder {
                            path: get_jan_data_folder_path(app.handle().clone()).join("logs"),
                            file_name: Some("app".to_string()),
                        }),
                    ])
                    .build(),
            )?;
            // Load the read grants before the event loop delivers any IPC, so a
            // read of a path the user picked in an earlier session is allowed.
            core::filesystem::grants::init(app.handle());

            // A factory reset only moves data aside and restarts; deleting it,
            // which can take a while for a big models folder, happens here.
            {
                let handle = app.handle().clone();
                tauri::async_runtime::spawn_blocking(move || {
                    core::system::commands::sweep_reset_trash(&handle);
                });
            }

            // Reap engines a previous Jan left running: the llama-server router of
            // a 0.8.4 that was updated in place. It cannot be stopped by the
            // version that started it.
            {
                let data_folder = get_jan_data_folder_path(app.handle().clone());
                tauri::async_runtime::spawn_blocking(move || {
                    let killed = core::system::orphans::sweep_orphaned_engines(&data_folder);
                    if killed > 0 {
                        log::warn!("Reaped {killed} engine process(es) left by a previous Jan");
                    }
                });
            }

            // A SIGTERM ends the process without RunEvent::Exit, so the exit
            // cleanup never ran and child engines were left running. Turn the
            // signal into a normal exit.
            #[cfg(target_os = "macos")]
            {
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    use tokio::signal::unix::{signal, SignalKind};
                    let Ok(mut term) = signal(SignalKind::terminate()) else {
                        log::warn!("Could not listen for SIGTERM");
                        return;
                    };
                    term.recv().await;
                    log::info!("Received SIGTERM; shutting down");
                    SHUTTING_DOWN.store(true, std::sync::atomic::Ordering::SeqCst);
                    handle.exit(0);
                });
            }

            #[cfg(feature = "desktop")]
            if setup::tray_always_visible() {
                log::info!("Enabling system tray icon");
                let _ = setup::setup_tray(app.handle());
            }

            // Windows only: `register_all` writes the HKCU `jan://` handler, which
            // macOS instead takes from the bundle's Info.plist.
            #[cfg(all(feature = "deep-link", windows))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                app.deep_link().register_all()?;
            }

            setup::setup_theme_listener(app)?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running tauri application");
    // Handle app lifecycle events
    app.run(|app, event| {
        use std::sync::atomic::Ordering;
        if let RunEvent::WindowEvent {
            event: tauri::WindowEvent::CloseRequested { api, .. },
            label,
            ..
        } = &event
        {
            if label == "main" && !SHUTTING_DOWN.load(Ordering::SeqCst) {
                // macOS: closing the window hides it; the app (and background
                // services) keep running. Quit happens via Cmd+Q / dock / tray,
                // which routes through RunEvent::ExitRequested.
                #[cfg(target_os = "macos")]
                {
                    api.prevent_close();
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.hide();
                    }
                    return;
                }
                // Windows/Linux: hide to tray only while the Local API Server is
                // running and the user opted into keeping it alive in the
                // background; otherwise fall through to the normal quit-on-close.
                // The llamacpp engine is not a reason to keep the app resident
                // (normal chat usage keeps it alive), so it gets torn down via
                // the ExitRequested path on quit.
                #[cfg(not(target_os = "macos"))]
                if is_proxy_server_running(app)
                    && core::server::commands::SERVER_RUN_IN_BACKGROUND
                        .load(Ordering::SeqCst)
                {
                    api.prevent_close();
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.hide();
                    }
                    return;
                }
            }
        }
        #[cfg(target_os = "macos")]
        if let RunEvent::Reopen { .. } = &event {
            core::system::commands::show_main_window(app);
        }
        if let RunEvent::ExitRequested { api, code, .. } = &event {
            // Quitting mid-reset would drop the reset and its restart; it ends
            // in its own restart. A native macOS quit never gets here, which
            // is why the reset stages its deletion atomically.
            if core::system::commands::exit_blocked_by_reset(
                core::system::commands::factory_reset_in_progress(),
                *code,
            ) {
                log::warn!("Ignoring exit request while a factory reset is running");
                api.prevent_exit();
                return;
            }
            if SHUTTING_DOWN.load(Ordering::SeqCst) || !is_llamacpp_engine_running(app) {
                return;
            }
            api.prevent_exit();
            let _ = app.emit("llamacpp-close-attempt", ());
            if GRACEFUL_IN_PROGRESS.swap(true, Ordering::SeqCst) {
                reemit_busy_if_any(app);
                return;
            }
            let app_handle = app.clone();
            let exit_code = code.unwrap_or(0);
            tauri::async_runtime::spawn(async move {
                handle_graceful_exit(app_handle, "ExitRequested", exit_code).await;
                GRACEFUL_IN_PROGRESS.store(false, Ordering::SeqCst);
            });
            return;
        }
        if let RunEvent::Exit = event {
            let app_handle = app.clone();

            {
                if let Some(window) = app_handle.get_webview_window("main") {
                    let _ = window.emit("app-shutting-down", ());
                    let _ = window.hide();
                }
            }

            let state = app_handle.state::<AppState>();

            // Check if cleanup already ran
            let cleanup_already_running = tokio::task::block_in_place(|| {
                tauri::async_runtime::block_on(async {
                    let handle = state.background_cleanup_handle.lock().await;
                    handle.is_some()
                })
            });

            if cleanup_already_running {
                return;
            }

            // Run cleanup synchronously and WAIT for it to complete
            tokio::task::block_in_place(|| {
                tauri::async_runtime::block_on(core::system::shutdown::shutdown_cleanup(
                    &app_handle,
                ))
            });
        }
    });
}
