//! Private, per-host RPC for the Node plugins. The web page never receives its key.
use std::collections::HashMap;
use std::convert::Infallible;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use http_body_util::{BodyExt, Full, Limited, StreamBody, combinators::UnsyncBoxBody};
use hyper::body::{Bytes, Frame, Incoming};
use hyper::{Method, Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use rand::RngCore;
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::{Value, json};
use tauri::{Listener, Manager, Runtime};
use tokio::sync::broadcast;
use tokio_util::sync::CancellationToken;

use crate::core::{app::{commands::get_jan_data_folder_path, settings_store}, downloads, filesystem};
use tauri_plugin_llamacpp::{commands as llama, engine::{commands as engine, diagnose_commands as diagnose}, gguf::commands as gguf};

const MAX_BODY: usize = 1024 * 1024;
type Body = UnsyncBoxBody<Bytes, Infallible>;

pub struct NativeBridge {
    pub url: String,
    pub token: String,
    cancel: CancellationToken,
    task: tokio::task::AbortHandle,
    cleanup: Option<Box<dyn FnOnce() + Send + Sync>>,
}

impl Drop for NativeBridge {
    fn drop(&mut self) {
        self.cancel.cancel();
        self.task.abort();
        if let Some(cleanup) = self.cleanup.take() { cleanup(); }
    }
}

struct Shared<R: Runtime> {
    app: tauri::AppHandle<R>,
    authority: String,
    bearer: String,
    events: broadcast::Sender<String>,
    listeners: Arc<Mutex<HashMap<String, tauri::EventId>>>,
    cancel: CancellationToken,
}

fn listen<R: Runtime>(shared: &Shared<R>, name: &str) {
    let tx = shared.events.clone();
    let name = name.to_owned();
    let mut listeners = shared.listeners.lock().unwrap_or_else(|e| e.into_inner());
    // Download task ids can be reused for resume; one subscription is sufficient.
    if shared.cancel.is_cancelled() || listeners.contains_key(&name) { return; }
    let key = name.clone();
    let id = shared.app.listen_any(name.clone(), move |event| {
        if let Ok(payload) = serde_json::from_str::<Value>(event.payload()) {
            let _ = tx.send(json!({ "event": name, "payload": payload }).to_string());
        }
    });
    listeners.insert(key, id);
}

pub async fn start<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<NativeBridge, String> {
    let restore_app = app.clone();
    tokio::task::spawn_blocking(move || restore_model_grants(&restore_app)).await.map_err(|e| e.to_string())?;
    let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0)).await.map_err(|e| e.to_string())?;
    let address = listener.local_addr().map_err(|e| e.to_string())?;
    let mut random = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut random);
    let token = hex::encode(random);
    let cancel = CancellationToken::new();
    let listeners = Arc::new(Mutex::new(HashMap::new()));
    let (events, _) = broadcast::channel(256);
    let shared = Arc::new(Shared {
        app: app.clone(), authority: address.to_string(), bearer: format!("Bearer {token}"),
        events, listeners: listeners.clone(), cancel: cancel.clone(),
    });
    for name in ["llamacpp-model-load-progress", "llamacpp-model-unloaded", "llamacpp-router-oom", "llamacpp-router-backend-error", "llamacpp-diagnostics", "onModelValidationStarted"] {
        listen(&shared, name);
    }
    let task = tokio::spawn(async move {
        let mut connections = tokio::task::JoinSet::new();
        loop {
            tokio::select! {
                _ = shared.cancel.cancelled() => break,
                accepted = listener.accept() => match accepted {
                    Ok((socket, _)) => {
                        let shared = shared.clone();
                        connections.spawn(async move {
                            let service = hyper::service::service_fn(move |req| handle(req, shared.clone()));
                            let _ = hyper::server::conn::http1::Builder::new().serve_connection(TokioIo::new(socket), service).await;
                        });
                    }
                    Err(_) => break,
                },
                Some(_) = connections.join_next(), if !connections.is_empty() => {}
            }
        }
        connections.abort_all();
    });
    let app = app.clone();
    Ok(NativeBridge {
        url: format!("http://{address}"), token, cancel, task: task.abort_handle(),
        cleanup: Some(Box::new(move || {
            for (_, id) in listeners.lock().unwrap_or_else(|e| e.into_inner()).drain() { app.unlisten(id); }
        })),
    })
}

