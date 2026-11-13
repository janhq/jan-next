use std::path::Path;
use std::process::Stdio;
use std::time::Duration;

use serde_json::json;
use tokio::process::Command;

use super::{
    bin_dir, espeak_dir, is_installed, RunningServer, SpeechState, ARCHIVE, ASR_MODEL_ID, ESPEAK,
    ESPEAK_DATA, MODEL_ASSETS, TTS_MODEL_ID,
};

const HEALTH_TIMEOUT: Duration = Duration::from_secs(30);
const HEALTH_POLL: Duration = Duration::from_millis(250);
const LOG_TAIL_BYTES: u64 = 2048;

pub(crate) fn http_client() -> Result<reqwest::Client, String> {
    // Loopback only: a system proxy must never see this traffic.
    reqwest::Client::builder()
        .no_proxy()
        .build()
        .map_err(|e| e.to_string())
}

fn json_path(p: &Path) -> String {
    p.to_string_lossy().replace('\\', "/")
}

pub(crate) fn write_config(speech: &Path, port: u16) -> Result<(), String> {
    let model = |i: usize| json_path(&speech.join(MODEL_ASSETS[i].rel));
    let config = json!({
        "host": "127.0.0.1",
        "port": port,
        "backend": ARCHIVE.backend,
        "lazy_load": true,
        "models": [
            {"id": TTS_MODEL_ID, "family": "kokoro_tts", "path": model(0), "task": "tts", "mode": "offline"},
            {"id": ASR_MODEL_ID, "family": "sense_asr", "path": model(1), "task": "asr", "mode": "offline"},
        ],
    });
    std::fs::write(speech.join("server.json"), config.to_string())
        .map_err(|e| format!("write server.json: {e}"))
}

fn log_tail(path: &Path) -> String {
    use std::io::{Read, Seek, SeekFrom};
    let Ok(mut f) = std::fs::File::open(path) else {
        return String::new();
    };
    let len = f.metadata().map(|m| m.len()).unwrap_or(0);
    let _ = f.seek(SeekFrom::Start(len.saturating_sub(LOG_TAIL_BYTES)));
    let mut buf = Vec::new();
    let _ = f.read_to_end(&mut buf);
    String::from_utf8_lossy(&buf).trim().to_string()
}

/// Returns the port of a running server, starting one if needed.
pub(crate) async fn ensure_running(state: &SpeechState, speech: &Path) -> Result<u16, String> {
    if !is_installed(speech) {
        return Err("voice is not installed".into());
    }
    let mut slot = state.server.lock().await;
    if let Some(running) = slot.as_mut() {
        match running.child.try_wait() {
            Ok(None) => return Ok(running.port),
            _ => *slot = None,
        }
    }

    let port = {
        let listener =
            std::net::TcpListener::bind(("127.0.0.1", 0)).map_err(|e| format!("pick port: {e}"))?;
        listener.local_addr().map_err(|e| e.to_string())?.port()
    };
    write_config(speech, port)?;

    let log_path = speech.join("server.log");
    let log = std::fs::File::create(&log_path).map_err(|e| format!("create server.log: {e}"))?;
    let log_err = log.try_clone().map_err(|e| e.to_string())?;
    let threads = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(1)
        .min(8);

    let bin = bin_dir(speech);
    let espeak = espeak_dir(speech);
    let mut cmd = Command::new(bin.join(ARCHIVE.binary));
    cmd.current_dir(&bin)
        .env("AUDIOCPP_ESPEAK_LIBRARY", espeak.join(ESPEAK.library))
        .env("AUDIOCPP_ESPEAK_DATA", espeak.join(ESPEAK_DATA))
        .arg("--config")
        .arg(speech.join("server.json"))
        .args(["--no-ui", "--threads"])
        .arg(threads.to_string())
        .stdin(Stdio::null())
        .stdout(log)
        .stderr(log_err)
        .kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("start voice server: {e}"))?;

    let client = http_client()?;
    let health = format!("http://127.0.0.1:{port}/health");
    let deadline = tokio::time::Instant::now() + HEALTH_TIMEOUT;
    loop {
        if let Ok(Some(status)) = child.try_wait() {
            return Err(format!(
                "voice server exited ({status}): {}",
                log_tail(&log_path)
            ));
        }
        let ok = client
            .get(&health)
            .timeout(Duration::from_secs(2))
            .send()
            .await
            .is_ok_and(|r| r.status().is_success());
        if ok {
            break;
        }
        if tokio::time::Instant::now() >= deadline {
            let _ = child.kill().await;
            return Err(format!(
                "voice server did not become healthy within {}s: {}",
                HEALTH_TIMEOUT.as_secs(),
                log_tail(&log_path)
            ));
        }
        tokio::time::sleep(HEALTH_POLL).await;
    }

    *slot = Some(RunningServer { child, port });
    Ok(port)
}

pub(crate) async fn stop(state: &SpeechState) {
    if let Some(mut running) = state.server.lock().await.take() {
        if let Err(e) = running.child.kill().await {
            log::warn!("Failed to stop the voice server: {e}");
        }
    }
}

pub(crate) async fn is_running(state: &SpeechState) -> bool {
    // A start in flight holds the lock; that isn't "running" yet.
    match state.server.try_lock() {
        Ok(mut slot) => slot
            .as_mut()
            .is_some_and(|r| matches!(r.child.try_wait(), Ok(None))),
        Err(_) => false,
    }
}

async fn error_message(resp: reqwest::Response) -> String {
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    serde_json::from_str::<serde_json::Value>(&body)
        .ok()
        .and_then(|v| v["error"]["message"].as_str().map(str::to_owned))
        .unwrap_or_else(|| format!("voice server returned {status}: {body}"))
}

pub(crate) async fn speak(port: u16, text: &str, voice: &str) -> Result<Vec<u8>, String> {
    let resp = http_client()?
        .post(format!("http://127.0.0.1:{port}/v1/audio/speech"))
        .timeout(Duration::from_secs(120))
        .json(&json!({"model": TTS_MODEL_ID, "input": text, "voice": voice}))
        .send()
        .await
        .map_err(|e| format!("voice request failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(error_message(resp).await);
    }
    resp.bytes()
        .await
        .map(|b| b.to_vec())
        .map_err(|e| e.to_string())
}

pub(crate) async fn transcribe(port: u16, wav: &[u8]) -> Result<String, String> {
    // reqwest's `multipart` feature isn't enabled in this crate; two fields
    // don't justify turning it on.
    let boundary = "----openwaifuspeech7e3a91";
    let mut body = Vec::with_capacity(wav.len() + 512);
    body.extend_from_slice(
        format!(
            "--{boundary}\r\nContent-Disposition: form-data; name=\"model\"\r\n\r\n{ASR_MODEL_ID}\r\n\
             --{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"audio.wav\"\r\n\
             Content-Type: audio/wav\r\n\r\n"
        )
        .as_bytes(),
    );
    body.extend_from_slice(wav);
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());

    let resp = http_client()?
        .post(format!("http://127.0.0.1:{port}/v1/audio/transcriptions"))
        .timeout(Duration::from_secs(300))
        .header(
            reqwest::header::CONTENT_TYPE,
            format!("multipart/form-data; boundary={boundary}"),
        )
        .body(body)
        .send()
        .await
        .map_err(|e| format!("voice request failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(error_message(resp).await);
    }
    let v: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    v["text"]
        .as_str()
        .map(|s| s.trim().to_string())
        .ok_or_else(|| "voice server response had no text".into())
}
