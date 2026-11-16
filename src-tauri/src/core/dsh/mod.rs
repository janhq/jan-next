//! DeepSeek Harness (DSH) as an agent backend: one long-lived Node child that
//! serves DSH's SDK JSON-RPC over stdio. Rust only owns the process and moves
//! lines; the web-app speaks the protocol (`lib/dsh-chat-transport.ts`).
//!
//! DSH runs from a local checkout of `deepseek-harness` with `pnpm install`
//! done, because its plugins resolve from `<checkout>/examples/node_modules`.

pub mod commands;
pub mod plugins;
pub mod native;
pub mod web;

use std::path::{Path, PathBuf};
use std::process::Stdio;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Runtime};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::Mutex;

/// Event carrying one stdout line (a JSON-RPC frame) to the web-app.
pub const LINE_EVENT: &str = "dsh-line";
/// Emitted when the runtime exits; payload is the stderr tail.
pub const EXIT_EVENT: &str = "dsh-exit";

/// Where the runtime's model requests go. The runtime is started for one
/// endpoint; the transport restarts it when the thread's model points elsewhere.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DshLaunch {
    /// The deepseek-harness checkout.
    pub root: String,
    /// OpenAI-compatible base URL ending in `/v1`.
    pub base_url: String,
    pub api_key: String,
    /// The runtime serves one model; a different one means a restart.
    pub model: String,
    /// Agent workspace for bash and file tools; empty means a private folder
    /// under the app's data, so the agent never lands in the home folder.
    pub cwd: String,
}

pub(crate) struct Running {
    child: Child,
    stdin: ChildStdin,
    launch: DshLaunch,
}

#[derive(Default)]
pub struct DshState {
    pub(crate) running: Mutex<Option<Running>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DshStatus {
    pub running: bool,
    pub launch: Option<DshLaunch>,
}

fn bin(root: &Path) -> PathBuf {
    root.join("packages/examples/jsonrpc-demo/lib/bin.js")
}

fn plugins(root: &Path) -> PathBuf {
    // Rebuilt from components so every separator is native: cmd's `mklink`
    // reads a `/` inside a path as a switch, and `read_link` returns native
    // separators, which the relink check compares against.
    root.join("examples/node_modules").components().collect()
}

/// Checks the checkout is usable before spawning, so the user sees what is
/// missing instead of a Node module-resolution stack.
pub(crate) fn check_root(root: &Path) -> Result<(), String> {
    if !bin(root).is_file() {
        return Err(format!(
            "{} is not a built deepseek-harness checkout (missing packages/examples/jsonrpc-demo/lib/bin.js)",
            root.display()
        ));
    }
    if !plugins(root).is_dir() {
        return Err(format!(
            "run `pnpm install` in {} first (missing examples/node_modules)",
            root.display()
        ));
    }
    Ok(())
}

/// The config must sit next to a `node_modules` that holds the plugins, since
/// Cordis resolves plugin names from the config file's folder.
fn write_config(data_dir: &Path, root: &Path) -> Result<PathBuf, String> {
    std::fs::create_dir_all(data_dir).map_err(|e| e.to_string())?;
    let link = data_dir.join("node_modules");
    let target = plugins(root);
    let current = std::fs::read_link(&link).ok();
    if current.as_deref() != Some(target.as_path()) {
        if link.exists() || current.is_some() {
            remove_link(&link)?;
        }
        make_link(&target, &link)?;
    }
    let path = data_dir.join("cordis.yml");
    // The composition: shipped base + plugins.yml + Jan's MCP servers
    // (mcp_config.json lives in the data folder, the parent of `dsh/`).
    let data_root = data_dir.parent().unwrap_or(data_dir);
    plugins::write_server(data_dir)?;
    std::fs::write(&path, plugins::compose(data_dir, data_root, root)?).map_err(|e| e.to_string())?;
    Ok(path)
}

#[cfg(windows)]
fn make_link(target: &Path, link: &Path) -> Result<(), String> {
    // A junction needs no Developer Mode, unlike a directory symlink.
    let status = std::process::Command::new("cmd")
        .args(["/C", "mklink", "/J"])
        .arg(link)
        .arg(target)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|e| e.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("could not link {} to {}", link.display(), target.display()))
    }
}

#[cfg(not(windows))]
fn make_link(target: &Path, link: &Path) -> Result<(), String> {
    std::os::unix::fs::symlink(target, link).map_err(|e| e.to_string())
}

fn remove_link(link: &Path) -> Result<(), String> {
    // A junction or symlink to a directory is removed as a directory on
    // Windows and as a file elsewhere; neither touches the target.
    std::fs::remove_dir(link)
        .or_else(|_| std::fs::remove_file(link))
        .map_err(|e| format!("could not replace {}: {e}", link.display()))
}

