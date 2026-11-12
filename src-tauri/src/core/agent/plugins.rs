//! Plugin install/removal and marketplace search. A plugin is a directory
//! `~/.jan/projects/<slug>/plugins/<name>/` cloned from a git repository, so installing
//! from GitHub (or any git host) is just `git clone`. No lockfile or registry
//! file: an installed plugin is a directory, removed by deleting it. Installing
//! never executes plugin code — a plugin carries skills (instructions) plus an
//! optional `plugin.toml` metadata manifest.
//!
//! A plugin's payload is discovered conventionally, so a repo needs no
//! manifest to be installable:
//!   - `skills/` — folder skills (`<name>/SKILL.md`) and flat `<name>.md`,
//!     the same layout as project skills
//!   - `SKILL.md` at the plugin root — a repo that is itself one skill
//!   - `plugin.toml` — optional metadata: `name`, `description`, `version`,
//!     `repo` (the canonical source URL, recorded at install for provenance),
//!     plus optional `[[tools]]` entries the plugin contributes
//!   - `hooks/hooks.json` — optional lifecycle hooks (see
//!     `tauri_plugin_agent_tools::tools::hooks`)
//!
//! Installing still executes nothing: a declared tool or hook is a command
//! recorded on disk, run only when the model calls it or its event fires, and
//! then under the same confinement `bash` gets.
//!
//! `[plugins] marketplace` in `agent.toml` points at a JSON index of community
//! plugins: `[{ "name", "description", "repo", "ref"? }]`. `install <name>`
//! resolves through it; `install <git-url>` skips it entirely.

use std::io::{self, Write};
use std::path::{Path, PathBuf};

use serde::Deserialize;

use crate::core::agent::project::PluginsSection;
use crate::core::agent::skills;

/// Shell metacharacters rejected in install specs. A spec is a git URL or a
/// marketplace name; anything else (including command substitution) is a
/// typo or an injection attempt, so it errors instead of being passed to a
/// shell. `:` `/` `#` `@` `-` `_` `.` are all fine — they appear in URLs.
const SHELL_METACHARS: &[char] = &[
    ';', '&', '|', '`', '$', '(', ')', '{', '}', '<', '>', '\\', '\n', '\r', '\t',
];

const USER_AGENT: &str = "jan-agent-plugin-manager";

// How a bare collection URL that holds several plugins is resolved after the
// clone. A collection has no payload at the root, so we enumerate the plugins
// inside it and either ask the user which one to install (interactive CLI) or
// fail with an actionable listing (TUI/desktop, where stdin is owned by the
// render loop and cannot be read mid-install).
#[derive(Clone, PartialEq, Eq)]
enum CollectionChoice {
    /// Fail on a multi-plugin collection, listing the choices in the error.
    // (desktop-only) `install` is the non-CLI entry point, so this arm is
    // dead under `--features cli` but still matched in the always-compiled
    // `install_with`, so it is allowed rather than `cfg`'d out.
    ListError,
    /// Ask on stdin which plugins to install (the interactive CLI).
    // (cli-only)
    #[allow(dead_code)]
    Prompt,
    /// Return the choices instead of installing, so a caller that owns the
    /// terminal (the TUI) can present its own picker.
    // (cli-only)
    #[allow(dead_code)]
    List,
    /// Install exactly these payload-root-relative paths (a picker selection).
    // (cli-only)
    #[allow(dead_code)]
    Only(Vec<String>),
}

/// One plugin discovered inside a collection repo, for a caller to choose from.
pub(crate) struct CollectionPlugin {
    // (cli-only) fields are read only by the CLI list/install path but the
    // struct is constructed by the always-compiled `install_with`, so they
    // are dead (allowed) under the desktop/test config.
    /// Path relative to the payload root, e.g. `plugins/code-review`.
    #[allow(dead_code)]
    pub(crate) path: String,
    /// A plugin of this name is already installed.
    #[allow(dead_code)]
    pub(crate) installed: bool,
}

/// The result of a git install: either plugins landed, or the source turned out
/// to be a collection the caller must choose from.
pub(crate) enum GitInstall {
    Installed(Vec<InstalledPlugin>),
    // (cli-only) the collection listing is produced by the always-compiled
    // `install_with` and consumed only by the CLI list/install path, so it
    // is dead (allowed) under the desktop/test config.
    #[allow(dead_code)]
    Collection(Vec<CollectionPlugin>),
}
/// An installed plugin, from its directory plus optional manifest.
#[derive(Debug, serde::Serialize, Clone)]
pub struct InstalledPlugin {
    pub name: String,
    pub description: String,
    pub version: String,
    pub repo: String,
    /// Number of skills the plugin contributes.
    pub skills: usize,
    /// Number of command prompt templates (`commands/**/*.md`).
    pub commands: usize,
    /// Number of agent definitions (`agents/**/*.md`).
    pub agents: usize,
    /// Number of tools the plugin declares in `[[tools]]` of its `plugin.toml`.
    /// Unlike the three counts above these are not markdown: they are commands
    /// the model can call, which is why the count is worth reporting separately
    /// rather than folded into the others.
    pub tools: usize,
    /// Number of lifecycle hooks the plugin ships in `hooks/hooks.json`.
    pub hooks: usize,
}