fn reply(status: StatusCode, value: Value) -> Response<Body> {
    Response::builder().status(status).header("content-type", "application/json")
        .header("cache-control", "no-store")
        .body(Full::new(Bytes::from(value.to_string())).boxed_unsync()).unwrap()
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Invoke { command: String, args: serde_json::Map<String, Value> }

async fn handle<R: Runtime>(req: Request<Incoming>, shared: Arc<Shared<R>>) -> Result<Response<Body>, Infallible> {
    let headers = req.headers();
    if headers.contains_key("origin") || headers.get_all("host").iter().count() != 1
        || headers.get("host").and_then(|v| v.to_str().ok()) != Some(shared.authority.as_str())
        || headers.get_all("authorization").iter().count() != 1
        || headers.get("authorization").map(|v| v.as_bytes()) != Some(shared.bearer.as_bytes()) {
        return Ok(reply(StatusCode::FORBIDDEN, json!({"error":"native bridge access denied"})));
    }
    if req.method() == Method::GET && req.uri().path() == "/events" {
        let rx = shared.events.subscribe();
        let cancel = shared.cancel.clone();
        let stream = futures_util::stream::unfold((rx, cancel, true), |(mut rx, cancel, initial)| async move {
            if initial {
                return Some((Ok::<_, Infallible>(Frame::data(Bytes::from_static(b": connected\n\n"))), (rx, cancel, false)));
            }
            loop {
                tokio::select! {
                    _ = cancel.cancelled() => return None,
                    event = rx.recv() => match event {
                        Ok(event) => return Some((Ok::<_, Infallible>(Frame::data(Bytes::from(format!("data: {event}\n\n")))), (rx, cancel, false))),
                        // A slow consumer must reconnect instead of silently missing state.
                        Err(_) => return None,
                    }
                }
            }
        });
        return Ok(Response::builder().header("content-type", "text/event-stream")
            .header("cache-control", "no-store").body(StreamBody::new(stream).boxed_unsync()).unwrap());
    }
    if req.method() != Method::POST || req.uri().path() != "/invoke" {
        return Ok(reply(StatusCode::NOT_FOUND, json!({"error":"unsupported native endpoint"})));
    }
    let bytes = match Limited::new(req.into_body(), MAX_BODY).collect().await {
        Ok(body) => body.to_bytes(),
        Err(_) => return Ok(reply(StatusCode::PAYLOAD_TOO_LARGE, json!({"error":"native request exceeds 1 MiB or could not be read"}))),
    };
    let input: Invoke = match serde_json::from_slice(&bytes) {
        Ok(input) => input,
        Err(_) => return Ok(reply(StatusCode::BAD_REQUEST, json!({"error":"expected {command:string,args:object}"}))),
    };
    let args = Value::Object(input.args);
    let app = shared.app.clone();
    let command = input.command;
    let checked_command = command.clone();
    let checked = tokio::task::spawn_blocking(move || {
        let mut args = args;
        validate(&app, &checked_command, &mut args)?;
        Ok::<_, String>(args)
    }).await;
    let result = match checked {
        Ok(Ok(args)) => {
            if command == "download_files" {
                // Subscribe before the native downloader emits its first byte count.
                if let Ok(task) = field::<String>(&args, "taskId") {
                    listen(&shared, &format!("download-{task}"));
                }
            }
            invoke(shared.app.clone(), &command, args).await
        }
        Ok(Err(e)) => Err(e),
        Err(e) => Err(e.to_string()),
    };
    Ok(match result {
        Ok(result) => reply(StatusCode::OK, json!({"result":result})),
        Err(error) => reply(StatusCode::BAD_REQUEST, json!({"error":error})),
    })
}

fn field<T: DeserializeOwned>(args: &Value, key: &str) -> Result<T, String> {
    serde_json::from_value(args.get(key).cloned().unwrap_or(Value::Null)).map_err(|e| format!("invalid {key}: {e}"))
}
fn optional<T: DeserializeOwned>(args: &Value, key: &str) -> Result<Option<T>, String> { field(args, key) }
fn defaulted<T: DeserializeOwned + Default>(args: &Value, key: &str) -> Result<T, String> {
    if args.get(key).is_none() { Ok(T::default()) } else { field(args, key) }
}
fn encoded<T: Serialize>(value: T) -> Result<Value, String> { serde_json::to_value(value).map_err(|e| e.to_string()) }

fn restore_model_grants<R: Runtime>(app: &tauri::AppHandle<R>) {
    use filesystem::helpers::canonical_scope_path;
    let root = canonical_scope_path(&get_jan_data_folder_path(app.clone())).join("llamacpp").join("models");
    let grants = app.state::<filesystem::grants::ReadGrants>();
    let mut pending = vec![(root.clone(), 4u8)];
    while let Some((dir, depth)) = pending.pop() {
        // Saved configs are authority only inside the real models directory.
        if !canonical_scope_path(&dir).starts_with(&root) { continue; }
        let Ok(entries) = std::fs::read_dir(dir) else { continue };
        for entry in entries.flatten() {
            let Ok(kind) = entry.file_type() else { continue };
            if kind.is_dir() && depth > 0 {
                pending.push((entry.path(), depth - 1));
            } else if kind.is_file() && entry.file_name() == "model.yml" {
                let Ok(text) = std::fs::read_to_string(entry.path()) else { continue };
                let Ok(config) = serde_yaml::from_str::<Value>(&text) else { continue };
                for key in ["model_path", "mmproj_path", "mtp_model_path"] {
                    let Some(raw) = config.get(key).and_then(Value::as_str) else { continue };
                    let path = Path::new(raw);
                    if path.is_absolute() && path.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("gguf")) && !path.is_dir() {
                        // Only this file is granted, never its containing directory.
                        grants.record_pick(path);
                    }
                }
            }
        }
    }
}

