//! DSH's own web host (`dsh web`), the shell the app is moving to: every
//! screen there is a DSH UI plugin, and DSH's presets (Creator mode among
//! them) come with it. Separate from the stdio runtime in `mod.rs`, which the
//! Jan UI still talks to; both can run at once.
//!
//! The host keeps its state in `<data>/dsh/web-home` (DSH_HOME) and boots the
//! `web` profile, which DSH initializes from its shipped template on first use.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{oneshot, Mutex};

/// The window that shows the host; the navigation guard lets it stay on the
/// host's origin.
pub const WINDOW_LABEL: &str = "dsh-app";

/// How long the first boot may take; a fresh DSH_HOME installs its profile.
const BOOT_TIMEOUT: Duration = Duration::from_secs(120);

pub(crate) struct WebHost {
    child: Child,
    url: String,
    root: PathBuf,
}

#[derive(Default)]
pub struct DshWebState {
    pub(crate) host: Mutex<Option<WebHost>>,
}

fn cli(root: &Path) -> PathBuf {
    root.join("apps/cli/lib/bin.js")
}

/// `dsh web` prints `dsh web: <url>` once it listens; that line is the only
/// way to learn the port when it asked the OS for a free one.
fn url_of(line: &str) -> Option<String> {
    let rest = line.trim().strip_prefix("dsh web:")?.trim();
    rest.starts_with("http").then(|| rest.to_string())
}

/// Starts the web host for the checkout at `root`, or returns the running
/// one's URL. Resolves once the host prints its URL.
pub(crate) async fn start(state: &DshWebState, data_dir: &Path, root: &Path) -> Result<String, String> {
    let mut slot = state.host.lock().await;
    if let Some(host) = slot.as_mut() {
        if host.root == root && host.child.try_wait().ok().flatten().is_none() {
            return Ok(host.url.clone());
        }
    }
    if let Some(mut old) = slot.take() {
        let _ = old.child.kill().await;
    }

    let bin = cli(root);
    if !bin.is_file() {
        return Err(format!(
            "{} is not a built deepseek-harness checkout (missing apps/cli/lib/bin.js; run `pnpm run build` there)",
            root.display()
        ));
    }
    let home = data_dir.join("web-home");
    let workspace = data_dir.join("workspace");
    std::fs::create_dir_all(&home).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&workspace).map_err(|e| e.to_string())?;

    let mut cmd = Command::new("node");
    cmd.arg(&bin)
        .args(["web", "--host", "127.0.0.1", "--port", "0"])
        // The invoking directory is DSH's default workspace root.
        .current_dir(&workspace)
        .env("DSH_HOME", &home)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("could not start node (is Node 22+ on PATH?): {e}"))?;

    let stdout = child.stdout.take().ok_or("no stdout")?;
    let stderr = child.stderr.take().ok_or("no stderr")?;
    let (tx, rx) = oneshot::channel::<String>();
    tauri::async_runtime::spawn(async move {
        let mut tx = Some(tx);
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            log::debug!("[dsh-web] {line}");
            if let Some(url) = url_of(&line) {
                if let Some(tx) = tx.take() {
                    let _ = tx.send(url);
                }
            }
        }
    });
    tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            log::debug!("[dsh-web] {line}");
        }
    });

    let url = match tokio::time::timeout(BOOT_TIMEOUT, rx).await {
        Ok(Ok(url)) => url,
        _ => {
            let _ = child.kill().await;
            return Err("the DSH web host did not start; see the app log for its output".into());
        }
    };
    *slot = Some(WebHost { child, url: url.clone(), root: root.to_path_buf() });
    Ok(url)
}

/// Whether `url` is on the running host's origin. A blocking read: the
/// navigation hook is synchronous, and `start` holds the lock only to spawn.
pub(crate) fn is_host_url<R: tauri::Runtime>(app: &tauri::AppHandle<R>, url: &tauri::Url) -> bool {
    use tauri::Manager;
    let state = app.state::<crate::core::state::AppState>();
    let Ok(slot) = state.dsh_web.host.try_lock() else {
        return false;
    };
    let Some(host) = slot.as_ref() else { return false };
    let Ok(origin) = tauri::Url::parse(&host.url) else { return false };
    url.scheme() == origin.scheme()
        && url.host_str() == origin.host_str()
        && url.port_or_known_default() == origin.port_or_known_default()
}

pub async fn stop(state: &DshWebState) {
    if let Some(mut host) = state.host.lock().await.take() {
        let _ = host.child.kill().await;
    }
}
