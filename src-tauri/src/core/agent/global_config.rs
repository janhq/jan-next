//! User-wide `~/.jan/config.toml` provider config. Lets Jan Agent run
//! standalone (no Jan Desktop) with credentials scoped to the whole user, not
//! just one project. Optional: a missing file yields an empty provider set,
//! not an error.

use std::collections::BTreeMap;
use std::collections::HashMap;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::core::state::ProviderConfig;

const GLOBAL_CONFIG_TEMPLATE: &str = r#"# Jan Agent global provider config.
# Applies to every project unless overridden by that project's
# agent.toml [provider] section (~/.jan/projects/<project>/agent.toml).
#
# default_model = "my-model"        # used when no --model / agent.toml model is set
# smol_model = "my-fast-model"       # fast model for the `smol` role (/goal evaluation,
#                                     # compaction summaries and subagents with
#                                     # model = "smol"); defaults to the session's model
# mouse = false                      # disable TUI mouse tracking (scroll wheel,
#                                     # click-to-expand); on by default
# sandbox = true                      # run `shell` under OS confinement (same as
#                                     # passing --sandbox); off by default, so
#                                     # shell commands run with your own access
# worktree = true                     # run each session in its own git worktree
#                                     # (same as passing --worktree); off by
#                                     # default, so the agent edits your checkout
# think_tags = true                   # treat <think> tags in model content as
#                                     # reasoning (folded, resent), for every
#                                     # provider. Unset: on only for a custom
#                                     # OpenAI-compatible provider; off for
#                                     # openai, anthropic and tokamak, which
#                                     # send reasoning in its own field. A
#                                     # provider overrides it with
#                                     # parse_think_tags in its own table
# stream_reasoning = false            # stop streaming reasoning into the TUI
#                                     # live tail while it folds; only the
#                                     # [thinking] badge shows it. On by default
# theme = "light"                     # force the TUI colour theme: "light",
#                                     # "dark", or "auto" (the default), which
#                                     # detects the terminal background
# ask_timeout_secs = 60             # auto-answer an unanswered `ask` prompt
#                                     # after this many seconds, choosing each
#                                     # question's recommended option (else its
#                                     # first). 0 or unset waits forever, the
#                                     # default
# bell = "off"                       # TUI terminal bell: "attention" (the
#                                     # default) rings when a permission prompt
#                                     # or ask question needs you, "always"
#                                     # also when a turn finishes, "off" never
# terminal_hint = false               # stop the startup note that offers
#                                     # /terminal-setup when this terminal is
#                                     # dropping Shift+Enter or Option+Delete.
#                                     # On by default
# claude_code_alias = false             # allow Jan to reuse Claude Code's
#                                     # keychain login; on by default
# hide_secrets = true                 # replace secret-named env values, URL
#                                     # passwords and credential-shaped tokens
#                                     # with placeholders before a request goes
#                                     # to a model; tool calls get the real
#                                     # value back. Off by default;
#                                     # JAN_HIDE_SECRETS=1|0 overrides it
# memory_cross_project = false        # hide other projects' memory from the
#                                     # agent (the root ~/.jan/MEMORY.md lists
#                                     # them by default)
# memory_auto_tidy = false            # stop the TUI tidying memory in the
#                                     # background when its index outgrows the
#                                     # prompt budget (on by default; /memory
#                                     # tidy still runs it on demand)
# prune_threads = true                # delete old saved threads at TUI start,
#                                     # under each project's agent.toml
#                                     # thread_retention_days / max_threads.
#                                     # Off by default: nothing is deleted
# subagent_build_cache_max_gb = 20    # clear a project's shared subagent
#                                     # cargo-target at session end once it
#                                     # is larger than this (default 20; 0
#                                     # never). A project's agent.toml
#                                     # [agent] key of the same name wins
#
# [tui]
# animations = false                  # hold the TUI still: no shimmer and
#                                     # static throbbers. On by default; the
#                                     # OS reduce-motion setting also turns
#                                     # it off
#
# [telemetry]                         # opt-in OpenTelemetry (OTLP) export of
# enabled = true                      # usage metrics and events to YOUR
#                                     # collector (OTEL_EXPORTER_OTLP_* env);
#                                     # off by default. A project's agent.toml
#                                     # [telemetry] and JAN_AGENT_ENABLE_TELEMETRY
#                                     # win over this
#
# [context]
# fallback_files = ["AGENTS.md"]      # instructions files read where a folder
#                                     # has no JAN.md (JAN.md always wins).
#                                     # Default ["AGENTS.md"]; add "CLAUDE.md"
#                                     # to opt in; [] reads JAN.md only. A
#                                     # project's agent.toml [context] wins
#
# [web_search]                        # backend for the web_search/web_fetch
# provider = "tavily"                 # tools: "exa" (default, keyless),
#                                     # "tavily" (needs a key), "searxng"
#                                     # (needs endpoint) or "you". Keys are
#                                     # kept in the secret store: set them
#                                     # with /settings or `jan config
#                                     # web-search --api-key`, not here
# endpoint = "https://searx.example.com"
#
# [experimental]                      # features that may change or go away
# acp = true                          # allow `jan acp`, the Agent Client
#                                     # Protocol server editors such as Zed
#                                     # and JetBrains drive. Off by default;
#                                     # JAN_EXPERIMENTAL_ACP wins over this
#
# [providers.my-provider]
# api_key = "sk-..."
# base_url = "https://api.example.com/v1"
# models = ["my-model"]
# headers = { "X-Team" = "infra" }  # sent with every request to this provider
"#;

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
struct GlobalConfigToml {
    /// Explicit default model for a standalone agent, used when neither a CLI
    /// flag nor `agent.toml` names one. Takes precedence over any derived guess.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    default_model: Option<String>,
    /// Fast, cheap model for the `smol` role: goal evaluation, compaction
    /// summaries and other lightweight side calls. Falls back to `default_model` when unset.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    smol_model: Option<String>,
    /// TUI mouse tracking (wheel scrolling, click-to-expand). `None` = the
    /// default, on.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    mouse: Option<bool>,
    /// Run the CLI's `bash` tool under OS confinement. `None` = the default,
    /// off. This is the "permanently on" answer to the per-invocation
    /// `--sandbox` flag.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    sandbox: Option<bool>,
    /// Give each session its own git worktree to work in. `None` = the
    /// default, off. The "permanently on" answer to `--worktree`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    worktree: Option<bool>,
    /// Parse `<think>` tags in model *content* as reasoning, for every
    /// provider. `None` = each provider's default (see
    /// `think_tags_enabled_for`). Native `reasoning_content` streaming is a
    /// separate mechanism and is unaffected.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    think_tags: Option<bool>,
    /// Stream reasoning into the TUI live tail while it is still folded. `None`
    /// = the default, on. Unrelated to `[agent].show_reasoning`, which unfolds
    /// reasoning for good.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    stream_reasoning: Option<bool>,
    /// TUI colour theme: `"light"`, `"dark"`, or `"auto"`. `None` = the default,
    /// auto, which detects the terminal background. Any other string also reads
    /// as auto so a typo degrades to detection rather than an error.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    theme: Option<String>,
    /// Auto-answer an unanswered `ask` tool prompt after this many seconds,
    /// selecting each question's recommended option (or its first option when
    /// none is recommended). `None` = the default, and `0` is treated the same:
    /// wait forever, blocking the run on the ask exactly as it does today.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    ask_timeout_secs: Option<u64>,
    /// TUI terminal bell: `"off"`, `"attention"` or `"always"`. `None` = the
    /// default, attention. Any other string also reads as the default so a
    /// typo never silences a prompt the user asked to hear.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    bell: Option<String>,
    /// Offer `/terminal-setup` at startup when a config file proves this
    /// terminal is dropping a modified key. `None` = the default, on. For the
    /// user who has read the note and decided to keep `Option` composing
    /// characters: nothing lands on disk in that case, so there is no other way
    /// for the check to know it was answered.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    terminal_hint: Option<bool>,
    /// Allow Jan to reuse Claude Code's keychain login. `None` = the default,
    /// on; set false to keep Jan from reading or refreshing that credential.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    claude_code_alias: Option<bool>,
    /// Hide secrets from model requests (`core::agent::secrets`). `None` = the
    /// default, off.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    hide_secrets: Option<bool>,
    /// List other projects' memory in the prompt and let the agent read it as
    /// `project:<slug>`. `None` = the default, on. Off keeps each project's
    /// memory to itself (user-wide `user:` notes still apply everywhere).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    memory_cross_project: Option<bool>,
    /// Tidy memory in the background once its index outgrows the prompt
    /// budget. `None` = the default, on.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    memory_auto_tidy: Option<bool>,
    /// Prune old saved threads at TUI start. `None` = the default, off: a
    /// deleted thread is not recoverable, so removing the user's history is
    /// something they turn on, not something they find out about.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    prune_threads: Option<bool>,
    /// The user-wide default for how large, in GB, a project's shared
    /// subagent build directory may grow before a session end clears it.
    /// `None` = the default, 20; `0` never clears. A project's
    /// `[agent].subagent_build_cache_max_gb` wins.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    subagent_build_cache_max_gb: Option<u64>,
    /// Host env-var names (exact or `*`-glob) the sandboxed `bash` may inherit
    /// beyond the fixed base allowlist. Empty by default, so the shell env is
    /// unchanged. Merged with a project's `[tools].env_passthrough`; a secret-
    /// looking name is never copied by a glob (use `env_set` to inject one).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    env_passthrough: Vec<String>,
    /// Explicit key=value pairs injected into the `bash` env, winning over
    /// `env_passthrough` and over a project's per-key value. The one way to
    /// inject a secret-named variable on purpose.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    env_set: BTreeMap<String, String>,
    /// `[[hooks]]` -- lifecycle commands run around tool calls, prompts,
    /// sessions and compactions, for every project this user opens. Merged
    /// under a project's own `[[hooks]]`, which run after these.
    ///
    /// Declared before `providers` because `toml` renders an array of tables
    /// after plain values but before sub-tables; putting it after would emit it
    /// past the `[providers.*]` headers, where a re-read would still find it
    /// but a human appending to the file would not.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    hooks: Vec<tauri_plugin_agent_tools::tools::hooks::HookEntry>,
    /// `[tui]` -- terminal UI display preferences that are not worth a root
    /// key each. A table, so declared after the plain values.
    #[serde(default, skip_serializing_if = "TuiSection::is_empty")]
    tui: TuiSection,
    /// `[telemetry]` -- opt-in OTLP export (`core::agent::otel`). A table, so
    /// declared after the plain values and before `providers`.
    #[serde(default, skip_serializing_if = "TelemetrySection::is_empty")]
    telemetry: TelemetrySection,
    /// `[context]` -- the user-wide default for which instructions files are
    /// read where a directory has no `JAN.md`. A project's own `[context]`
    /// wins. See `project::context_fallback_files`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    context: Option<GlobalContextSection>,
    /// `[experimental]` -- opt-ins for surfaces whose contract is not settled
    /// yet. One table so every such switch is found in one place, and so
    /// graduating a feature is deleting its key rather than migrating it.
    #[serde(default, skip_serializing_if = "ExperimentalSection::is_empty")]
    experimental: ExperimentalSection,
    /// `[web_search]` -- which backend answers the native `web_search` and
    /// `web_fetch` tools. The API key is not here: it lives in the secret
    /// store, under the record the desktop's Web Search settings use.
    #[serde(default, skip_serializing_if = "WebSearchSection::is_empty")]
    web_search: WebSearchSection,
    #[serde(default)]
    providers: HashMap<String, GlobalProviderEntry>,
}