fn legacy_path<R: Runtime>(app: &tauri::AppHandle<R>, raw: &str) -> Option<PathBuf> {
    use filesystem::helpers::{canonical_scope_path, resolve_path_within_jan_data_folder};
    let root = get_jan_data_folder_path(app.clone());
    let (_, path) = resolve_path_within_jan_data_folder(&root, raw).ok()?;
    path.starts_with(canonical_scope_path(&root).join("models")).then_some(path)
}

fn scoped<R: Runtime>(app: &tauri::AppHandle<R>, raw: &str, imported: bool) -> Result<PathBuf, String> {
    use filesystem::helpers::{canonical_scope_path, resolve_path_within_jan_data_folder};
    let root = get_jan_data_folder_path(app.clone());
    if let Ok((_, path)) = resolve_path_within_jan_data_folder(&root, raw) {
        if ["llamacpp", "assistants"].iter().any(|dir| path.starts_with(canonical_scope_path(&root).join(dir))) {
            return Ok(path);
        }
    }
    if imported {
        if let Some(path) = legacy_path(app, raw) { return Ok(path); }
    }
    let path = canonical_scope_path(Path::new(raw));
    if imported && path.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("gguf"))
        && app.state::<filesystem::grants::ReadGrants>().allows(&path) {
        return filesystem::helpers::resolve_app_read_path(app.clone(), raw);
    }
    Err("native bridge path must be in llamacpp/assistants or an explicitly granted GGUF import".into())
}