pub(crate) async fn start<R: Runtime>(
    app: &AppHandle<R>,
    state: &DshState,
    data_dir: &Path,
    launch: DshLaunch,
) -> Result<(), String> {
    let mut slot = state.running.lock().await;
    if let Some(running) = slot.as_mut() {
        if running.launch == launch && running.child.try_wait().ok().flatten().is_none() {
            return Ok(());
        }
    }
    if let Some(old) = slot.take() {
        stop_running(old).await;
    }

    let root = PathBuf::from(&launch.root);
    check_root(&root)?;
    let config = write_config(data_dir, &root)?;
    let cwd = if launch.cwd.trim().is_empty() {
        let dir = data_dir.join("workspace");
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        dir
    } else {
        PathBuf::from(&launch.cwd)
    };

    let mut cmd = Command::new("node");
    cmd.arg(bin(&root))
        .arg(&config)
        .current_dir(&root)
        .env("DEEPSEEK_BASE_URL", &launch.base_url)
        // The adapter refuses an empty key; local servers ignore it.
        .env(
            "DEEPSEEK_API_KEY",
            if launch.api_key.is_empty() { "none" } else { &launch.api_key },
        )
        .env("DSH_CWD", &cwd)
        .env("OW_MODEL", &launch.model)
        .env("OW_DSH_HOME", data_dir.join("home"))
        .env("DSH_SESSION_ROOT", data_dir.join("sessions"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("could not start node (is Node 22+ on PATH?): {e}"))?;

    let stdin = child.stdin.take().ok_or("no stdin")?;
    let stdout = child.stdout.take().ok_or("no stdout")?;
    let stderr = child.stderr.take().ok_or("no stderr")?;
    let pid = child.id();

    let out_app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if !line.trim().is_empty() {
                let _ = out_app.emit(LINE_EVENT, line);
            }
        }
    });
    let err_app = app.clone();
    tauri::async_runtime::spawn(async move {
        // Keep a tail for the exit report; the full log goes to the app log.
        let mut tail: Vec<String> = Vec::new();
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            log::debug!("[dsh] {line}");
            tail.push(line);
            if tail.len() > 40 {
                tail.remove(0);
            }
        }
        // stderr closes when the process exits.
        let _ = err_app.emit(EXIT_EVENT, serde_json::json!({ "pid": pid, "stderr": tail.join("\n") }));
    });

    *slot = Some(Running { child, stdin, launch });
    Ok(())
}

pub(crate) async fn send(state: &DshState, line: &str) -> Result<(), String> {
    let mut slot = state.running.lock().await;
    let running = slot.as_mut().ok_or("DSH is not running")?;
    let mut frame = line.trim_end().to_owned();
    frame.push('\n');
    running
        .stdin
        .write_all(frame.as_bytes())
        .await
        .map_err(|e| format!("DSH stdin closed: {e}"))?;
    running.stdin.flush().await.map_err(|e| e.to_string())
}

pub(crate) async fn status(state: &DshState) -> DshStatus {
    let mut slot = state.running.lock().await;
    if let Some(r) = slot.as_mut() {
        if r.child.try_wait().ok().flatten().is_none() {
            return DshStatus {
                running: true,
                launch: Some(r.launch.clone()),
            };
        }
    }
    DshStatus { running: false, launch: None }
}

async fn stop_running(mut running: Running) {
    // Closing stdin is the runtime's normal shutdown path (it disposes its
    // context and flushes sessions); kill only if it lingers.
    drop(running.stdin);
    if tokio::time::timeout(std::time::Duration::from_secs(3), running.child.wait())
        .await
        .is_err()
    {
        let _ = running.child.kill().await;
    }
}

/// Restarts the running runtime with its own launch so a changed plugin set
/// takes effect. Without a running runtime there is nothing to restart: the
/// next start composes the current config.
pub(crate) async fn restart<R: Runtime>(
    app: &AppHandle<R>,
    state: &DshState,
    data_dir: &Path,
) -> Result<(), String> {
    let launch = {
        let slot = state.running.lock().await;
        slot.as_ref().map(|r| r.launch.clone())
    };
    let Some(launch) = launch else { return Ok(()) };
    if let Some(old) = state.running.lock().await.take() {
        stop_running(old).await;
    }
    start(app, state, data_dir, launch).await
}

pub async fn stop(state: &DshState) {
    if let Some(running) = state.running.lock().await.take() {
        stop_running(running).await;
    }
}
