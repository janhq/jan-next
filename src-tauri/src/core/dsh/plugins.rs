//! The DSH plugin store: a shipped base composition (`cordis.yml`), a user
//! layer (`<data>/dsh/plugins.yml`) and Jan's MCP servers rendered as
//! `mcp-client` entries, merged into the one `cordis.yml` the runtime boots.
//!
//! The base stays text, not a parsed document: it carries `!!js` expressions
//! that a YAML round trip would not preserve. Overrides therefore work per
//! top-level entry chunk (`disabled: true` is injected into the chunk).

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const BASE: &str = include_str!("cordis.yml");
const SERVER_JS: &str = include_str!("../../../../dsh/server/index.js");

/// One entry of the user layer. `name` is the module specifier the Loader
/// imports; an entry whose `id` matches a base entry only contributes
/// `disabled`.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct UserEntry {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub config: Option<serde_yaml::Value>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub disabled: bool,
    /// npm package this entry was installed from, so remove can uninstall it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub package: Option<String>,
}

fn is_false(v: &bool) -> bool {
    !*v
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginEntry {
    pub id: String,
    pub name: String,
    /// `base` (shipped), `user` (plugins.yml) or `mcp` (Jan's MCP settings).
    pub source: String,
    pub enabled: bool,
    /// YAML text of the entry's config; for base entries the raw shipped text.
    pub config: String,
    pub package: Option<String>,
}

fn user_file(dir: &Path) -> PathBuf {
    dir.join("plugins.yml")
}

pub fn read_user(dir: &Path) -> Result<Vec<UserEntry>, String> {
    let path = user_file(dir);
    if !path.is_file() {
        return Ok(Vec::new());
    }
    let text = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    if text.trim().is_empty() {
        return Ok(Vec::new());
    }
    serde_yaml::from_str(&text).map_err(|e| format!("{} is not valid: {e}", path.display()))
}

fn write_user(dir: &Path, entries: &[UserEntry]) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let text = serde_yaml::to_string(entries).map_err(|e| e.to_string())?;
    std::fs::write(user_file(dir), text).map_err(|e| e.to_string())
}

/// Splits the base into one text chunk per top-level `- id:` entry, keeping
/// the leading comments with the entry they describe.
fn base_chunks() -> Vec<(String, String, String)> {
    let mut chunks: Vec<(String, String)> = Vec::new();
    let mut pending = String::new();
    for line in BASE.lines() {
        if let Some(id) = line.strip_prefix("- id:") {
            chunks.push((id.trim().to_owned(), format!("{pending}{line}\n")));
            pending.clear();
        } else if line.starts_with('#') || line.trim().is_empty() {
            if chunks.is_empty() {
                continue;
            }
            // A comment block belongs to the entry that follows it.
            if line.trim().is_empty() {
                if let Some(last) = chunks.last_mut() {
                    last.1.push('\n');
                }
                pending.clear();
            } else {
                pending.push_str(line);
                pending.push('\n');
            }
        } else if let Some(last) = chunks.last_mut() {
            last.1.push_str(&pending);
            pending.clear();
            last.1.push_str(line);
            last.1.push('\n');
        }
    }
    chunks
        .into_iter()
        .map(|(id, text)| {
            let name = text
                .lines()
                .find_map(|l| l.trim().strip_prefix("name:").map(|n| n.trim().trim_matches('\'').to_owned()))
                .unwrap_or_default();
            (id, name, text)
        })
        .collect()
}

fn config_text(text: &str) -> String {
    match text.find("  config:") {
        Some(i) => text[i..].to_owned(),
        None => String::new(),
    }
}

/// The checkout's `packages/` folder as a `file:///` URL. Packages missing from
/// `examples/node_modules` load from there by path; the Loader hands the name
/// to `import()`, and Node reads a bare `C:/...` as a URL with scheme `c:`.
fn packages_url(root: &Path) -> String {
    format!(
        "file:///{}",
        root.join("packages")
            .to_string_lossy()
            .replace('\\', "/")
            .trim_start_matches('/')
    )
}

/// The base text with the checkout path filled in.
fn base_text(text: &str, root: &Path) -> String {
    text.replace("{{DSH_PACKAGES}}", &packages_url(root))
}

