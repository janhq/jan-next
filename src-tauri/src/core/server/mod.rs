// The proxy server and its Tauri command surface are desktop-only; the `jan`
// CLI is a headless agent client with no local API server.
pub mod commands;
pub mod provider_secrets;
pub mod proxy;
pub mod remote_provider_commands;
#[cfg(test)]
pub mod tests;
