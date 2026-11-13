use std::collections::HashMap;
use std::sync::Arc;

use crate::core::downloads::models::DownloadManagerState;
use tokio::sync::Mutex;

/// Server handle type for managing the proxy server lifecycle
pub type ServerHandle =
    tokio::task::JoinHandle<Result<(), Box<dyn std::error::Error + Send + Sync>>>;

/// Provider configuration for remote model providers
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct ProviderConfig {
    pub provider: String,
    /// First key (mirrors `api_keys[0]` when populated); kept for backward compatibility.
    pub api_key: Option<String>,
    /// Ordered keys for Bearer auth: proxy tries each on 401/403/429.
    #[serde(default)]
    pub api_keys: Vec<String>,
    pub base_url: Option<String>,
    pub custom_headers: Vec<ProviderCustomHeader>,
    pub models: Vec<String>,
    /// Share of the context window a prompt may fill before compacting.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub compaction_ratio: Option<f64>,
}

impl ProviderConfig {
    pub fn bearer_key_chain(&self) -> Vec<String> {
        if !self.api_keys.is_empty() {
            return self.api_keys.clone();
        }
        self.api_key.clone().into_iter().collect()
    }
}

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct ProviderCustomHeader {
    pub header: String,
    pub value: String,
}

/// Shared desktop application state owned by Tauri.
pub struct AppState {
    pub app_token: Option<String>,
    pub download_manager: Arc<Mutex<DownloadManagerState>>,
    pub server_handle: Arc<Mutex<Option<ServerHandle>>>,
    pub background_cleanup_handle: Arc<Mutex<Option<tokio::task::JoinHandle<()>>>>,
    /// Remote provider configurations (user-added OpenAI-compatible endpoints)
    pub provider_configs: Arc<Mutex<HashMap<String, ProviderConfig>>>,
    pub speech: crate::core::speech::SpeechState,
    pub dsh: crate::core::dsh::DshState,
    pub dsh_web: crate::core::dsh::web::DshWebState,
}

impl AppState {
    pub fn speech(&self) -> &crate::core::speech::SpeechState {
        &self.speech
    }

    pub fn dsh(&self) -> &crate::core::dsh::DshState {
        &self.dsh
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            app_token: None,
            download_manager: Default::default(),
            server_handle: Default::default(),
            background_cleanup_handle: Default::default(),
            provider_configs: Default::default(),
            speech: Default::default(),
            dsh: Default::default(),
            dsh_web: Default::default(),
        }
    }
}