/// `[web_search]` in `~/.jan/config.toml`. Each key is `None` when unset.
#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq)]
pub(crate) struct WebSearchSection {
    /// Backend id (`exa`, `tavily`, `searxng`, `you`). `None` = Exa.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    /// Instance URL for a self-hosted backend (SearXNG).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub endpoint: Option<String>,
}

impl WebSearchSection {
    fn is_empty(&self) -> bool {
        self.provider.is_none() && self.endpoint.is_none()
    }
}

/// `[tui]` in `~/.jan/config.toml`. Each key is `None` when unset.
#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq)]
struct TuiSection {
    /// Animate the TUI (shimmer, throbbers). `None` = on.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    animations: Option<bool>,
}

impl TuiSection {
    fn is_empty(&self) -> bool {
        self.animations.is_none()
    }
}

/// `[experimental]` in `~/.jan/config.toml`. Each key is `None` when unset,
/// which means off.
#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq)]
struct ExperimentalSection {
    /// `jan acp`, the Agent Client Protocol server.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    acp: Option<bool>,
}

impl ExperimentalSection {
    fn is_empty(&self) -> bool {
        self.acp.is_none()
    }
}

/// `[telemetry]` in `~/.jan/config.toml` or a project's `agent.toml`. Only the
/// switch lives here: where the data goes is the standard `OTEL_*` env, so one
/// collector setup serves every OpenTelemetry-speaking tool unchanged.
#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq)]
pub(crate) struct TelemetrySection {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
}