/// A plugin available on the configured marketplace: JSON index entry.
#[derive(serde::Serialize, Deserialize, Clone)]
pub struct MarketEntry {
    pub name: String,
    pub description: String,
    pub repo: String,
    #[serde(default)]
    pub r#ref: Option<String>,
}

/// Optional metadata manifest at the plugin root. Every field is optional so
/// a repo without a manifest is still installable and listable.
#[derive(Debug, Default, Deserialize)]
struct Manifest {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    version: Option<String>,
    #[serde(default)]
    repo: Option<String>,
    /// Optional setup requirements: environment variables the plugin needs
    /// (typically API keys). `plugin.toml`:
    ///
    /// ```toml
    /// [setup.env]
    /// GITHUB_TOKEN = "https://github.com/settings/tokens"
    /// ```
    ///
    /// The value is the URL the user can obtain the key from (empty when the
    /// plugin author has no link to share).
    #[serde(default)]
    setup: Option<SetupSection>,
    /// Inline MCP declarations; `.mcp.json` declarations are merged on read.
    #[serde(default, rename = "mcpServers")]
    mcp_servers: Option<std::collections::BTreeMap<String, serde_json::Value>>,
}

/// The `[setup]` manifest section.
#[derive(Debug, Default, Deserialize)]
struct SetupSection {
    #[serde(default)]
    env: Option<std::collections::BTreeMap<String, String>>,
}

impl Manifest {
    /// Environment variables this plugin requires, as `(var, url)` pairs —
    /// the URL the user can obtain the value from, empty when unknown.
    /// Variables the sandbox owns (`PATH`, temp keys, loader injection
    /// prefixes) are refused: a pasted value under one of those names could
    /// clobber or escape the sandbox environment wholesale.
    fn required_env(&self) -> std::collections::BTreeMap<String, String> {
        use tauri_plugin_agent_tools::tools::proc::is_reserved_env_key;
        let mut out = std::collections::BTreeMap::new();
        if let Some(setup) = &self.setup {
            for (key, url) in setup.env.iter().flatten() {
                if is_env_name(key) && !is_reserved_env_key(key) {
                    out.insert(key.clone(), url.trim().to_string());
                }
            }
        }
        for server in self.mcp_servers.iter().flat_map(|m| m.values()) {
            for var in mcp_template_refs(server) {
                if var != "CLAUDE_PLUGIN_ROOT" && is_env_name(&var) && !is_reserved_env_key(&var) {
                    out.entry(var).or_default();
                }
            }
        }
        out
    }
}

/// A plausible environment-variable name (used as a file stem and registry
/// key, so it must not contain path separators or control characters).
fn is_env_name(name: &str) -> bool {
    !name.is_empty()
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_')
        && !name.chars().next().unwrap().is_ascii_digit()
}

/// Every `${VAR}` reference in a manifest value.
fn template_refs(value: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = value;
    while let Some(start) = rest.find("${") {
        if let Some(len) = rest[start + 2..].find('}') {
            out.push(rest[start + 2..start + 2 + len].to_string());
            rest = &rest[start + 2 + len + 1..];
        } else {
            break;
        }
    }
    out
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| format!("ERROR: {e}"))
}

/// Read the project's `[plugins]` config; missing/malformed falls back to
/// defaults (no marketplace).
fn plugins_section(root: &Path) -> PluginsSection {
    crate::core::agent::project::load_agent_config(root)
        .ok()
        .map(|c| c.plugins)
        .unwrap_or_default()
}

/// Every installed plugin, sorted by display name. Staging directories from
/// interrupted installs are intentionally excluded.
pub(crate) fn installed(root: &Path) -> Vec<InstalledPlugin> {
    installed_entries(root)
        .into_iter()
        .map(|(_, plugin)| plugin)
        .collect()
}


/// `~/.jan/agent/plugin-env/`, shared by CLI setup and desktop discovery.
fn plugin_env_dir() -> Result<PathBuf, String> {
    dirs::home_dir()
        .map(|home| home.join(".jan").join("agent").join("plugin-env"))
        .ok_or_else(|| "could not resolve the user's home directory".to_string())
}

/// `plugin-env/<plugin>.toml` under `dir`.
fn plugin_env_path(dir: &Path, plugin: &str) -> Result<PathBuf, String> {
    let stem = crate::core::agent::skills::safe_stem(plugin)?;
    Ok(dir.join(format!("{stem}.toml")))
}

/// The stored env values for one plugin, resolved against the real plugin-env
/// store directory. Missing or malformed file -> empty.
fn stored_plugin_env_in(
    dir: &Path,
    plugin: &str,
) -> std::collections::BTreeMap<String, String> {
    plugin_env_path(dir, plugin)
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|raw| toml::from_str(&raw).ok())
        .unwrap_or_default()
}