/// Jan's `mcp_config.json` servers as `mcp-client` rows: `(entry id, active, row)`.
fn mcp_rows(data_root: &Path, root: &Path) -> Vec<(String, bool, Value)> {
    let Ok(body) = std::fs::read_to_string(data_root.join("mcp_config.json")) else {
        return Vec::new();
    };
    let Ok(doc) = serde_json::from_str::<Value>(&body) else {
        return Vec::new();
    };
    let Some(servers) = doc.get("mcpServers").and_then(Value::as_object) else {
        return Vec::new();
    };
    // The checkout's examples/node_modules does not carry mcp-client, so the
    // entry points at the workspace package, which resolves its own deps.
    let module = format!("{}/mcp/mcp-client/lib/index.js", packages_url(root));
    let timeout_ms = doc
        .pointer("/mcpSettings/toolCallTimeoutSeconds")
        .and_then(Value::as_u64)
        .map(|s| s * 1000);
    let mut rows = Vec::new();
    for (name, cfg) in servers {
        let server_name: String = name
            .chars()
            .map(|c| if c.is_ascii_alphanumeric() || c == '_' || c == '-' { c } else { '_' })
            .take(32)
            .collect();
        if server_name.is_empty() {
            continue;
        }
        let active = cfg.get("active").and_then(Value::as_bool).unwrap_or(true);
        let timeout = cfg
            .get("timeout")
            .and_then(Value::as_u64)
            .map(|s| s * 1000)
            .or(timeout_ms);
        let strings = |key: &str| -> Value {
            let mut out = serde_json::Map::new();
            if let Some(map) = cfg.get(key).and_then(Value::as_object) {
                for (k, v) in map {
                    if let Some(s) = v.as_str() {
                        out.insert(k.clone(), json!(s));
                    }
                }
            }
            Value::Object(out)
        };
        let is_http = matches!(cfg.get("type").and_then(Value::as_str), Some("http" | "sse"))
            || (cfg.get("command").is_none() && cfg.get("url").is_some());
        let mut config = if is_http {
            let Some(url) = cfg.get("url").and_then(Value::as_str) else { continue };
            json!({
                "transport": "streamable-http",
                "serverName": server_name,
                "url": url,
                "headers": strings("headers"),
            })
        } else {
            let Some(command) = cfg.get("command").and_then(Value::as_str) else { continue };
            let args: Vec<Value> = cfg
                .get("args")
                .and_then(Value::as_array)
                .map(|a| a.iter().filter_map(|v| v.as_str().map(|s| json!(s))).collect())
                .unwrap_or_default();
            json!({
                "transport": "stdio",
                "serverName": server_name,
                "command": command,
                "args": args,
                "env": strings("env"),
            })
        };
        if let Some(ms) = timeout {
            config["toolCallTimeoutMs"] = json!(ms);
        }
        rows.push((
            format!("mcp-{server_name}"),
            active,
            json!({ "id": format!("mcp-{server_name}"), "name": module, "config": config }),
        ));
    }
    rows
}

pub fn list(dir: &Path, data_root: &Path, root: &Path) -> Result<Vec<PluginEntry>, String> {
    let user = read_user(dir)?;
    let mut out = Vec::new();
    for (id, name, text) in base_chunks() {
        let disabled = user.iter().any(|u| u.id == id && u.disabled);
        out.push(PluginEntry {
            id,
            name: base_text(&name, root),
            source: "base".into(),
            enabled: !disabled,
            config: config_text(&text),
            package: None,
        });
    }
    for u in user.iter().filter(|u| !base_chunks().iter().any(|(id, ..)| *id == u.id)) {
        out.push(PluginEntry {
            id: u.id.clone(),
            name: u.name.clone().unwrap_or_default(),
            source: "user".into(),
            enabled: !u.disabled,
            config: match &u.config {
                Some(c) => serde_yaml::to_string(c).map_err(|e| e.to_string())?,
                None => String::new(),
            },
            package: u.package.clone(),
        });
    }
    for (id, active, row) in mcp_rows(data_root, root) {
        out.push(PluginEntry {
            id,
            name: row["name"].as_str().unwrap_or_default().to_owned(),
            source: "mcp".into(),
            enabled: active,
            config: serde_yaml::to_string(&row["config"]).map_err(|e| e.to_string())?,
            package: None,
        });
    }
    Ok(out)
}

