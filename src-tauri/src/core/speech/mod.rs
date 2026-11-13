//! Local voice (TTS + ASR) served by audio.cpp's prebuilt `audiocpp_server`,
//! run as a sidecar child process. The server and its models are downloaded on
//! demand into `<data folder>/speech/`.

pub mod commands;
mod install;
mod server;

use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;

use serde::Serialize;
use tokio::process::Child;
use tokio::sync::Mutex;

pub(crate) const TTS_MODEL_ID: &str = "kokoro-82m";
pub(crate) const ASR_MODEL_ID: &str = "sensevoice-small";
/// Used when the caller doesn't pick one; Kokoro's own default.
pub(crate) const DEFAULT_VOICE: &str = "af_heart";

/// Something install must fetch: `rel` is relative to the speech dir.
pub(crate) struct Asset {
    pub rel: &'static str,
    pub url: &'static str,
    pub size: u64,
}

pub(crate) const MODEL_ASSETS: [Asset; 3] = [
    // BF16, not Q8: the Q8 decoder is ~50x slower on Vulkan.
    Asset {
        rel: "models/kokoro/kokoro-82m-bf16.gguf",
        url: "https://huggingface.co/audio-cpp/audio.cpp-gguf/resolve/73ce4162f6cce370dd533c6782b772135c1b2a8e/Kokoro-82M-GGUF/kokoro-82m-bf16.gguf",
        size: 211_956_384,
    },
    Asset {
        rel: "models/sensevoice/sensevoice-small-q8-audiocpp-v1.gguf",
        url: "https://huggingface.co/FunAudioLLM/SenseVoiceSmall-GGUF-audiocpp/resolve/5c3fcfe748a8714216bc135476d5863084fddb72/sensevoice-small-q8-audiocpp-v1.gguf",
        size: 254_211_200,
    },
    // The release archive lacks this; the server resolves it relative to its
    // CWD, which is `bin/`.
    Asset {
        rel: "bin/assets/framework/models/silero_vad/silero_vad_16k.safetensors",
        url: "https://raw.githubusercontent.com/0xShug0/audio.cpp/f7ac446f/assets/framework/models/silero_vad/silero_vad_16k.safetensors",
        size: 1_239_748,
    },
];

pub(crate) struct ServerArchive {
    pub url: &'static str,
    /// Path of the server binary inside `bin/` after extraction.
    pub binary: &'static str,
    /// Expected binary size: doubles as the "already extracted" check.
    pub binary_size: u64,
    pub backend: &'static str,
}

// Vulkan, not CPU: Kokoro's decoder takes ~10 s per sentence on CPU and
// ~0.5 s on a GPU.
#[cfg(target_os = "windows")]
pub(crate) const ARCHIVE: ServerArchive = ServerArchive {
    url: "https://github.com/0xShug0/audio.cpp/releases/download/v0.9.4/audio-v0.9.4-bin-windows-x64-vulkan-portable.zip",
    binary: "audiocpp_server.exe",
    binary_size: 97_379_840,
    backend: "vulkan",
};

/// Kokoro phonemizes through eSpeak NG, which audio.cpp loads at runtime but
/// does not ship. These are the `espeakng-loader` wheels (eSpeak NG 1.52,
/// GPL-3.0): plain zips holding the library and its data.
pub(crate) struct Espeak {
    pub url: &'static str,
    pub size: u64,
    /// Library path inside `espeak/` after extraction.
    pub library: &'static str,
}

pub(crate) const ESPEAK_DATA: &str = "espeakng_loader/espeak-ng-data";

#[cfg(target_os = "windows")]
pub(crate) const ESPEAK: Espeak = Espeak {
    url: "https://files.pythonhosted.org/packages/9d/ed/a3d872fbad4f3a3f3db0e8c31768ab14e77cd77306de16b8b20b1e1df7ea/espeakng_loader-0.2.4-py3-none-win_amd64.whl",
    size: 9_437_292,
    library: "espeakng_loader/espeak-ng.dll",
};

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
pub(crate) const ESPEAK: Espeak = Espeak {
    url: "https://files.pythonhosted.org/packages/a8/26/258c0cd43b9bc1043301c5f61767d6a6c3b679df82790c9cb43a3277b865/espeakng_loader-0.2.4-py3-none-macosx_11_0_arm64.whl",
    size: 9_892_565,
    library: "espeakng_loader/libespeak-ng.dylib",
};

#[cfg(all(target_os = "macos", not(target_arch = "aarch64")))]
pub(crate) const ESPEAK: Espeak = Espeak {
    url: "https://files.pythonhosted.org/packages/f8/92/f44ed7f531143c3c6c97d56e2b0f9be8728dc05e18b96d46eb539230ed46/espeakng_loader-0.2.4-py3-none-macosx_10_12_x86_64.whl",
    size: 9_938_387,
    library: "espeakng_loader/libespeak-ng.dylib",
};

pub(crate) fn espeak_dir(speech: &Path) -> PathBuf {
    speech.join("espeak")
}

/// The female presets that sound right for an English waifu: American (`af_`)
/// and British (`bf_`). Kokoro has others, but they're male or need extra data.
pub(crate) const VOICES: [&str; 15] = [
    "af_heart", "af_bella", "af_nicole", "af_sky", "af_nova", "af_aoede", "af_kore", "af_jessica",
    "af_sarah", "af_alloy", "af_river", "bf_emma", "bf_isabella", "bf_alice", "bf_lily",
];

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
pub(crate) const ARCHIVE: ServerArchive = ServerArchive {
    url: "https://github.com/0xShug0/audio.cpp/releases/download/v0.9.4/audio-v0.9.4-bin-macos-arm64-metal.tar.gz",
    binary: "audiocpp_server",
    binary_size: 50_461_280,
    backend: "metal",
};

#[cfg(all(target_os = "macos", not(target_arch = "aarch64")))]
pub(crate) const ARCHIVE: ServerArchive = ServerArchive {
    url: "https://github.com/0xShug0/audio.cpp/releases/download/v0.9.4/audio-v0.9.4-bin-macos-x64-metal.tar.gz",
    binary: "audiocpp_server",
    binary_size: 55_594_568,
    backend: "metal",
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechStatus {
    pub installed: bool,
    pub running: bool,
    pub installing: bool,
}

pub(crate) struct RunningServer {
    pub child: Child,
    pub port: u16,
}

#[derive(Default)]
pub struct SpeechState {
    /// Held across the whole spawn + health wait, so concurrent lazy starts
    /// can't launch two servers.
    pub(crate) server: Mutex<Option<RunningServer>>,
    pub(crate) installing: AtomicBool,
}

pub(crate) fn speech_dir(data_folder: &Path) -> PathBuf {
    data_folder.join("speech")
}

pub(crate) fn bin_dir(speech: &Path) -> PathBuf {
    speech.join("bin")
}

pub(crate) fn file_has_size(path: &Path, size: u64) -> bool {
    std::fs::metadata(path).is_ok_and(|m| m.is_file() && m.len() == size)
}

pub(crate) fn is_installed(speech: &Path) -> bool {
    file_has_size(&bin_dir(speech).join(ARCHIVE.binary), ARCHIVE.binary_size)
        && espeak_dir(speech).join(ESPEAK_DATA).join("phontab").is_file()
        && MODEL_ASSETS
            .iter()
            .all(|a| file_has_size(&speech.join(a.rel), a.size))
}

pub async fn stop(state: &SpeechState) {
    server::stop(state).await;
}