/// Hand the sandboxed shells their plugin-declared credentials: values stored
/// via the setup prompt, intersected with the variables the installed
/// plugins' manifests still declare (a plugin that dropped a requirement
/// stops receiving it). Runs on every run start via `ensure_project` and
/// after `/reload`, so install/remove/setup changes are picked up live.
pub(crate) fn sync_env_registry(root: &Path) {
    if let Ok(dir) = plugin_env_dir() {
        sync_env_registry_in(root, &dir);
    } else {
        tauri_plugin_agent_tools::tools::proc::set_plugin_env(root, Default::default());
    }
}

/// [`sync_env_registry`] against an explicit store directory (tests).
fn sync_env_registry_in(root: &Path, env_dir: &Path) {
    let mut values: std::collections::BTreeMap<String, String> = Default::default();
    for (directory, _) in installed_entries(root) {
        let Some(dir) = skills::find_plugin_dir(root, &directory) else {
            continue;
        };
        let stored = stored_plugin_env_in(env_dir, &directory);
        for var in read_manifest(&dir).required_env().into_keys() {
            if let Some(value) = stored.get(&var).filter(|v| !v.is_empty()) {
                values.insert(var, value.clone());
            }
        }
    }
    tauri_plugin_agent_tools::tools::proc::set_plugin_env(root, values);
}

pub(crate) fn installed_entries(root: &Path) -> Vec<(String, InstalledPlugin)> {
    // Discover once and count per plugin, rather than rescanning each one.
    let all_skills = skills::discover_plugins(root);
    let all_commands = crate::core::agent::plugin_commands::discover(root);
    let mut out = Vec::new();
    skills::for_each_plugin_dir(root, |directory, path| {
        let manifest = read_manifest(path);
        let plugin_skills = all_skills
            .iter()
            .filter(|e| e.plugin.as_deref() == Some(directory))
            .count();
        let plugin_commands = all_commands
            .iter()
            .filter(|e| e.plugin == directory)
            .count();
        let plugin_agents = crate::core::agent::subagent::count_plugin_agents(root, directory);
        out.push((
            directory.to_string(),
            InstalledPlugin {
                name: manifest.name.unwrap_or_else(|| directory.to_string()),
                description: manifest.description.unwrap_or_default(),
                version: manifest.version.unwrap_or_else(|| "0.0.0".to_string()),
                repo: manifest.repo.unwrap_or_default(),
                skills: plugin_skills,
                commands: plugin_commands,
                agents: plugin_agents,
                tools: crate::core::agent::hooks_config::plugin_tool_entries(path).len(),
                hooks: tauri_plugin_agent_tools::tools::hooks::plugin_hook_entries(path)
                    .0
                    .len(),
            },
        ));
    });
    out.sort_by(|a, b| a.1.name.cmp(&b.1.name));
    out
}

fn read_manifest(root: &Path) -> Manifest {
    let mut manifest = read_manifest_metadata(root);
    if let Ok(servers) = read_mcp_declarations(root, manifest.mcp_servers.take()) {
        manifest.mcp_servers = Some(servers);
    }
    manifest
}

fn read_manifest_metadata(root: &Path) -> Manifest {
    std::fs::read_to_string(root.join("plugin.toml"))
        .ok()
        .and_then(|raw| toml::from_str::<Manifest>(&raw).ok())
        .or_else(|| {
            std::fs::read_to_string(root.join(".claude-plugin/plugin.json"))
                .ok()
                .and_then(|raw| serde_json::from_str::<Manifest>(&raw).ok())
        })
        .unwrap_or_default()
}