impl TelemetrySection {
    fn is_empty(&self) -> bool {
        self.enabled.is_none()
    }
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
struct GlobalContextSection {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    fallback_files: Option<Vec<String>>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
struct GlobalProviderEntry {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    api_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    base_url: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    models: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    api_type: Option<String>,
    /// Server-assigned id of the key, so a logout can revoke the exact key the
    /// CLI holds rather than a user's other keys.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    key_id: Option<String>,
    /// Unix seconds the key expires at, when the server says. Lets the CLI warn
    /// (and show auth status) without a 401 first.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    key_expires_at: Option<u64>,
    /// Who the key belongs to, as reported when it was minted. Recorded so
    /// `auth status` can name the account without a round trip (and without
    /// guessing an identity endpoint's response shape).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    account: Option<String>,
    /// Extra request headers sent with every request to this provider, inference
    /// and `/models` listing alike: `headers = { "X-Team" = "infra" }`. A
    /// session's `JAN_CUSTOM_HEADERS` beats a header of the same name here.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    headers: BTreeMap<String, String>,
    /// Parse `<think>` tags in this provider's content as reasoning. `None`
    /// inherits the root `think_tags`, then the provider default. Named apart
    /// from the root key on purpose: a root `think_tags` appended to the end of
    /// the file lands in the last provider table, and must not silently become
    /// that provider's setting.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    parse_think_tags: Option<bool>,
}

/// Fields to update on a provider entry via [`set_provider`]. `None` leaves the
/// existing value untouched (merge semantics); `Some` overwrites it. An
/// explicit `Some("")` for the API key removes it (e.g. a local endpoint that
/// dropped auth).
#[derive(Debug, Default, Clone)]
pub(crate) struct ProviderUpdate {
    pub api_key: Option<String>,
    /// Clear any legacy plaintext key in the entry. Used by the login flow so
    /// a stale key never shadows the secret-store credential it just wrote.
    pub clear_api_key: bool,
    pub base_url: Option<String>,
    /// `Some(vec)` replaces the model list; `Some(empty)` clears it.
    pub models: Option<Vec<String>>,
    pub api_type: Option<String>,
    /// Server-assigned key metadata a browser sign-in gets back. Doubly
    /// optional on purpose: `None` leaves whatever is stored alone (the merge
    /// semantics above), while `Some(None)` clears it -- which is what a login
    /// that learned no metadata has to do, so a stale id from a previous key
    /// cannot outlive it.
    pub key_id: Option<Option<String>>,
    pub key_expires_at: Option<Option<u64>>,
    pub account: Option<Option<String>>,
}

/// `~/.jan`, the user-wide config directory.
pub(crate) fn global_jan_dir() -> Result<PathBuf, String> {
    #[cfg(test)]
    let home = TEST_HOME.with(|home| Some(home.borrow().path().to_path_buf()));
    #[cfg(not(test))]
    let home = dirs::home_dir();
    home.map(|home| home.join(".jan"))
        .ok_or_else(|| "could not resolve the user's home directory".to_string())
}

/// `~/.jan/config.toml`.
pub(crate) fn global_config_path() -> Result<PathBuf, String> {
    Ok(global_jan_dir()?.join("config.toml"))
}

/// Load provider configs from `~/.jan/config.toml`. Missing file -> empty map
/// (standalone-with-no-global-config is valid); malformed file -> error.
pub(crate) fn load_global_config() -> Result<HashMap<String, ProviderConfig>, String> {
    let path = match global_config_path() {
        Ok(p) => p,
        Err(_) => return Ok(HashMap::new()),
    };
    let raw = match std::fs::read_to_string(&path) {
        Ok(raw) => raw,
        Err(_) => return Ok(HashMap::new()),
    };
    let parsed: GlobalConfigToml =
        toml::from_str(&raw).map_err(|e| parse_error(&path, &e, e.message()))?;

    Ok(parsed
        .providers
        .into_iter()
        .map(|(name, entry)| {
            let api_keys = entry.api_key.iter().cloned().collect();
            (
                name.clone(),
                ProviderConfig {
                    provider: name,
                    api_key: entry.api_key,
                    api_keys,
                    base_url: entry.base_url,
                    custom_headers: entry
                        .headers
                        .into_iter()
                        .map(|(header, value)| crate::core::state::ProviderCustomHeader {
                            header,
                            value,
                        })
                        .collect(),
                    models: entry.models,
                    api_type: entry.api_type,
                    // `~/.jan/config.toml` describes the desktop app's
                    // providers, which size compaction from the project's
                    // `[provider]`/`[agent]` sections instead.
                    compaction_ratio: None,
                },
            )
        })
        .collect())
}

/// Resolve a default model from `~/.jan/config.toml` for a standalone agent:
/// the explicit `default_model` key if set, else the first model of the first
/// provider (providers sorted by name for determinism). `None` when nothing is
/// configured. Errors only on a malformed file.
pub(crate) fn default_model() -> Result<Option<String>, String> {
    let config = load_raw()?;
    if let Some(model) = config.default_model.filter(|m| !m.trim().is_empty()) {
        return Ok(Some(model));
    }
    let mut providers: Vec<_> = config.providers.into_iter().collect();
    providers.sort_by(|a, b| a.0.cmp(&b.0));
    Ok(providers
        .into_iter()
        .find_map(|(_, entry)| entry.models.into_iter().next()))
}

/// Resolve the `smol` role model from `~/.jan/config.toml`: the explicit
/// `smol_model` key if set. `None` when unset (callers fall back to the
/// session's main model). Errors only on a malformed file.
pub(crate) fn smol_model() -> Result<Option<String>, String> {
    let config = load_raw()?;
    Ok(config.smol_model.filter(|m| !m.trim().is_empty()))
}


/// `hide_secrets` in `~/.jan/config.toml`; `None` when unset. Fails open to
/// "unset" (off): a preference file must never stop a session from starting.
pub(crate) fn hide_secrets_setting() -> Option<bool> {
    load_raw().ok().and_then(|config| config.hide_secrets)
}


/// Whether the TUI should track the mouse (`mouse` in `~/.jan/config.toml`),
/// defaulting to on. A display preference must never block startup, so an
/// unreadable or malformed config yields the default rather than an error.
pub(crate) fn mouse_enabled() -> bool {
    load_raw()
        .ok()
        .and_then(|config| config.mouse)
        .unwrap_or(true)
}


/// Whether the TUI may offer `/terminal-setup` at startup (`terminal_hint` in
/// `~/.jan/config.toml`), defaulting to on. Declining the offer leaves no trace
/// on disk -- the check reads the terminal's own config -- so this key is what
/// turns a standing note off. A display preference must never block startup, so
/// an unreadable config yields the default.
pub(crate) fn terminal_hint_enabled() -> bool {
    load_raw()
        .ok()
        .and_then(|config| config.terminal_hint)
        .unwrap_or(true)
}

/// Whether Jan may reuse Claude Code's keychain login
/// (`claude_code_alias` in `~/.jan/config.toml`), defaulting to on. This
/// setting is deliberately opt-out to preserve existing behavior while making
/// the cross-tool credential reuse explicit and reversible.
pub(crate) fn claude_code_alias_enabled() -> bool {
    load_raw()
        .ok()
        .and_then(|config| config.claude_code_alias)
        .unwrap_or(true)
}

/// Whether `bash` runs sandboxed by default (`sandbox` in `~/.jan/config.toml`).
/// `None` when unset, so the caller can let a project's `agent.toml` or the
/// `--sandbox` flag decide before falling back to the surface default.
///
/// An unreadable or malformed config yields `None` rather than an error: the
/// resolved default is the *safe* direction to fall back to, and a config the
/// user cannot parse must not be the thing that blocks a session from starting.
pub(crate) fn sandbox_setting() -> Option<bool> {
    load_raw().ok().and_then(|config| config.sandbox)
}

/// `[context].fallback_files` from `~/.jan/config.toml`, or `None` when unset
/// or unreadable, so the project's `agent.toml` and then the built-in default
/// decide. Like the other preferences, a bad file never blocks a session.
pub(crate) fn context_fallback_files_setting() -> Option<Vec<String>> {
    load_raw()
        .ok()
        .and_then(|config| config.context)
        .and_then(|context| context.fallback_files)
}

/// Whether a session gets its own git worktree by default (`worktree` in
/// `~/.jan/config.toml`). `None` when unset, so a project's `agent.toml` or the
/// `--worktree` flag decides first. Unreadable config yields `None`, like
/// [`sandbox_setting`]: a preference must not block a session from starting.
pub(crate) fn worktree_setting() -> Option<bool> {
    load_raw().ok().and_then(|config| config.worktree)
}



/// `[web_search]` in `~/.jan/config.toml`. Unset on an unreadable or malformed
/// config: the default backend still works, and a preference file must never
/// stop a session from starting.
pub(crate) fn web_search_setting() -> WebSearchSection {
    load_raw().map(|config| config.web_search).unwrap_or_default()
}



/// Host env-var names the sandboxed `bash` may inherit beyond the base
/// allowlist (`env_passthrough` in `~/.jan/config.toml`), merged under a
/// project's `[tools].env_passthrough`. Empty on an unreadable or malformed
/// config: a shell-env preference must never block a session from starting.
pub(crate) fn env_passthrough_setting() -> Vec<String> {
    load_raw()
        .map(|config| config.env_passthrough)
        .unwrap_or_default()
}

/// Explicit key=value overrides for the `bash` env (`env_set` in
/// `~/.jan/config.toml`), sorted by key. Same fail-open rationale as
/// [`env_passthrough_setting`].
pub(crate) fn env_set_setting() -> Vec<(String, String)> {
    load_raw()
        .map(|config| config.env_set.into_iter().collect())
        .unwrap_or_default()
}

/// The user's global `[[hooks]]`, merged under a project's own. Empty on an
/// unreadable or malformed config: a hook is a policy refinement, and a config
/// the user cannot parse must not be what blocks a session from starting --
/// the same fail-open rationale as [`sandbox_setting`].
pub(crate) fn hook_entries() -> Vec<tauri_plugin_agent_tools::tools::hooks::HookEntry> {
    load_raw().map(|config| config.hooks).unwrap_or_default()
}

/// Providers known to send reasoning in its own `reasoning_content` field, with
/// the host that is really theirs, so tag parsing is off for them unless the
/// user opts in. Anything else on the OpenAI wire (a custom endpoint, a local
/// server) may inline its reasoning. The host matters as much as the name: an
/// `openai` entry pointed at vLLM or OpenRouter is a compatible server, not
/// OpenAI.
const SEPARATE_REASONING_PROVIDERS: &[(&str, &str)] = &[
    ("openai", "api.openai.com"),
    ("anthropic", "api.anthropic.com"),
    ("tokamak", "api.tokamak.sh"),
];

/// Whether `provider` is one of the known providers talking to its own
/// endpoint. No `base_url` means the built-in one.
fn sends_reasoning_separately(provider: &str, base_url: Option<&str>) -> bool {
    let Some((_, host)) = SEPARATE_REASONING_PROVIDERS
        .iter()
        .find(|(name, _)| *name == provider)
    else {
        return false;
    };
    match base_url.map(str::trim).filter(|u| !u.is_empty()) {
        None => true,
        Some(url) => url::Url::parse(url)
            .ok()
            .and_then(|u| u.host_str().map(|h| h.eq_ignore_ascii_case(host)))
            .unwrap_or(false),
    }
}

/// Whether inline `<think>` tags in the content `provider` serves are parsed as
/// reasoning. `provider` is the one serving the active model, `api_type` its
/// wire API and `base_url` its endpoint; `None` when nothing serves it.
///
/// Answered in this order: the provider's own `parse_think_tags`, the root
/// `think_tags` (every provider), then the default. The default is on only for
/// a custom OpenAI-compatible provider: the known providers send reasoning
/// separately, and a non-chat-completions wire API (`anthropic`, `google`,
/// `openai-responses`) carries it in typed blocks, so a tag in their content is
/// the model writing about tags.
///
/// A display preference must never block startup, so an unreadable or malformed
/// config yields the default rather than an error.
pub(crate) fn think_tags_enabled_for(
    provider: Option<&str>,
    api_type: Option<&str>,
    base_url: Option<&str>,
) -> bool {
    let Some(provider) = provider else {
        return false;
    };
    let config = load_raw().ok();
    config
        .as_ref()
        .and_then(|c| c.providers.get(provider))
        .and_then(|entry| entry.parse_think_tags)
        .or_else(|| config.as_ref().and_then(|c| c.think_tags))
        .unwrap_or_else(|| {
            !sends_reasoning_separately(provider, base_url)
                && matches!(api_type, None | Some("openai"))
        })
}

/// Whether other projects' memory is listed and readable
/// (`memory_cross_project` in `~/.jan/config.toml`), defaulting to on.
/// Unreadable config yields the default, like the other preferences.
// Test builds pin cross-project memory off (see `project::memory_roots`).
#[cfg_attr(test, allow(dead_code))]
pub(crate) fn memory_cross_project_enabled() -> bool {
    load_raw()
        .ok()
        .and_then(|config| config.memory_cross_project)
        .unwrap_or(true)
}


/// Whether the TUI streams reasoning into its live tail while folding is on
/// (`stream_reasoning` in `~/.jan/config.toml`), defaulting to on. `false` keeps
/// a folded block off screen entirely, leaving the header badge to stand for it.
///
/// A display preference must never block startup, so an unreadable or malformed
/// config yields the default rather than an error.
pub(crate) fn stream_reasoning_enabled() -> bool {
    load_raw()
        .ok()
        .and_then(|config| config.stream_reasoning)
        .unwrap_or(true)
}

/// The TUI colour-theme preference (`theme` in `~/.jan/config.toml`): `"light"`,
/// `"dark"`, or `"auto"`. `None` when unset, which the TUI treats as auto-detect
/// from the terminal background. An unreadable or malformed config yields `None`
/// so a display preference never blocks startup.
pub(crate) fn theme_setting() -> Option<String> {
    load_raw().ok().and_then(|config| config.theme)
}

/// The TUI bell preference (`bell` in `~/.jan/config.toml`), `None` when unset.
/// Read on every status transition so a `/settings` change applies at once; an
/// unreadable config yields `None` (the default) rather than an error.
pub(crate) fn bell_setting() -> Option<String> {
    load_raw().ok().and_then(|config| config.bell)
}

/// How long an unanswered `ask` prompt waits before it auto-answers with each
/// question's recommended option (`ask_timeout_secs` in `~/.jan/config.toml`).
/// `None` -- the default -- means wait forever, preserving today's blocking
/// behavior until the user answers; `0` is treated the same as unset so the
/// disabling value and the absent key agree.
///
/// A malformed config yields `None` (wait forever) rather than an error: an
/// unreadable preference must never be the thing that changes how a run blocks.
pub(crate) fn ask_timeout() -> Option<std::time::Duration> {
    load_raw()
        .ok()
        .and_then(|config| config.ask_timeout_secs)
        .filter(|secs| *secs > 0)
        .map(std::time::Duration::from_secs)
}

/// Root-level (non-`[providers.*]`) keys of `~/.jan/config.toml`, used to spot
/// the one mistake this file invites: appending a top-level key to the end of
/// the file, where it silently lands inside whichever `[providers.*]` table
/// happens to be last.
const ROOT_KEYS: &[&str] = &[
    "default_model",
    "smol_model",
    "mouse",
    "sandbox",
    "think_tags",
    "stream_reasoning",
    "theme",
    "ask_timeout_secs",
    "bell",
    "terminal_hint",
    "memory_cross_project",
    "memory_auto_tidy",
    "hooks",
];

/// Render a TOML parse failure with a fix, not just a location. `toml`'s own
/// message points at the offending line and stops there, which is useless for
/// the common case: `echo 'key = v' >> ~/.jan/config.toml` appends *after* the
/// last `[providers.*]` header, so the key parses as a provider field and
/// collides on a second append. Naming the root key and the remedy turns a
/// dead end into a one-step fix.
fn parse_error(path: &std::path::Path, err: &impl std::fmt::Display, message: &str) -> String {
    let base = format!("Failed to parse {}: {err}", path.display());
    let Some(key) = ROOT_KEYS
        .iter()
        .find(|key| message.contains(&format!("`{key}`")))
    else {
        return base;
    };
    format!(
        "{base}\n\
         hint: `{key}` is a top-level key, but it landed inside a `[providers.*]` \
         table - appending to the end of the file puts it under whichever provider \
         is last.\n\
         hint: move `{key}` above the first `[providers.*]` header, or set it with \
         `/settings` in the console, which writes it to the right place."
    )
}

/// Read `~/.jan/config.toml` into the raw TOML struct for editing. Missing file
/// -> default (empty); malformed file -> error, so a set never silently drops an
/// unparseable file's contents.
fn load_raw() -> Result<GlobalConfigToml, String> {
    let path = global_config_path()?;
    let raw = match std::fs::read_to_string(&path) {
        Ok(raw) => raw,
        Err(_) => return Ok(GlobalConfigToml::default()),
    };
    toml::from_str(&raw).map_err(|e| parse_error(&path, &e, e.message()))
}

/// Serialize the config back to `~/.jan/config.toml`, creating `~/.jan` if
/// needed. The directory is user-scoped; the file is world-unreadable on Unix
/// since it holds API keys.
fn write_raw(config: &GlobalConfigToml) -> Result<PathBuf, String> {
    let dir = global_jan_dir()?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create {}: {e}", dir.display()))?;
    let path = dir.join("config.toml");
    let body =
        toml::to_string_pretty(config).map_err(|e| format!("Failed to serialize config: {e}"))?;
    std::fs::write(&path, &body).map_err(|e| format!("Failed to write {}: {e}", path.display()))?;
    restrict_permissions(&path);
    Ok(path)
}

#[cfg(unix)]
fn restrict_permissions(path: &std::path::Path) {
    use std::os::unix::fs::PermissionsExt;
    let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
}

#[cfg(not(unix))]
fn restrict_permissions(_path: &std::path::Path) {}

/// Create or update a provider entry in `~/.jan/config.toml`, merging with any
/// existing entry (see [`ProviderUpdate`]). Returns the config path. This is the
/// headless write path that lets a standalone Jan Agent set credentials with no
/// Desktop app present.
pub(crate) fn set_provider(name: &str, update: ProviderUpdate) -> Result<PathBuf, String> {
    if name.trim().is_empty() {
        return Err("provider name must not be empty".to_string());
    }
    let mut config = load_raw()?;
    let entry = config.providers.entry(name.to_string()).or_default();
    if let Some(api_key) = update.api_key {
        // An explicit empty key clears the stored one; `None` leaves it as is.
        entry.api_key = (!api_key.is_empty()).then_some(api_key);
    }
    if update.clear_api_key {
        entry.api_key = None;
    }
    if let Some(base_url) = update.base_url {
        entry.base_url = Some(base_url);
    }
    if let Some(models) = update.models {
        entry.models = models;
    }
    if let Some(api_type) = update.api_type {
        entry.api_type = Some(api_type);
    }
    if let Some(key_id) = update.key_id {
        entry.key_id = key_id.filter(|k| !k.is_empty());
    }
    if let Some(key_expires_at) = update.key_expires_at {
        entry.key_expires_at = key_expires_at;
    }
    if let Some(account) = update.account {
        entry.account = account.filter(|a| !a.is_empty());
    }
    write_raw(&config)
}

/// Point `default_model` at `model` unless the user already chose one. Returns
/// `true` when it was written. Used by sign-in flows: the first provider a user
/// connects should become runnable without a second config step, but an explicit
/// choice must never be overwritten.
pub(crate) fn set_default_model_if_unset(model: &str) -> Result<bool, String> {
    if model.trim().is_empty() {
        return Ok(false);
    }
    let mut config = load_raw()?;
    if config
        .default_model
        .as_deref()
        .is_some_and(|m| !m.trim().is_empty())
    {
        return Ok(false);
    }
    config.default_model = Some(model.to_string());
    write_raw(&config)?;
    Ok(true)
}

/// Why `default_model` was (re)pointed, so a caller can tell the user which of
/// the two happened -- adopting a default is routine, replacing one the user
/// chose needs saying out loud.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum DefaultModelChange {
    /// There was no default; `model` was adopted.
    Adopted,
    /// The previous default is no longer offered by any provider, so it was
    /// replaced by `model`.
    Repointed,
}

/// Point `default_model` at `model` when there is no default, **or** when the
/// current default is not offered by any configured provider. Returns what
/// changed, or `None` when the existing default was left alone.
///
/// The second case is the one [`set_default_model_if_unset`] cannot handle. A
/// sign-in replaces a provider's roster wholesale, so a re-login after the
/// upstream retires a model leaves `default_model` pointing at something no
/// provider serves. That is not an "explicit choice" worth protecting any more:
/// it is a fossil, and every run fails on it with a 404 (or, for a cost
/// ceiling, is refused as unpriceable) with nothing connecting the failure to
/// the sign-in that caused it.
///
/// A default some *other* provider still offers is left alone -- this provider's
/// roster says nothing about models it never served.
pub(crate) fn adopt_default_model(model: &str) -> Result<Option<DefaultModelChange>, String> {
    let model = model.trim();
    if model.is_empty() {
        return Ok(None);
    }
    let mut config = load_raw()?;
    let current = config
        .default_model
        .as_deref()
        .map(str::trim)
        .filter(|m| !m.is_empty())
        .map(str::to_string);
    let change = match current {
        None => DefaultModelChange::Adopted,
        // Already fine, and re-pointing an offered default would overwrite a
        // deliberate choice on every sign-in.
        Some(current) if config.providers.values().any(|p| p.models.contains(&current)) => {
            return Ok(None)
        }
        Some(_) => DefaultModelChange::Repointed,
    };
    config.default_model = Some(model.to_string());
    write_raw(&config)?;
    Ok(Some(change))
}

/// Server-assigned metadata for a provider's stored key, when a v5 device-flow
/// login recorded any. Used by `jan auth status` / the expiry warning and by
/// `jan auth logout` to revoke the exact key.
#[derive(Debug, Clone, Default)]
pub(crate) struct StoredKeyMeta {
    pub key_id: Option<String>,
    pub key_expires_at: Option<u64>,
    pub account: Option<String>,
}

/// Read `key_id`/`key_expires_at` for a provider, if stored. Missing config or
/// provider reads as `None` fields -- the legacy login records neither.
pub(crate) fn provider_key_meta(name: &str) -> Result<StoredKeyMeta, String> {
    let config = load_raw()?;
    Ok(match config.providers.get(name) {
        Some(entry) => StoredKeyMeta {
            key_id: entry.key_id.clone(),
            key_expires_at: entry.key_expires_at,
            account: entry.account.clone(),
        },
        None => StoredKeyMeta::default(),
    })
}

/// Remove a provider entry from `~/.jan/config.toml`. Returns `true` if the
/// provider existed and was removed, `false` if it was already absent.
pub(crate) fn remove_provider(name: &str) -> Result<bool, String> {
    let mut config = load_raw()?;
    if config.providers.remove(name).is_none() {
        return Ok(false);
    }
    write_raw(&config)?;
    Ok(true)
}



/// Scaffold `~/.jan/config.toml` with a commented example, if it doesn't exist
/// yet. Idempotent and clobber-safe: never overwrites an existing file.
pub(crate) fn ensure_global_config() -> Result<PathBuf, String> {
    let dir = global_jan_dir()?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create {}: {e}", dir.display()))?;
    let path = dir.join("config.toml");
    if !path.exists() {
        std::fs::write(&path, GLOBAL_CONFIG_TEMPLATE)
            .map_err(|e| format!("Failed to write {}: {e}", path.display()))?;
    }
    Ok(path)
}

// Resolve config paths independently of platform home APIs in unit tests. Each
// thread starts with a fresh directory, including tests outside with_temp_home.
#[cfg(test)]
thread_local! {
    static TEST_HOME: std::cell::RefCell<tempfile::TempDir> =
        std::cell::RefCell::new(tempfile::tempdir().expect("test config home"));
}

/// Give config resolution a fresh scratch home on every platform. Keep HOME
/// redirected for existing callers that also exercise HOME-based code. That
/// environment variable is process-wide, so all such callers share this lock.
/// Both overrides are restored on unwind; the scratch directory is RAII-owned.
///
/// All fixture config access must run on the calling OS thread: `TEST_HOME` is
/// thread-local and is not inherited by spawned threads or runtime workers.
/// A runtime's root `block_on` future stays on the caller and is safe; do not
/// move fixture-dependent work into `std::thread::spawn`, `spawn_blocking`, or
/// `tokio::spawn` tasks that may run on another OS thread.
#[cfg(test)]
pub(crate) fn with_temp_home<T>(f: impl FnOnce(&std::path::Path) -> T) -> T {
    use std::sync::Mutex;

    static ENV_LOCK: Mutex<()> = Mutex::new(());
    let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = tempfile::tempdir().expect("test config home");
    let path = home.path().to_path_buf();
    let previous = TEST_HOME.with(|slot| slot.replace(home));
    struct Restore {
        home: Option<tempfile::TempDir>,
        env: Option<std::ffi::OsString>,
    }
    impl Drop for Restore {
        fn drop(&mut self) {
            TEST_HOME.with(|slot| {
                slot.replace(self.home.take().unwrap());
            });
            match &self.env {
                Some(value) => std::env::set_var("HOME", value),
                None => std::env::remove_var("HOME"),
            }
        }
    }
    let _restore = Restore {
        home: Some(previous),
        env: std::env::var_os("HOME"),
    };
    std::env::set_var("HOME", &path);
    f(&path)
}

// The suite covers the provider records and the TUI's settings writers, which
// only the `cli` build compiles; the module itself is shared so the desktop can
// read the user's `[[hooks]]`.
