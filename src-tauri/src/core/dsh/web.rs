//! DSH's web host (`dsh web`) owns the desktop UI. Each screen is a DSH
//! client plugin, with Jan's look supplied by `open-waifu-shell`.
//! The global `@deepseek-ai/dsh` install supplies the host. The stdio
//! runtime in `mod.rs` remains for the legacy web routes only.
//!
//! The host keeps its state in `<data>/dsh/web-home` (DSH_HOME), so the
//! user's own `~/.dsh` is never touched, and boots DSH's `web` profile under a
//! patch this module writes on every start: the `open-waifu-shell` plugin plus
//! the providers and default model the Jan UI has configured.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use serde::Deserialize;
use serde_yaml::{Mapping, Value};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{oneshot, Mutex};

/// The window that shows the host; the navigation guard lets it onto the
/// host's origin.
pub const WINDOW_LABEL: &str = "main";

/// How long the first boot may take; a fresh DSH_HOME installs its profile.
const BOOT_TIMEOUT: Duration = Duration::from_secs(120);

/// One OpenAI-compatible endpoint from the Jan UI's provider settings.
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ShellProvider {
    /// The Jan provider name; its keys are read from the keyring under it.
    pub name: String,
    pub base_url: String,
    pub models: Vec<ShellModel>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct ShellModel {
    pub id: String,
    pub input: Vec<String>,
}

/// What the Jan UI hands the shell on each start.
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ShellSetup {
    pub providers: Vec<ShellProvider>,
    /// The Jan UI's selected model, as `(provider name, model id)`.
    pub default_model: Option<(String, String)>,
    /// The accent the user picked in Jan: `{ primary, sidebar: { light, dark } }`.
    pub look: Option<serde_json::Value>,
    /// `light`, `dark` or `system`.
    pub theme: String,
}

pub(crate) struct WebHost {
    child: Child,
    _native: super::native::NativeBridge,
    url: String,
    setup: ShellSetup,
}

#[derive(Default)]
pub struct DshWebState {
    pub(crate) host: Mutex<Option<WebHost>>,
}

/// The CLI of the harness vendored in `deepseek-harness/`, built by `make dsh`.
/// The stock npm release lacks the layout seams and compaction hook the
/// bundled plugins need, so it is never used. `OW_DSH_CLI` points at another
/// `lib/bin.js` built from the same source.
fn cli() -> Result<PathBuf, String> {
    if let Some(path) = std::env::var_os("OW_DSH_CLI") {
        return Ok(PathBuf::from(path));
    }
    let vendored = Path::new(env!("CARGO_MANIFEST_DIR")).join("../deepseek-harness/apps/cli/lib/bin.js");
    if vendored.is_file() {
        return Ok(vendored);
    }
    Err(format!(
        "the bundled DeepSeek Harness is not built ({} is missing); run `make dsh` in the repository root",
        vendored.display()
    ))
}

/// Tauri maps the source-relative `../dsh` resource directory to `_up_/dsh`.
fn plugin_root<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    use tauri::Manager;
    let dev = Path::new(env!("CARGO_MANIFEST_DIR")).join("../dsh");
    let bundled = app.path().resource_dir().map(|d| d.join("_up_/dsh")).ok();
    [Some(dev), bundled].into_iter().flatten()
        .find(|root| BUILTINS.iter().all(|(_, name)| root.join(name).join("index.mjs").is_file()))
        .map(|root| crate::core::filesystem::helpers::canonical_scope_path(&root))
        .ok_or_else(|| "the bundled open-waifu DSH plugins are missing from this build".to_string())
}

/// Optional DSH bundles a new install starts with switched on. They ship with
/// DSH and appear in the Plugin manager, where the user can turn each off.
const DEFAULT_ON_BUNDLES: &[&str] = &[
    "@deepseek-ai/dsh-experimental-session-search",
    "@deepseek-ai/dsh-experimental-session-titles-bundle",
];