/// The `cordis.yml` text: base chunks (with overrides), user entries, MCP rows.
pub fn compose(dir: &Path, data_root: &Path, root: &Path) -> Result<String, String> {
    let user = read_user(dir)?;
    let mut out = String::new();
    let mut base_ids = Vec::new();
    for (id, _, text) in base_chunks() {
        let text = base_text(&text, root);
        let disabled = user.iter().any(|u| u.id == id && u.disabled);
        base_ids.push(id);
        if disabled {
            let (head, rest) = text.split_once("- id:").unwrap_or(("", &text));
            let (first, tail) = rest.split_once('\n').unwrap_or((rest, ""));
            out.push_str(&format!("{head}- id:{first}\n  disabled: true\n{tail}"));
        } else {
            out.push_str(&text);
        }
    }
    let mut rows: Vec<Value> = Vec::new();
    for u in user.iter().filter(|u| !base_ids.contains(&u.id)) {
        let Some(name) = &u.name else { continue };
        let mut row = json!({ "id": u.id, "name": name });
        if let Some(cfg) = &u.config {
            row["config"] = serde_json::to_value(cfg).map_err(|e| e.to_string())?;
        }
        if u.disabled {
            row["disabled"] = json!(true);
        }
        rows.push(row);
    }
    for (_, active, row) in mcp_rows(data_root, root) {
        let mut row = row;
        if !active {
            row["disabled"] = json!(true);
        }
        rows.push(row);
    }
    if !rows.is_empty() {
        out.push_str("\n# User plugins (plugins.yml) and MCP servers (mcp_config.json).\n");
        out.push_str(&serde_yaml::to_string(&rows).map_err(|e| e.to_string())?);
    }
    Ok(out)
}

/// Writes our server plugin where the composition's relative path finds it.
/// `plugins/package.json` marks the folder as ESM for Node.
pub fn write_server(dir: &Path) -> Result<(), String> {
    let plugin = dir.join("plugins").join("ow-server");
    std::fs::create_dir_all(&plugin).map_err(|e| e.to_string())?;
    std::fs::write(dir.join("plugins").join("package.json"), "{\"type\":\"module\"}\n")
        .map_err(|e| e.to_string())?;
    std::fs::write(plugin.join("index.js"), SERVER_JS).map_err(|e| e.to_string())
}

fn mutate<F: FnOnce(&mut Vec<UserEntry>) -> Result<(), String>>(dir: &Path, f: F) -> Result<(), String> {
    let mut user = read_user(dir)?;
    f(&mut user)?;
    write_user(dir, &user)
}

pub fn set_enabled(dir: &Path, id: &str, enabled: bool) -> Result<(), String> {
    let is_base = base_chunks().iter().any(|(b, ..)| b == id);
    let is_mcp = mcp_rows_exist(id);
    if is_mcp {
        return Err("MCP servers are enabled in the MCP settings".into());
    }
    mutate(dir, |user| {
        match user.iter_mut().find(|u| u.id == id) {
            Some(u) => u.disabled = !enabled,
            None if is_base => user.push(UserEntry { id: id.into(), disabled: !enabled, ..Default::default() }),
            None => return Err(format!("no plugin entry '{id}'")),
        }
        // A base override with nothing left to say is noise.
        user.retain(|u| !(u.name.is_none() && !u.disabled));
        Ok(())
    })
}

fn mcp_rows_exist(id: &str) -> bool {
    id.starts_with("mcp-")
}

pub fn set_config(dir: &Path, id: &str, config: &str) -> Result<(), String> {
    if base_chunks().iter().any(|(b, ..)| b == id) {
        return Err("shipped entries can only be enabled or disabled".into());
    }
    let parsed: serde_yaml::Value = if config.trim().is_empty() {
        serde_yaml::Value::Null
    } else {
        serde_yaml::from_str(config).map_err(|e| format!("config is not valid YAML: {e}"))?
    };
    mutate(dir, |user| {
        let u = user
            .iter_mut()
            .find(|u| u.id == id)
            .ok_or_else(|| format!("no user plugin entry '{id}'"))?;
        u.config = if parsed.is_null() { None } else { Some(parsed) };
        Ok(())
    })
}

pub fn remove(dir: &Path, id: &str) -> Result<Option<String>, String> {
    let mut package = None;
    mutate(dir, |user| {
        let i = user
            .iter()
            .position(|u| u.id == id && u.name.is_some())
            .ok_or_else(|| format!("'{id}' is not a user plugin entry"))?;
        package = user.remove(i).package;
        Ok(())
    })?;
    Ok(package)
}