fn validate<R: Runtime>(app: &tauri::AppHandle<R>, command: &str, args: &mut Value) -> Result<(), String> {
    let name = command.strip_prefix("plugin:llamacpp|").unwrap_or(command);
    if matches!(name, "download_files" | "pause_download_task" | "cancel_download_task") {
        let task: String = field(args, "taskId")?;
        // Tauri event names allow alphanumerics, '-', '/', ':' and '_'.
        // The engine uses provider/model ids, including nested model paths.
        if task.is_empty() || !task.chars().all(|c| c.is_alphanumeric() || matches!(c, '-' | '/' | ':' | '_')) {
            return Err("invalid download task id".into());
        }
    }
    match name {
        "rm" | "mkdir" | "write_file_sync" | "exists_sync" | "read_file_sync" | "readdir_sync" | "mv" => {
            let values: Vec<String> = field(args, "args")?;
            let path = values.first().ok_or("missing file path")?;
            let legacy = legacy_path(app, path).is_some()
                && matches!(name, "exists_sync" | "read_file_sync" | "readdir_sync" | "rm" | "mv");
            let root_probe = name == "exists_sync"
                && filesystem::helpers::resolve_path_within_jan_data_folder(&get_jan_data_folder_path(app.clone()), path)
                    .is_ok_and(|(root, target)| root == target);
            if !legacy && !root_probe { scoped(app, path, matches!(name, "exists_sync" | "read_file_sync"))?; }
            if name == "mv" {
                let destination = values.get(1).ok_or("missing destination")?;
                if legacy_path(app, destination).is_none() { scoped(app, destination, false)?; }
            }
        }
        "file_stat" => { scoped(app, &field::<String>(args, "args")?, true)?; }
        "read_yaml" | "write_yaml" => {
            let path: String = field(args, if name == "read_yaml" { "path" } else { "savePath" })?;
            if !(name == "read_yaml" && legacy_path(app, &path).is_some()) { scoped(app, &path, false)?; }
            if name == "write_yaml" {
                let data: Value = field(args, "data")?;
                for key in ["model_path", "mmproj_path", "mtp_model_path"] {
                    if let Some(path) = data.get(key).and_then(Value::as_str) { scoped(app, path, true)?; }
                }
            }
        }
        "start_engine" | "reload_engine_models" => {
            let path = scoped(app, &field::<String>(args, "presetPath")?, false)?;
            args["presetPath"] = Value::String(path.to_string_lossy().into_owned());
            let text = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
            for line in text.lines().map(str::trim) {
                let Some((key, value)) = line.split_once('=') else { continue };
                let value = value.trim();
                if value.is_empty() { continue; }
                match key.trim() {
                    "model" | "mmproj" | "model-draft" | "model-draft-mtp" | "spec-draft-model" => { scoped(app, value, true)?; }
                    "slot-save-path" | "chat-template-file" | "grammar-file" | "lora" | "control-vector" => { scoped(app, value, false)?; }
                    _ => {}
                }
            }
        }
        "erase_thread_slot_state" => {
            if let Some(path) = optional::<String>(args, "cacheDir")? {
                args["cacheDir"] = Value::String(scoped(app, &path, false)?.to_string_lossy().into_owned());
            }
        }
        "read_gguf_metadata" | "find_gguf_tensors" | "is_model_supported" => {
            let path: String = field(args, "path")?;
            if !(name == "is_model_supported" && path.starts_with("https://")) {
                args["path"] = Value::String(scoped(app, &path, true)?.to_string_lossy().into_owned());
            }
        }
        "download_files" => {
            let items: Vec<downloads::models::DownloadItem> = field(args, "items")?;
            for item in items { scoped(app, &item.save_path, false)?; }
        }
        "get_secret" => if field::<String>(args, "key")? != "huggingface" { return Err("only the Hugging Face download credential is available".into()); },
        _ => {}
    }
    Ok(())
}