/// Writes the `web` profile manifest once, before DSH would create it with
/// only its two base bundles. An existing profile is the user's and is left
/// alone, so turning a bundle off sticks.
fn seed_profile(home: &Path) -> Result<(), String> {
    let dir = home.join("profiles/web");
    let manifest = dir.join("package.json");
    if manifest.exists() {
        return Ok(());
    }
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let bundles: Vec<&str> = ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"]
        .into_iter().chain(DEFAULT_ON_BUNDLES.iter().copied()).collect();
    let value = serde_json::json!({
        "name": "dsh-profile-web",
        "private": true,
        "dependencies": {},
        "dsh": { "profile": { "bundles": bundles } },
    });
    let text = serde_json::to_string_pretty(&value).map_err(|e| e.to_string())? + "\n";
    std::fs::write(&manifest, text).map_err(|e| e.to_string())
}

/// The bundled open-waifu plugins, as `(entry id, folder under dsh/)`.
const BUILTINS: &[(&str, &str)] = &[
    ("ow-native", "native"), ("ow-log-bridge", "log-bridge"), ("ow-download", "download"),
    ("ow-llamacpp", "llamacpp"), ("ow-assistant", "assistant"), ("ow-image-generation", "image-generation"),
    ("ow-jan-import", "jan-import"), ("ow-onboarding", "onboarding"), ("ow-preset-square", "preset-square"),
    ("ow-shell", "open-waifu-shell"),
];
const BUNDLE: &str = "@open-waifu/dsh-bundle";