/// Entry file of an installed package, relative to the config folder so the
/// Loader imports it by path (bare names resolve only from the checkout's
/// node_modules).
fn package_entry(dir: &Path, package: &str) -> Result<String, String> {
    let pkg_dir = dir.join("user_modules").join("node_modules").join(package);
    let manifest: Value = serde_json::from_str(
        &std::fs::read_to_string(pkg_dir.join("package.json"))
            .map_err(|e| format!("installed package has no package.json: {e}"))?,
    )
    .map_err(|e| e.to_string())?;
    let from_exports = manifest.get("exports").and_then(|e| {
        let root = e.get(".").unwrap_or(e);
        match root {
            Value::String(s) => Some(s.clone()),
            Value::Object(o) => ["import", "default", "node"]
                .iter()
                .find_map(|k| o.get(*k).and_then(Value::as_str).map(str::to_owned)),
            _ => None,
        }
    });
    let main = from_exports
        .or_else(|| manifest.get("main").and_then(Value::as_str).map(str::to_owned))
        .unwrap_or_else(|| "index.js".into());
    let main = main.trim_start_matches("./");
    Ok(format!("./user_modules/node_modules/{package}/{main}"))
}

fn package_name(spec: &str) -> &str {
    // Strip a version suffix: `@scope/pkg@1.2` or `pkg@latest`.
    let at = spec.rfind('@').filter(|i| *i > 0);
    at.map_or(spec, |i| &spec[..i])
}

pub async fn install(dir: &Path, spec: &str) -> Result<(), String> {
    let spec = spec.trim();
    if spec.is_empty() || spec.starts_with('-') || spec.contains(char::is_whitespace) {
        return Err("enter one npm package name".into());
    }
    let package = package_name(spec).to_owned();
    let prefix = dir.join("user_modules");
    std::fs::create_dir_all(&prefix).map_err(|e| e.to_string())?;
    let manifest = prefix.join("package.json");
    if !manifest.exists() {
        std::fs::write(&manifest, "{\"name\":\"dsh-user-modules\",\"private\":true}\n").map_err(|e| e.to_string())?;
    }
    // Peers are omitted on purpose: a plugin's @deepseek-ai/* imports must
    // resolve up to <data>/dsh/node_modules (the checkout), not to a second
    // copy of cordis that would not share its services.
    #[cfg(windows)]
    let mut cmd = {
        let mut c = tokio::process::Command::new("cmd");
        c.args(["/C", "npm"]);
        c.creation_flags(0x08000000);
        c
    };
    #[cfg(not(windows))]
    let mut cmd = tokio::process::Command::new("npm");
    let output = cmd
        .args(["install", "--no-audit", "--no-fund", "--omit=peer", "--legacy-peer-deps", "--prefix"])
        .arg(&prefix)
        .arg(spec)
        .output()
        .await
        .map_err(|e| format!("could not run npm (is Node installed?): {e}"))?;
    if !output.status.success() {
        let tail: String = String::from_utf8_lossy(&output.stderr).lines().rev().take(8).collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join("\n");
        return Err(format!("npm install failed:\n{tail}"));
    }
    let entry = package_entry(dir, &package)?;
    let id: String = package
        .trim_start_matches("@deepseek-ai/dsh-")
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' { c } else { '-' })
        .collect();
    mutate(dir, |user| {
        user.retain(|u| u.id != id);
        user.push(UserEntry {
            id,
            name: Some(entry),
            package: Some(package),
            ..Default::default()
        });
        Ok(())
    })
}

/// Uninstalls the package behind a removed entry; best effort, since the
/// entry is already gone from the composition either way.
pub async fn uninstall(dir: &Path, package: &str) {
    #[cfg(windows)]
    let mut cmd = {
        let mut c = tokio::process::Command::new("cmd");
        c.args(["/C", "npm"]);
        c.creation_flags(0x08000000);
        c
    };
    #[cfg(not(windows))]
    let mut cmd = tokio::process::Command::new("npm");
    let _ = cmd
        .args(["uninstall", "--no-audit", "--no-fund", "--prefix"])
        .arg(dir.join("user_modules"))
        .arg(package)
        .output()
        .await;
}