async fn invoke<R: Runtime>(app: tauri::AppHandle<R>, command: &str, args: Value) -> Result<Value, String> {
    // These are real function calls. No Tauri command string is evaluated dynamically.
    match command {
        "plugin:llamacpp|load_llama_model" => encoded(llama::load_llama_model(app, field(&args,"modelId")?, defaulted(&args,"isEmbedding")?).await.map_err(|e| e.to_string())?),
        "plugin:llamacpp|unload_llama_model" => encoded(llama::unload_llama_model(app, field(&args,"modelId")?).await.map_err(|e| e.to_string())?),
        "plugin:llamacpp|ensure_session_ready" => encoded(llama::ensure_session_ready(app, field(&args,"modelId")?, defaulted(&args,"isEmbedding")?).await?),
        "plugin:llamacpp|find_session_by_model" => encoded(llama::find_session_by_model(app, field(&args,"modelId")?).await?),
        "plugin:llamacpp|get_loaded_models" => encoded(llama::get_loaded_models(app).await?),
        "plugin:llamacpp|generate_api_key" => encoded(llama::generate_api_key(field(&args,"modelId")?, field(&args,"apiSecret")?)?),
        "plugin:llamacpp|cleanup_llama_processes" => encoded(tauri_plugin_llamacpp::cleanup_llama_processes(app).await?),
        "plugin:llamacpp|start_engine" => encoded(engine::start_engine(app.clone(), app.state(), field(&args,"presetPath")?, field(&args,"modelsMax")?, defaulted(&args,"slotCacheMib")?, defaulted(&args,"envs")?).await?),
        "plugin:llamacpp|stop_engine" => encoded(engine::stop_engine(app.state()).await?),
        "plugin:llamacpp|force_stop_engine" => encoded(engine::force_stop_engine(app.state()).await?),
        "plugin:llamacpp|get_engine_info" => encoded(engine::get_engine_info(app.state()).await?),
        "plugin:llamacpp|get_engine_version" => encoded(engine::get_engine_version()),
        "plugin:llamacpp|engine_devices" => encoded(engine::engine_devices(app, defaulted(&args,"envs")?).await?),
        "plugin:llamacpp|reload_engine_models" => encoded(engine::reload_engine_models(app.state(), field(&args,"presetPath")?, optional(&args,"modelsMax")?, optional(&args,"slotCacheMib")?).await?),
        "plugin:llamacpp|engine_slots_idle" => encoded(engine::engine_slots_idle(app.state(), optional(&args,"modelId")?).await?),
        "plugin:llamacpp|begin_engine_restart" => encoded(engine::begin_engine_restart(app.state()).await?),
        "plugin:llamacpp|end_engine_restart" => encoded(engine::end_engine_restart(app.state()).await?),
        "plugin:llamacpp|erase_thread_slot_state" => encoded(engine::erase_thread_slot_state(app.state(), optional(&args,"threadId")?, optional(&args,"modelId")?, optional(&args,"cacheDir")?).await?),
        "plugin:llamacpp|read_gguf_metadata" => encoded(gguf::read_gguf_metadata(field(&args,"path")?).await?),
        "plugin:llamacpp|find_gguf_tensors" => encoded(gguf::find_gguf_tensors(field(&args,"path")?, field(&args,"names")?).await?),
        "plugin:llamacpp|is_model_supported" => {
            let path = field(&args,"path")?;
            let ctx = optional(&args,"ctxSize")?;
            tokio::task::spawn_blocking(move || tauri::async_runtime::block_on(async { encoded(gguf::is_model_supported(path, ctx).await?) })).await.map_err(|e| e.to_string())?
        }
        "plugin:llamacpp|start_diagnostics" => encoded(diagnose::start_diagnostics(app, field(&args,"preset")?, defaulted(&args,"devices")?, defaulted(&args,"envs")?, optional(&args,"model")?).await?),
        "plugin:llamacpp|cancel_diagnostics" => encoded(diagnose::cancel_diagnostics(app.clone(), app.state(), field(&args,"job")?).await?),
        "download_files" => {
            struct CancelOnDrop<R: Runtime>(tauri::AppHandle<R>, String, bool);
            impl<R: Runtime> Drop for CancelOnDrop<R> {
                fn drop(&mut self) {
                    if !self.2 { return; }
                    let app = self.0.clone();
                    let task = self.1.clone();
                    tauri::async_runtime::spawn(async move {
                        let _ = downloads::commands::pause_download_task(app.state(), &task).await;
                    });
                }
            }
            let task: String = field(&args,"taskId")?;
            let items = field(&args,"items")?;
            let headers = defaulted(&args,"headers")?;
            let mut cancel = CancelOnDrop(app.clone(), task.clone(), true);
            let result = downloads::commands::download_files(app.clone(), app.state(), items, &task, headers).await;
            cancel.2 = false;
            encoded(result?)
        }
        "pause_download_task" => encoded(downloads::commands::pause_download_task(app.state(), &field::<String>(&args,"taskId")?).await?),
        "cancel_download_task" => encoded(downloads::commands::cancel_download_task(app.state(), &field::<String>(&args,"taskId")?).await?),
        "get_secret" => encoded(crate::core::server::provider_secrets::get_secret(field(&args,"key")?).await),
        "open_dialog" => {
            // Only the native picker can grant access to external model files.
            let options = filesystem::models::DialogOpenOptions {
                multiple: Some(defaulted(&args,"multiple")?), directory: Some(false), default_path: None,
                filters: Some(vec![filesystem::models::DialogFilter { name: "GGUF model".into(), extensions: vec!["gguf".into()] }]),
            };
            encoded(filesystem::commands::open_dialog(app, Some(options)).await?)
        }
        "get_jan_data_folder_path" | "join_path" | "exists_sync" | "read_file_sync" | "write_file_sync" | "read_yaml" | "write_yaml" | "readdir_sync" | "mkdir" | "rm" | "mv" | "file_stat" | "settings_get" | "settings_set" | "settings_remove" | "plugin:hardware|get_system_info" | "plugin:hardware|get_system_usage" | "plugin:hardware|refresh_system_info" => {
            let command = command.to_owned();
            tokio::task::spawn_blocking(move || sync_invoke(app, &command, args)).await.map_err(|e| e.to_string())?
        }
        _ => Err(format!("unsupported native command: {command}")),
    }
}

