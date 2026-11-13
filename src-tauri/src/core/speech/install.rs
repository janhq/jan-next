use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

use futures_util::StreamExt;
use serde::Serialize;
use tauri::{Emitter, Runtime};
use tokio::io::AsyncWriteExt;

use super::{
    bin_dir, espeak_dir, file_has_size, Asset, SpeechState, ARCHIVE, ESPEAK, ESPEAK_DATA,
    MODEL_ASSETS,
};

const PROGRESS_INTERVAL: Duration = Duration::from_millis(100);

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Progress<'a> {
    file: &'a str,
    downloaded: u64,
    total: u64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InstallDone {
    pub error: Option<String>,
}

struct InstallGuard<'a>(&'a SpeechState);

impl<'a> InstallGuard<'a> {
    fn acquire(state: &'a SpeechState) -> Result<Self, String> {
        if state.installing.swap(true, Ordering::SeqCst) {
            return Err("voice install is already in progress".into());
        }
        Ok(Self(state))
    }
}

impl Drop for InstallGuard<'_> {
    fn drop(&mut self) {
        self.0.installing.store(false, Ordering::SeqCst);
    }
}

pub(crate) async fn install<R: Runtime>(
    app: &tauri::AppHandle<R>,
    state: &SpeechState,
    speech: &Path,
) -> Result<(), String> {
    let _guard = InstallGuard::acquire(state)?;
    let result = run_install(app, speech).await;
    let _ = app.emit(
        "speech-install-done",
        InstallDone {
            error: result.as_ref().err().cloned(),
        },
    );
    result
}

async fn run_install<R: Runtime>(app: &tauri::AppHandle<R>, speech: &Path) -> Result<(), String> {
    let client = reqwest::Client::new();
    let bin = bin_dir(speech);
    tokio::fs::create_dir_all(&bin)
        .await
        .map_err(|e| format!("create {}: {e}", bin.display()))?;

    if !file_has_size(&bin.join(ARCHIVE.binary), ARCHIVE.binary_size) {
        let archive = speech.join("server-archive.part");
        let name = ARCHIVE.url.rsplit('/').next().unwrap_or("server");
        download(app, &client, ARCHIVE.url, &archive, None, name).await?;
        let (a, b) = (archive.clone(), bin.clone());
        let extracted = tokio::task::spawn_blocking(move || extract(&a, &b))
            .await
            .map_err(|e| e.to_string())?;
        let _ = tokio::fs::remove_file(&archive).await;
        extracted?;
        if !file_has_size(&bin.join(ARCHIVE.binary), ARCHIVE.binary_size) {
            return Err("extracted voice server has an unexpected size".into());
        }
    }

    let espeak = espeak_dir(speech);
    if !espeak.join(ESPEAK_DATA).join("phontab").is_file() {
        let wheel = speech.join("espeak.whl");
        let name = ESPEAK.url.rsplit('/').next().unwrap_or("espeak");
        let asset = Asset {
            rel: "espeak.whl",
            url: ESPEAK.url,
            size: ESPEAK.size,
        };
        download(app, &client, ESPEAK.url, &wheel, Some(&asset), name).await?;
        let (a, b) = (wheel.clone(), espeak.clone());
        let extracted = tokio::task::spawn_blocking(move || extract_zip(&a, &b))
            .await
            .map_err(|e| e.to_string())?;
        let _ = tokio::fs::remove_file(&wheel).await;
        extracted?;
    }

    for asset in &MODEL_ASSETS {
        let dest = speech.join(asset.rel);
        if file_has_size(&dest, asset.size) {
            continue;
        }
        if let Some(dir) = dest.parent() {
            tokio::fs::create_dir_all(dir)
                .await
                .map_err(|e| format!("create {}: {e}", dir.display()))?;
        }
        let name = asset.rel.rsplit('/').next().unwrap_or(asset.rel);
        download(app, &client, asset.url, &dest, Some(asset), name).await?;
    }

    // Left behind by installs from before Kokoro.
    let _ = tokio::fs::remove_dir_all(speech.join("models/pocket-tts")).await;

    // The port is picked per start; this just leaves a valid config on disk.
    super::server::write_config(speech, 0)
}

async fn download<R: Runtime>(
    app: &tauri::AppHandle<R>,
    client: &reqwest::Client,
    url: &str,
    dest: &Path,
    asset: Option<&Asset>,
    label: &str,
) -> Result<(), String> {
    let resp = client
        .get(url)
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("download {label}: {e}"))?;
    let total = asset
        .map(|a| a.size)
        .or_else(|| resp.content_length())
        .unwrap_or(0);

    // `.part` + rename keeps a half-written file from passing the size check.
    let part: PathBuf = if asset.is_some() {
        let mut p = dest.as_os_str().to_owned();
        p.push(".part");
        p.into()
    } else {
        dest.to_path_buf()
    };
    let mut file = tokio::fs::File::create(&part)
        .await
        .map_err(|e| format!("create {}: {e}", part.display()))?;

    let emit = |downloaded: u64| {
        let _ = app.emit(
            "speech-install-progress",
            Progress {
                file: label,
                downloaded,
                total,
            },
        );
    };

    let mut downloaded = 0u64;
    let mut last = Instant::now() - PROGRESS_INTERVAL;
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("download {label}: {e}"))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("write {}: {e}", part.display()))?;
        downloaded += chunk.len() as u64;
        if last.elapsed() >= PROGRESS_INTERVAL {
            emit(downloaded);
            last = Instant::now();
        }
    }
    file.flush().await.map_err(|e| e.to_string())?;
    drop(file);
    emit(downloaded);

    if let Some(a) = asset {
        if downloaded != a.size {
            let _ = tokio::fs::remove_file(&part).await;
            return Err(format!(
                "download {label}: got {downloaded} bytes, expected {}",
                a.size
            ));
        }
        tokio::fs::rename(&part, dest)
            .await
            .map_err(|e| format!("rename {}: {e}", part.display()))?;
    }
    Ok(())
}

fn extract_zip(archive: &Path, dest: &Path) -> Result<(), String> {
    let file = std::fs::File::open(archive).map_err(|e| e.to_string())?;
    zip::ZipArchive::new(file)
        .and_then(|mut z| z.extract(dest))
        .map_err(|e| format!("extract {}: {e}", archive.display()))
}

#[cfg(target_os = "windows")]
fn extract(archive: &Path, dest: &Path) -> Result<(), String> {
    extract_zip(archive, dest)
}

// `unpack` keeps the executable bit and refuses entries escaping `dest`.
#[cfg(target_os = "macos")]
fn extract(archive: &Path, dest: &Path) -> Result<(), String> {
    let file = std::fs::File::open(archive).map_err(|e| e.to_string())?;
    tar::Archive::new(flate2::read::GzDecoder::new(file))
        .unpack(dest)
        .map_err(|e| format!("extract voice server: {e}"))
}