fn read_mcp_declarations(
    root: &Path,
    inline: Option<std::collections::BTreeMap<String, serde_json::Value>>,
) -> Result<std::collections::BTreeMap<String, serde_json::Value>, String> {
    let mut servers = inline.unwrap_or_default();
    let path = root.join(".mcp.json");
    match std::fs::read_to_string(&path) {
        Ok(raw) => {
            let mut document: serde_json::Value = serde_json::from_str(&raw)
                .map_err(|_| format!("invalid MCP JSON in {}", path.display()))?;
            let entries = document.get_mut("mcpServers")
                .map(serde_json::Value::take)
                .unwrap_or(document);
            let entries: std::collections::BTreeMap<String, serde_json::Value> =
                serde_json::from_value(entries)
                    .map_err(|_| format!("{} must contain an MCP server map", path.display()))?;
            servers.extend(entries);
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(format!("could not read {}: {e}", path.display())),
    }
    Ok(servers)
}

fn mcp_template_refs(value: &serde_json::Value) -> Vec<String> {
    match value {
        serde_json::Value::String(text) => template_refs(text),
        serde_json::Value::Array(items) => items.iter().flat_map(mcp_template_refs).collect(),
        serde_json::Value::Object(fields) => fields.values().flat_map(mcp_template_refs).collect(),
        _ => Vec::new(),
    }
}



/// Reject specs that could inject shell commands. The spec is later passed as
/// literal argv to `git clone`, never to a shell, but a spec full of `$()`
/// is a typo at best — error early and clearly.
fn validate_spec(spec: &str) -> Result<(), String> {
    let spec = spec.trim();
    if spec.is_empty() {
        return Err("ERROR: nothing to install".into());
    }
    if spec.chars().any(|c| SHELL_METACHARS.contains(&c)) {
        return Err(format!(
            "ERROR: invalid plugin spec '{spec}' (shell metacharacters are not allowed)"
        ));
    }
    Ok(())
}

/// Does the spec name a git source directly (URL, scp-like, or host shorthand)
/// rather than a marketplace name?
fn looks_like_git(spec: &str) -> bool {
    spec.contains("://")
        || spec.starts_with("git@")
        || ["github:", "gitlab:", "bitbucket:", "codeberg:"]
            .iter()
            .any(|p| spec.starts_with(p))
}

#[derive(Debug, PartialEq, Eq)]
struct GitSource {
    url: String,
    r#ref: Option<String>,
    subdir: Option<String>,
}

/// Parse a git URL and the optional GitHub `/tree/<ref>/<subdir>` (or
/// `/blob/<ref>/<subdir>`) payload path. Both the GitHub "browse" (`tree`) and
/// "copy path" (`blob`) URL forms name a repo, a ref, and a subdirectory to
/// install as a single plugin.
fn parse_git_source(spec: &str) -> Result<GitSource, String> {
    let (base, suffix_ref) = split_ref(spec.trim());
    if let Some(path) = base.strip_prefix("https://github.com/") {
        let parts: Vec<&str> = path.split('/').filter(|part| !part.is_empty()).collect();
        if parts.len() >= 4 && (parts[2] == "tree" || parts[2] == "blob") {
            let repo = format!("https://github.com/{}/{}.git", parts[0], parts[1]);
            let tree_ref = parts[3].to_string();
            let subdir = (parts.len() > 4).then(|| parts[4..].join("/"));
            if subdir
                .as_deref()
                .is_some_and(|path| path.split('/').any(|part| part == "." || part == ".."))
            {
                return Err("ERROR: plugin subdirectory cannot contain '.' or '..'".into());
            }
            return Ok(GitSource {
                url: repo,
                r#ref: Some(suffix_ref.unwrap_or(&tree_ref).to_string()),
                subdir,
            });
        }
    }
    Ok(GitSource {
        url: base.to_string(),
        r#ref: suffix_ref.map(str::to_string),
        subdir: None,
    })
}

fn plugin_has_content(root: &Path) -> bool {
    root.join("plugin.toml").is_file()
        || root.join(".claude-plugin/plugin.json").is_file()
        || root.join("skills").is_dir()
        || root.join("commands").is_dir()
        || root.join("agents").is_dir()
        || root.join("SKILL.md").is_file()
        || root.join(".mcp.json").is_file()
}
/// Walk `root` (recursively, skipping hidden dirs) and collect every directory
/// that is itself a plugin payload. A collection repo can nest plugins at any
/// depth (e.g. `plugins/` and `external_plugins/` are only wrapper dirs),
/// so a bare collection URL can't rely on a one-level scan.
fn find_plugin_dirs(root: &Path) -> Vec<PathBuf> {
    fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
        let rd = match std::fs::read_dir(dir) {
            Ok(rd) => rd,
            Err(_) => return,
        };
        for entry in rd.flatten() {
            let path = entry.path();
            // Skip hidden entries and symlinks. `entry.file_type()` reports the
            // link itself (not the target, unlike `path.is_dir()` which follows
            // it), so symlinked dirs are never descended into -- a hostile or
            // malformed collection can't use a link back to an ancestor to
            // recurse forever.
            let is_dir = match entry.file_type() {
                Ok(ft) => ft.is_dir() && !ft.is_symlink(),
                Err(_) => false,
            };
            if !is_dir {
                continue;
            }
            if entry
                .file_name()
                .to_string_lossy()
                .starts_with('.')
            {
                continue;
            }
            if plugin_has_content(&path) {
                out.push(path);
            } else {
                walk(&path, out);
            }
        }
    }
    let mut out = Vec::new();
    walk(root, &mut out);
    out
}