/// Mounts the bundled plugins as a DSH bundle layer. Bundle layers apply before
/// the profile's own patch, so a setting the user saves for one of these
/// plugins lands in the profile and survives; an insert in the `--patch`
/// overlay would come after it and DSH would refuse every such save.
fn write_bundle(home: &Path, plugins: &Path, setup: &ShellSetup) -> Result<(), String> {
    let dir = home.join("node_modules").join(BUNDLE);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let rows = BUILTINS.iter().map(|(id, folder)| map(vec![
        ("id", Value::from(*id)),
        ("name", Value::from(plugins.join(folder).join("index.mjs").to_string_lossy().replace('\\', "/"))),
    ])).collect();
    // Jan's accent is only the starting look: Settings > Appearance saves over
    // it, which an overlay row would pin.
    let look = setup.look.as_ref().and_then(|l| serde_yaml::to_value(l).ok()).unwrap_or(Value::Null);
    let patch = Value::Sequence(vec![
        map(vec![("insert", Value::Sequence(rows))]),
        map(vec![
            ("id", Value::from("ui-theme")),
            ("config", map(vec![("preference", Value::from(setup.theme.clone()))])),
        ]),
        map(vec![("id", Value::from("ow-shell")), ("config", map(vec![("look", look)]))]),
    ]);
    std::fs::write(dir.join("cordis.patch.yml"), serde_yaml::to_string(&patch).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    let manifest = serde_json::json!({
        "name": BUNDLE, "version": "0.0.0", "private": true,
        "dsh": { "bundle": { "patch": "./cordis.patch.yml" } },
    });
    std::fs::write(dir.join("package.json"), serde_json::to_string_pretty(&manifest).map_err(|e| e.to_string())? + "\n")
        .map_err(|e| e.to_string())?;
    // Profiles made before this bundle existed list it now; nothing else changes.
    let profile = home.join("profiles/web/package.json");
    let text = std::fs::read_to_string(&profile).map_err(|e| e.to_string())?;
    let mut value: serde_json::Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    let bundles = value.pointer_mut("/dsh/profile/bundles").and_then(|b| b.as_array_mut())
        .ok_or("the web profile lists no bundles")?;
    if !bundles.iter().any(|b| b == BUNDLE) {
        bundles.push(serde_json::Value::from(BUNDLE));
        std::fs::write(&profile, serde_json::to_string_pretty(&value).map_err(|e| e.to_string())? + "\n")
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// DSH route ids are lowercase words joined by `-`; Jan names are free text.
fn route_id(name: &str) -> String {
    let mut id = String::new();
    for c in name.chars() {
        if c.is_ascii_alphanumeric() {
            id.push(c.to_ascii_lowercase());
        } else if !id.is_empty() && !id.ends_with('-') {
            id.push('-');
        }
    }
    id.trim_end_matches('-').to_string()
}

/// A name with no letters or digits still needs a route.
fn route_of(index: usize, name: &str) -> String {
    let id = route_id(name);
    if id.is_empty() { format!("provider-{index}") } else { id }
}

fn key_env(index: usize) -> String {
    format!("OW_PROVIDER_KEY_{index}")
}

fn map(pairs: Vec<(&str, Value)>) -> Value {
    Value::Mapping(pairs.into_iter().map(|(k, v)| (Value::from(k), v)).collect::<Mapping>())
}

/// The patch layered over DSH's `web` profile. Keys stay out of it: each
/// provider names an environment variable the host is started with.
fn patch(setup: &ShellSetup) -> Value {
    let selected_local = setup.default_model.as_ref()
        .filter(|(provider, _)| provider == "llamacpp")
        .map(|(_, model)| Value::from(model.clone())).unwrap_or(Value::Null);
    let mut entries = vec![
        map(vec![("id", Value::from("ow-llamacpp")), ("config", map(vec![("selectedModel", selected_local)]))]),
        // DSH's empty composer asks what to build; this is a chat app.
        map(vec![
            ("id", Value::from("ui-conversation")),
            ("config", map(vec![("heroPlaceholder", Value::from("Ask anything, / for commands, @ for files or chats"))])),
        ]),

    ];
    // DSH finds Documents by spawning PowerShell on Windows, which costs one to
    // four seconds on every boot; Rust already knows the folder.
    if let Some(docs) = dirs::document_dir() {
        entries.push(map(vec![
            ("id", Value::from("workspace-controller")),
            ("name", Value::from("@deepseek-ai/dsh-api-workspace-controller")),
            ("config", map(vec![("documentsDirectory", Value::from(docs.to_string_lossy().into_owned()))])),
        ]));
    }
    entries.extend([
        // The shell opens on DSH's one-time preview notice otherwise.
        map(vec![
            ("id", Value::from("ui-settings-general")),
            ("name", Value::from("@deepseek-ai/dsh-client-ui-settings-general")),
            ("config", map(vec![("welcomeNoticeVersion", Value::from("2026-09-28.1"))])),
        ]),
    ]);

    let mut providers = Mapping::new();
    for (i, p) in setup.providers.iter().enumerate() {
        if p.name == "llamacpp" { continue; }
        let models = p
            .models
            .iter()
            .map(|m| map(vec![
                ("id", Value::from(m.id.clone())),
                ("name", Value::from(m.id.clone())),
                ("input", Value::Sequence(m.input.iter().cloned().map(Value::from).collect())),
            ]))
            .collect();
        providers.insert(
            Value::from(route_of(i, &p.name)),
            map(vec![
                ("displayName", Value::from(p.name.clone())),
                ("apiKeyEnv", Value::from(key_env(i))),
                ("api", Value::from("openai-completions")),
                ("baseURL", Value::from(p.base_url.clone())),
                ("models", Value::Sequence(models)),
            ]),
        );
    }
    if !providers.is_empty() {
        entries.push(map(vec![
            ("id", Value::from("llm-pi-ai")),
            ("config", map(vec![("providers", Value::Mapping(providers))])),
        ]));
    }
    let default = setup.default_model.as_ref().and_then(|(provider, model)| {
        if provider == "llamacpp" { return Some(("ow-llamacpp".to_string(), model)); }
        let i = setup.providers.iter().position(|p| &p.name == provider && p.models.iter().any(|m| &m.id == model))?;
        Some((route_of(i, provider), model))
    });
    if let Some((route, model)) = default {
        entries.push(map(vec![
            ("id", Value::from("agent-default-model")),
            (
                "config",
                map(vec![
                    ("provider", Value::from(route)),
                    ("model", Value::from(model.clone())),
                ]),
            ),
        ]));
    }
    Value::Sequence(entries)
}

/// `dsh web` prints `dsh web: <url>` once it listens; that line is the only
/// way to learn the port when it asked the OS for a free one.
fn url_of(line: &str) -> Option<String> {
    let rest = line.trim().strip_prefix("dsh web:")?.trim();
    rest.starts_with("http").then(|| rest.to_string())
}

/// Starts the web host for `setup`, or returns the running one's URL when
/// nothing changed. Resolves once the host prints its URL.
pub(crate) async fn start<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    state: &DshWebState,
    data_dir: &Path,
    setup: ShellSetup,
) -> Result<String, String> {
    let mut slot = state.host.lock().await;
    if let Some(host) = slot.as_mut() {
        if host.setup == setup && host.child.try_wait().ok().flatten().is_none() {
            return Ok(host.url.clone());
        }
    }
    if let Some(mut old) = slot.take() {
        let _ = old.child.kill().await;
    }

    let bin = cli()?;
    let plugins = plugin_root(app)?;
    let home = data_dir.join("web-home");
    let workspace = data_dir.join("workspace");
    std::fs::create_dir_all(&home).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&workspace).map_err(|e| e.to_string())?;
    seed_profile(&home)?;
    write_bundle(&home, &plugins, &setup)?;
    let patch_file = data_dir.join("web.patch.yml");
    let text = serde_yaml::to_string(&patch(&setup)).map_err(|e| e.to_string())?;
    std::fs::write(&patch_file, text).map_err(|e| e.to_string())?;

    let names: Vec<String> = setup.providers.iter().map(|p| p.name.clone()).collect();
    let keys = tauri::async_runtime::spawn_blocking(move || {
        names
            .iter()
            .map(|n| if n == "llamacpp" { Vec::new() } else { crate::core::server::provider_secrets::load_provider_keys(n) })
            .collect::<Vec<_>>()
    })
    .await
    .map_err(|e| e.to_string())?;

    let native = super::native::start(app).await?;
    let mut cmd = Command::new("node");
    cmd.arg(&bin)
        .args(["web", "--patch"])
        .arg(&patch_file)
        .args(["--no-open", "--host", "127.0.0.1", "--port", "0"])
        // The invoking directory is DSH's default workspace root.
        .current_dir(&workspace)
        .env("DSH_HOME", &home)
        // Models come from Jan's providers. A DeepSeek key left in the user's
        // shell would otherwise surface as a working stock route.
        .env_remove("DEEPSEEK_API_KEY")
        .env("OW_NATIVE_URL", &native.url)
        .env("OW_NATIVE_TOKEN", &native.token)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    for (i, chain) in keys.iter().enumerate() {
        if setup.providers[i].name == "llamacpp" { continue; }
        let key = chain.first().map(String::as_str);
        // The adapter requires a key even for unauthenticated remote endpoints.
        cmd.env(key_env(i), key.unwrap_or("none"));
    }
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
            // ow-log-bridge marks DSH's own runtime warnings and errors.
            if line.starts_with("[dsh-log]") {
                log::warn!("[dsh-web] {line}");
            } else {
                log::debug!("[dsh-web] {line}");
            }
        }
    });

    let url = match tokio::time::timeout(BOOT_TIMEOUT, rx).await {
        Ok(Ok(url)) => url,
        _ => {
            let _ = child.kill().await;
            return Err("the DSH web host did not start; see the app log for its output".into());
        }
    };
    *slot = Some(WebHost { child, _native: native, url: url.clone(), setup });
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