fn sync_invoke<R: Runtime>(app: tauri::AppHandle<R>, command: &str, args: Value) -> Result<Value, String> {
    use filesystem::commands as fs;
    match command {
        "get_jan_data_folder_path" => encoded(get_jan_data_folder_path(app)),
        "join_path" => encoded(fs::join_path(app, field(&args,"args")?)?),
        "exists_sync" => encoded(fs::exists_sync(app, field(&args,"args")?)?),
        "read_file_sync" => encoded(fs::read_file_sync(app, field(&args,"args")?)?),
        "write_file_sync" => encoded(fs::write_file_sync(app, field(&args,"args")?)?),
        "readdir_sync" => encoded(fs::readdir_sync(app, field(&args,"args")?)?),
        "mkdir" => encoded(fs::mkdir(app, field(&args,"args")?)?),
        "rm" => encoded(fs::rm(app, field(&args,"args")?)?),
        "mv" => encoded(fs::mv(app, field(&args,"args")?)?),
        "file_stat" => encoded(fs::file_stat(app, field(&args,"args")?)?),
        "read_yaml" => fs::read_yaml(app, &field::<String>(&args,"path")?),
        "write_yaml" => encoded(fs::write_yaml(app, field(&args,"data")?, &field::<String>(&args,"savePath")?)?),
        "settings_get" => encoded(settings_store::settings_get(field(&args,"key")?)),
        "settings_set" => encoded(settings_store::settings_set(field(&args,"key")?, field(&args,"value")?)?),
        "settings_remove" => encoded(settings_store::settings_remove(field(&args,"key")?)?),
        "plugin:hardware|get_system_info" => encoded(tauri_plugin_hardware::get_system_info()),
        "plugin:hardware|get_system_usage" => encoded(tauri_plugin_hardware::get_system_usage()),
        "plugin:hardware|refresh_system_info" => encoded(tauri_plugin_hardware::refresh_system_info()),
        _ => Err(format!("unsupported native command: {command}")),
    }
}