/// Present the plugin choices of a collection on stdout and collect the
/// 0-based indices the user wants to install, reading from `input`. The caller
/// has already cloned the collection, so this only asks which to install.
///
/// Accepts a comma/space-separated list of numbers, the keyword `all` (every
/// plugin), or a blank line to cancel. Already-installed plugins are marked
/// `[installed]` and skipped, never errored.
fn prompt_multi_choice(
    url: &str,
    paths: &[String],
    already: &[bool],
    input: &mut dyn io::BufRead,
) -> Result<Vec<usize>, String> {
    let mut stdout = io::stdout().lock();
    writeln!(stdout, "'{url}' is a plugin collection ({n} plugins):", n = paths.len())
        .map_err(|e| format!("ERROR: {e}"))?;
    let width = paths.len().to_string().len();
    for (i, (path, inst)) in paths.iter().zip(already).enumerate() {
        let mark = if *inst { "  [installed]" } else { "" };
        writeln!(stdout, "  {:>width$}. {path}{mark}", i + 1).map_err(|e| format!("ERROR: {e}"))?;
    }
    writeln!(
        stdout,
        "Install which? numbers (e.g. 1 3 5) or 'all' [enter to cancel]:"
    )
    .map_err(|e| format!("ERROR: {e}"))?;
    let _ = stdout.flush();

    let mut line = String::new();
    loop {
        line.clear();
        match input.read_line(&mut line) {
            Ok(0) => return Err("ERROR: no plugin selected - install aborted".into()),
            Ok(_) => {}
            Err(e) => return Err(format!("ERROR: reading plugin choice: {e}")),
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            return Err("ERROR: no plugin selected - install aborted".into());
        }
        if trimmed.eq_ignore_ascii_case("all") {
            return Ok((0..paths.len()).collect());
        }
        let mut picked: Vec<usize> = Vec::new();
        let mut ok = true;
        for tok in trimmed.split(|c: char| c == ',' || c.is_whitespace()) {
            if tok.is_empty() {
                continue;
            }
            match tok.parse::<usize>() {
                Ok(n) if (1..=paths.len()).contains(&n) => {
                    let idx = n - 1;
                    if !picked.contains(&idx) {
                        picked.push(idx);
                    }
                }
                _ => {
                    ok = false;
                    break;
                }
            }
        }
        if ok && !picked.is_empty() {
            return Ok(picked);
        }
        writeln!(
            stdout,
            "'{trimmed}' is not a valid choice; enter numbers like '1 3 5' or 'all' [enter to cancel]:"
        )
        .map_err(|e| format!("ERROR: {e}"))?;
        let _ = stdout.flush();
    }
}
/// Split a `#ref` suffix off a git URL (`https://host/repo#main`).
fn split_ref(url: &str) -> (&str, Option<&str>) {
    match url.split_once('#') {
        Some((base, r#ref)) => (base, Some(r#ref)),
        None => (url, None),
    }
}

/// The default plugin name for a repo URL: the last path segment, `.git`
/// stripped. `https://github.com/acme/release-tools.git` -> `release-tools`.
fn repo_dir_name(url: &str) -> Option<&str> {
    let (base, _) = split_ref(url);
    let base = base.trim_end_matches('/');
    let name = base.rsplit('/').next()?;
    Some(name.strip_suffix(".git").unwrap_or(name))
}

/// Whether the TUI holds the terminal (raw mode on). The desktop app has no
/// terminal to prompt on, so it counts as owned.
fn tui_owns_terminal() -> bool {
    {
        true
    }
}

fn git(args: &[&str]) -> Result<String, String> {
    // A plain `jan plugin install` in a shell may let git ask for credentials
    // (a private https repo, a first-seen ssh host). Under the TUI -- raw mode
    // on -- that prompt would sit hidden behind the screen, so there git gets
    // no terminal and fails with its own error instead.
    let command = if tui_owns_terminal() {
        super::git::git_command()
    } else {
        super::git::git_command_on_terminal()
    };
    let out = command
        .map_err(|e| format!("ERROR: {e}"))?
        .args(args)
        .output()
        .map_err(|e| format!("ERROR: git: {e}"))?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    } else {
        Err(format!(
            "ERROR: git: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ))
    }
}

/// Clone a plugin source into a temporary dir, discover which plugin(s) inside
/// it to install, and move each selected payload into place under its final
/// name. A failed clone or an empty repo leaves nothing behind (the temp dir is
/// removed).
///
/// `install_git` returns one installed plugin for a normal source or a single-
/// plugin collection, and several for a multi-plugin collection when the user
/// asked for more than one (interactive CLI). Already-installed plugins are
/// skipped, not reported as errors.
fn install_git(
    root: &Path,
    url: &str,
    r#ref: Option<&str>,
    collection: CollectionChoice,
) -> Result<GitInstall, String> {
    let source = parse_git_source(url)?;
    let plugins = skills::plugins_dir(root);
    std::fs::create_dir_all(&plugins).map_err(|e| format!("ERROR: {e}"))?;
    let tmp = plugins.join(format!(".installing-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&tmp);

    let r#ref = r#ref.or(source.r#ref.as_deref());
    let mut args = vec!["clone", "--depth", "1"];
    if let Some(r#ref) = r#ref {
        args.extend(["--branch", r#ref]);
    }
    args.extend([source.url.as_str(), tmp.to_str().expect("utf-8 path")]);
    if let Err(e) = git(&args) {
        let _ = std::fs::remove_dir_all(&tmp);
        return Err(e);
    }

    let payload_root = source
        .subdir
        .as_deref()
        .map(|subdir| tmp.join(subdir))
        .unwrap_or_else(|| tmp.clone());
    if !payload_root.is_dir() {
        let _ = std::fs::remove_dir_all(&tmp);
        return Err(format!(
            "ERROR: plugin subdirectory does not exist: '{}'",
            source.subdir.as_deref().unwrap_or("")
        ));
    }

    // Decide which payload directory(ies) to install, as
    // (dir, fallback name, is a subdir of the clone) triples.
    let mut targets: Vec<(PathBuf, Option<String>, bool)> = Vec::new();
    if plugin_has_content(&payload_root) {
        // A single plugin: either the repo root or an explicit `#tree` subdir.
        let fallback = source
            .subdir
            .as_deref()
            .and_then(|subdir| subdir.rsplit('/').next())
            .map(str::to_string)
            .or_else(|| repo_dir_name(&source.url).map(str::to_string));
        targets.push((payload_root.clone(), fallback, source.subdir.is_some()));
    } else {
        // A collection repo (e.g. anthropics/claude-plugins-official) has no
        // payload at its root; plugins can be nested any number of dirs deep
        // (`plugins/` and `external_plugins/` are only wrapper dirs).
        let mut candidates = find_plugin_dirs(&payload_root);
        candidates.sort_by_key(|p| {
            p.strip_prefix(&payload_root)
                .map(|rel| rel.to_string_lossy().into_owned())
                .unwrap_or_default()
        });
        let rels: Vec<String> = candidates
            .iter()
            .map(|p| {
                p.strip_prefix(&payload_root)
                    .map(|rel| rel.to_string_lossy().into_owned())
                    .unwrap_or_default()
            })
            .collect();
        let picked: Vec<usize> = match candidates.len() {
            0 => {
                let _ = std::fs::remove_dir_all(&tmp);
                return Err(format!(
                    "ERROR: '{url}' has no plugin manifest, skills/, commands/, agents/, or SKILL.md - nothing to install"
                ));
            }
            // Exactly one plugin in the collection: no ambiguity, install it.
            1 => vec![0],
            n => match &collection {
                CollectionChoice::ListError => {
                    let _ = std::fs::remove_dir_all(&tmp);
                    return Err(format!(
                        "ERROR: '{url}' is a plugin collection ({n} plugins: {}) - install one directly, e.g. {url}/tree/<ref>/<relative/path>",
                        rels.join(", ")
                    ));
                }
                CollectionChoice::Prompt => {
                    // Mark plugins already installed so the user can see why a
                    // pick will be skipped.
                    let already: Vec<bool> = candidates
                        .iter()
                        .map(|p| {
                            p.file_name()
                                .and_then(|n| n.to_str())
                                .map(|n| plugins.join(n).exists())
                                .unwrap_or(false)
                        })
                        .collect();
                    match prompt_multi_choice(url, &rels, &already, &mut io::stdin().lock()) {
                        Ok(picked) => picked,
                        Err(e) => {
                            let _ = std::fs::remove_dir_all(&tmp);
                            return Err(e);
                        }
                    }
                }
                // The TUI owns stdin, so it cannot prompt inline: return the
                // candidate list untouched and let the caller present its own
                // picker, then re-invoke with `Only` for the chosen paths.
                CollectionChoice::List => {
                    let already: Vec<bool> = candidates
                        .iter()
                        .map(|p| {
                            p.file_name()
                                .and_then(|n| n.to_str())
                                .map(|n| plugins.join(n).exists())
                                .unwrap_or(false)
                        })
                        .collect();
                    let _ = std::fs::remove_dir_all(&tmp);
                    return Ok(GitInstall::Collection(
                        rels.into_iter()
                            .zip(already)
                            .map(|(path, installed)| CollectionPlugin { path, installed })
                            .collect(),
                    ));
                }
                // A picker selection: install exactly the payload-root-relative
                // paths the caller chose. A caller that never supplied any (or
                // supplied paths matching no candidate) is a user error -- the
                // collection was re-scanned since the picker's listing, so that
                // is surfaced immediately instead of falling through to the
                // confusing "already installed: (nothing)" message below.
                CollectionChoice::Only(paths) => {
                    if paths.is_empty() {
                        let _ = std::fs::remove_dir_all(&tmp);
                        return Err(format!(
                            "ERROR: no matching plugins in '{url}' to install: (none selected)"
                        ));
                    }
                    let unmatched: Vec<&String> =
                        paths.iter().filter(|p| !rels.contains(p)).collect();
                    if !unmatched.is_empty() {
                        let _ = std::fs::remove_dir_all(&tmp);
                        return Err(format!(
                            "ERROR: no matching plugins in '{url}' to install: {}",
                            unmatched
                                .into_iter()
                                .map(|s| s.as_str())
                                .collect::<Vec<_>>()
                                .join(", ")
                        ));
                    }
                    rels.iter()
                        .enumerate()
                        .filter(|(_, rel)| paths.contains(rel))
                        .map(|(idx, _)| idx)
                        .collect()
                }
            },
        };
        for idx in picked {
            let dir = candidates[idx].clone();
            let fallback = dir
                .file_name()
                .and_then(|n| n.to_str())
                .map(str::to_string);
            targets.push((dir, fallback, true));
        }
    }

    // Installing one plugin reports an already-installed collision as an error
    // (the caller asked for that exact plugin); a batch skips it and installs
    // the rest.
    let single = targets.len() == 1;
    let mut installs: Vec<InstalledPlugin> = Vec::new();
    let mut skipped: Vec<String> = Vec::new();
    for (dir, fallback, narrowed) in targets {
        let outcome = install_payload_dir(
            root,
            &plugins,
            &tmp,
            &dir,
            narrowed,
            fallback.as_deref(),
            &source.url,
        );
        match outcome {
            Ok(PayloadOutcome::Installed(plugin)) => installs.push(plugin),
            Ok(PayloadOutcome::AlreadyInstalled(stem)) => {
                if single {
                    let _ = std::fs::remove_dir_all(&tmp);
                    return Err(format!("ERROR: plugin '{stem}' is already installed"));
                }
                skipped.push(stem);
            }
            Err(e) => {
                let _ = std::fs::remove_dir_all(&tmp);
                return Err(e);
            }
        }
    }
    let _ = std::fs::remove_dir_all(&tmp);
    if installs.is_empty() {
        return Err(format!(
            "ERROR: nothing installed - already installed: {}",
            skipped.join(", ")
        ));
    }
    Ok(GitInstall::Installed(installs))
}

/// What happened to one candidate payload during an install.
enum PayloadOutcome {
    Installed(InstalledPlugin),
    /// A plugin of this name is already installed. A single-plugin install
    /// reports this as an error; a batch install skips it.
    AlreadyInstalled(String),
}

/// Move one plugin payload directory into `plugins/<stem>` and report it.
///
/// `payload_narrowed` says whether `payload` is a subdirectory of the clone
/// (rename the subdirectory) or the clone root itself (rename `tmp`).
/// `fallback_name` names the plugin when the manifest does not.
///
/// The shared clone `tmp` is NOT removed here so a batch can install several
/// payloads out of one clone; the caller removes it once at the end.
fn install_payload_dir(
    root: &Path,
    plugins: &Path,
    tmp: &Path,
    payload: &Path,
    payload_narrowed: bool,
    fallback_name: Option<&str>,
    source_url: &str,
) -> Result<PayloadOutcome, String> {
    let manifest = read_manifest(payload);
    let name = match (manifest.name.as_deref(), fallback_name) {
        (Some(name), _) if !name.is_empty() => name.to_string(),
        (_, Some(dir)) => dir.to_string(),
        _ => return Err(format!("ERROR: cannot determine plugin name from '{source_url}'")),
    };
    let stem = match skills::safe_stem(&name) {
        Ok(stem) if stem == name => stem,
        _ => return Err(format!("ERROR: invalid plugin name '{name}'")),
    };
    let target = plugins.join(&stem);
    if target.exists() {
        return Ok(PayloadOutcome::AlreadyInstalled(stem));
    }
    let move_from = if payload_narrowed { payload } else { tmp };
    std::fs::rename(move_from, &target).map_err(|e| format!("ERROR: {e}"))?;

    // Recompute counts after the move (discovery reads from `root`).
    let skills_count = skills::discover_plugins(root)
        .into_iter()
        .filter(|e| e.plugin.as_deref() == Some(stem.as_str()))
        .count();
    let commands_count = crate::core::agent::plugin_commands::discover(root)
        .into_iter()
        .filter(|e| e.plugin == stem)
        .count();
    let agents_count = crate::core::agent::subagent::count_plugin_agents(root, &stem);
    let tools_count = crate::core::agent::hooks_config::plugin_tool_entries(&target).len();
    let hooks_count = tauri_plugin_agent_tools::tools::hooks::plugin_hook_entries(&target)
        .0
        .len();
    Ok(PayloadOutcome::Installed(InstalledPlugin {
        name: stem,
        description: manifest.description.unwrap_or_default(),
        version: manifest.version.unwrap_or_else(|| "0.0.0".to_string()),
        repo: manifest.repo.unwrap_or_else(|| source_url.to_string()),
        skills: skills_count,
        commands: commands_count,
        agents: agents_count,
        tools: tools_count,
        hooks: hooks_count,
    }))
}

/// Fetch and parse the marketplace index. The marketplace URL lives in
/// `[plugins] marketplace`; without it, name-based installs cannot resolve.
async fn fetch_index(url: &str) -> Result<Vec<MarketEntry>, String> {
    let resp = client()?
        .get(url)
        .send()
        .await
        .map_err(|e| format!("ERROR: fetching marketplace index: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!(
            "ERROR: marketplace index returned {}",
            resp.status()
        ));
    }
    resp.json::<Vec<MarketEntry>>()
        .await
        .map_err(|e| format!("ERROR: parsing marketplace index: {e}"))
}

/// Install a plugin. `spec` is either a git source (URL, `git@host:path`,
/// `github:owner/repo`, with an optional `#ref`) or a marketplace name.
///
/// Non-interactive: a multi-plugin collection fails with a listing error, so
/// this always resolves to exactly one plugin. (The "exactly one" invariant
/// is enforced structurally by `CollectionChoice`: `install` passes
/// `ListError`, whose arm always returns an `Err` and never a
/// `GitInstall::Collection`.)
// (desktop-only) `install` is the non-CLI entry point (`commands`), so it is
// dead under `--features cli` (only the CLI TUI unit test uses it) and allowed
// rather than `cfg`'d out so it stays available in both configs.
pub(crate) async fn install(root: &Path, spec: &str) -> Result<InstalledPlugin, String> {
    match install_with(root, spec, CollectionChoice::ListError).await? {
        GitInstall::Installed(plugins) => plugins
            .into_iter()
            .next()
            .ok_or_else(|| "ERROR: no plugins installed".to_string()),
        GitInstall::Collection(_) => unreachable!("ListError never returns a collection listing"),
    }
}

/// Install like [`install`], but a multi-plugin collection prompts the user to
/// pick which plugins to install (the interactive CLI path), so this can return
/// several. Already-installed picks are skipped.
// (cli-only)

/// List the plugins inside a collection without installing anything, for a
/// caller that owns its own terminal (the TUI) to present a picker.
/// `GitInstall::Installed` means `spec` was not an ambiguous collection - a
/// single plugin (bare source, `#tree` subdir, or a collection with exactly
/// one nested plugin) installs directly, so it's already done.
// (cli-only)

/// Install exactly the given payload-root-relative paths from a collection
/// (a picker selection following [`list_collection`]). Already-installed
/// picks are skipped rather than erroring.
// (cli-only)

/// Core install. Resolves git URLs on a blocking thread and marketplace names
/// through the index, then runs the git clone/filesystem work off the async
/// runtime (the TUI render loop must keep repainting during a large clone).
async fn install_with(
    root: &Path,
    spec: &str,
    collection: CollectionChoice,
) -> Result<GitInstall, String> {
    let spec = spec.trim();
    validate_spec(spec)?;
    if looks_like_git(spec) {
        // `install_git` shells out to `git clone`, which is network-bound and
        // blocks its thread for the whole clone. Run it on a blocking thread so
        // the TUI keeps repainting (a large plugin repo otherwise freezes the
        // render loop for seconds).
        let root = root.to_path_buf();
        let spec = spec.to_string();
        return tokio::task::spawn_blocking(move || install_git(&root, &spec, None, collection))
            .await
            .map_err(|e| format!("ERROR: install task failed: {e}"))?;
    }
    let marketplace = plugins_section(root)
        .marketplace
        .ok_or("ERROR: no marketplace configured - set [plugins] marketplace in agent.toml, or install a git URL directly")?;
    let index = fetch_index(&marketplace).await?;
    let entry = index
        .into_iter()
        .find(|e| e.name == spec)
        .ok_or_else(|| format!("ERROR: plugin '{spec}' not found on the marketplace"))?;
    // Marketplace installs clone a git repo too: same blocking-work treatment.
    let root = root.to_path_buf();
    let repo = entry.repo.clone();
    let r#ref = entry.r#ref.clone();
    tokio::task::spawn_blocking(move || install_git(&root, &repo, r#ref.as_deref(), collection))
        .await
        .map_err(|e| format!("ERROR: install task failed: {e}"))?
}

/// Remove an installed plugin by directory name.
pub(crate) fn remove(root: &Path, name: &str) -> Result<(), String> {
    let stem = skills::safe_stem(name)?;
    let target = skills::plugins_dir(root).join(&stem);
    if !target.is_dir() {
        return Err(format!("ERROR: plugin '{name}' is not installed"));
    }
    std::fs::remove_dir_all(&target).map_err(|e| format!("ERROR: {e}"))?;
    // Drop the stored credentials too: they live outside the plugin
    // directory (a reinstall must not silently reactivate them), so removing
    // the plugin has to clean them up here. Then refresh the live registry so
    // the sandboxed shells of the current session stop receiving the values.
    if let Ok(dir) = plugin_env_dir() {
        if let Ok(path) = plugin_env_path(&dir, name) {
            let _ = std::fs::remove_file(path);
        }
    }
    sync_env_registry(root);
    Ok(())
}

/// List marketplace plugins matching `query` (name or description, case
/// insensitive; empty query lists everything).
pub(crate) async fn search(root: &Path, query: &str) -> Result<Vec<MarketEntry>, String> {
    let url = plugins_section(root)
        .marketplace
        .ok_or("ERROR: no marketplace configured - set [plugins] marketplace in agent.toml")?;
    let mut entries = fetch_index(&url).await?;
    let query = query.trim().to_lowercase();
    if !query.is_empty() {
        entries.retain(|e| {
            e.name.to_lowercase().contains(&query) || e.description.to_lowercase().contains(&query)
        });
    }
    Ok(entries)
}

