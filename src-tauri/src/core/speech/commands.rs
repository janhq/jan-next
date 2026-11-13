use std::future::Future;
use std::path::Path;

use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Runtime, State};

use super::{
    install, is_installed, server, speech_dir, SpeechStatus, DEFAULT_VOICE, VOICES,
};
use crate::core::app::commands::get_jan_data_folder_path;
use crate::core::state::AppState;

fn dir<R: Runtime>(app: &AppHandle<R>) -> std::path::PathBuf {
    speech_dir(&get_jan_data_folder_path(app.clone()))
}

#[tauri::command]
pub async fn speech_status<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
) -> Result<SpeechStatus, String> {
    let speech = state.speech();
    Ok(SpeechStatus {
        installed: is_installed(&dir(&app)),
        running: server::is_running(speech).await,
        installing: speech
            .installing
            .load(std::sync::atomic::Ordering::SeqCst),
    })
}

#[tauri::command]
pub async fn speech_install<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    install::install(&app, state.speech(), &dir(&app)).await
}

#[tauri::command]
pub async fn speech_start<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    server::ensure_running(state.speech(), &dir(&app))
        .await
        .map(|_| ())
}

#[tauri::command]
pub async fn speech_stop(state: State<'_, AppState>) -> Result<(), String> {
    server::stop(state.speech()).await;
    Ok(())
}

#[tauri::command]
pub async fn speech_speak<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    text: String,
    voice: Option<String>,
) -> Result<Response, String> {
    // Unknown names fall back rather than error: a voice saved by an older build
    // shouldn't break reading aloud.
    let voice = voice
        .as_deref()
        .filter(|v| VOICES.contains(v))
        .unwrap_or(DEFAULT_VOICE);
    let speech = dir(&app);
    with_restart(state.speech(), &speech, |port| server::speak(port, &text, voice))
        .await
        .map(Response::new)
}

/// audio.cpp occasionally crashes mid-request (seen on the first ASR call after
/// start). `ensure_running` respawns a dead server, so retry once on that.
async fn with_restart<T, F, Fut>(
    state: &super::SpeechState,
    speech: &Path,
    call: F,
) -> Result<T, String>
where
    F: Fn(u16) -> Fut,
    Fut: Future<Output = Result<T, String>>,
{
    let port = server::ensure_running(state, speech).await?;
    match call(port).await {
        Err(e) if !server::is_running(state).await => {
            log::warn!("Voice server died during a request, restarting: {e}");
            call(server::ensure_running(state, speech).await?).await
        }
        result => result,
    }
}

#[tauri::command]
pub async fn speech_transcribe<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    request: Request<'_>,
) -> Result<String, String> {
    let InvokeBody::Raw(wav) = request.body() else {
        return Err("speech_transcribe expects raw WAV bytes".into());
    };
    let speech = dir(&app);
    with_restart(state.speech(), &speech, |port| server::transcribe(port, wav)).await
}
