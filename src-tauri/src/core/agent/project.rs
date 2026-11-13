//! `agent.toml` project config parsing and store scaffolding
//! (`~/.jan/projects/<slug>/`).

use std::path::{Path, PathBuf};

use serde::Deserialize;

/// The parts of `agent.toml` the desktop reads: the skill whitelist and hooks.
/// Unknown keys (an older scaffold's `[tools]`, `[prompt]`, ...) are ignored.
#[derive(Debug, Clone, Default, Deserialize)]
pub(crate) struct AgentToml {
    #[serde(default)]
    pub skills: SkillsSection,
    #[serde(default)]
    pub plugins: PluginsSection,
    /// `[[hooks]]` -- lifecycle commands this project runs around tool calls.
    /// An array of tables rather than a `[hooks]` map because several hooks
    /// may share one event.
    #[serde(default)]
    pub hooks: Vec<tauri_plugin_agent_tools::tools::hooks::HookEntry>,
}

/// `[plugins]` -- switches for what installed plugins bring.
#[derive(Debug, Clone, Default, Deserialize)]
pub(crate) struct PluginsSection {
    /// Whether an installed plugin's `hooks/hooks.json` is honored. On by
    /// default, but a plugin's hooks are third-party commands that fire on
    /// every tool call, so `hooks = false` switches them off without
    /// uninstalling the plugin.
    #[serde(default)]
    pub hooks: Option<bool>,
}

/// `[skills]` -- which project skills are advertised to the model. An empty
/// `enabled` list means "all skills"; a non-empty list is a whitelist.
#[derive(Debug, Clone, Default, Deserialize)]
pub(crate) struct SkillsSection {
    #[serde(default)]
    pub enabled: Vec<String>,
}

const AGENT_TOML_TEMPLATE: &str = r#"# Skills advertised to the model; empty means every skill in skills/.
[skills]
enabled = []

# Commands run around tool calls. See the hooks docs for events and fields.
# [[hooks]]
# event = "PreToolUse"
# command = "echo checked"
"#;


/// `~/.jan`, where every project's store lives. Test builds use a per-process
/// temp directory so no test reads or writes the developer's real `~/.jan`;
/// the plugin's own `cfg(test)` override is not active when this crate
/// compiles it as a dependency.
pub(crate) fn jan_home() -> Option<PathBuf> {
    #[cfg(test)]
    {
        Some(std::env::temp_dir().join(format!("jan-app-test-home-{}", std::process::id())))
    }
    #[cfg(not(test))]
    {
        tauri_plugin_agent_tools::workspace::jan_home()
    }
}

/// A project's store root, `~/.jan/projects/<slug>`: `agent.toml`, `memory/`,
/// `skills/` and `plugins/`. The one place the
/// app resolves it; the project directory itself holds only `JAN.md`.
pub(crate) fn store_root(project_root: &Path) -> PathBuf {
    tauri_plugin_agent_tools::workspace::project_store_at(jan_home().as_deref(), project_root)
}

/// Move a legacy `<project>/.jan/agent` into [`store_root`] when the workspace
/// still has a `.jan` directory. Called once per launch, before anything reads
/// the store; returns a line for the surface to show, if any.
///
/// Once per project per process: later calls are free and return `None`, so
/// every entry point can call it without re-reporting.
pub(crate) fn migrate_legacy_store(project_root: &Path) -> Option<String> {
    use std::collections::HashSet;
    use std::sync::Mutex;
    static SEEN: Mutex<Option<HashSet<PathBuf>>> = Mutex::new(None);
    {
        let mut seen = SEEN.lock().unwrap_or_else(|e| e.into_inner());
        if !seen.get_or_insert_with(HashSet::new).insert(project_root.to_path_buf()) {
            return None;
        }
    }
    let home = jan_home()?;
    let store = store_root(project_root);
    let outcome =
        crate::core::agent::store_migration::migrate_on_launch(project_root, &store, Some(&home));
    if matches!(outcome, crate::core::agent::store_migration::Outcome::Moved { .. }) {
        // A migrated store has notes but no indexes yet, and the root index
        // should point at it straight away.
        let _ = tauri_plugin_agent_tools::workspace::write_project_meta(&store, project_root);
        tauri_plugin_agent_tools::memory::write_index(&store);
        let (_, _, cross_project) = memory_roots(project_root);
        tauri_plugin_agent_tools::memory::write_root_index(&home, cross_project);
    }
    outcome.message()
}

/// The memory a run in `project_root` reaches, as owned paths: the project's
/// store, and `~/.jan` for the user scope and other projects. Tests get no
/// cross-project listing, so one test's notes never reach another's prompt.
pub(crate) fn memory_roots(project_root: &Path) -> (PathBuf, Option<PathBuf>, bool) {
    #[cfg(test)]
    let cross = false;
    #[cfg(not(test))]
    let cross = crate::core::agent::global_config::memory_cross_project_enabled();
    (store_root(project_root), jan_home(), cross)
}

/// Path to `<store_root>/agent.toml`.
pub(crate) fn agent_toml_path(project_root: &Path) -> PathBuf {
    store_root(project_root).join("agent.toml")
}

/// Load + parse agent.toml. Err if missing or malformed (path included in message).
pub(crate) fn load_agent_config(project_root: &Path) -> Result<AgentToml, String> {
    let path = agent_toml_path(project_root);
    let raw = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read {}: {e}", path.display()))?;
    toml::from_str(&raw).map_err(|e| format!("Failed to parse {}: {e}", path.display()))
}

/// Ensure a usable `{agent.toml, skills/, memory/}` exists in the project's
/// store (see [`store_root`]), creating only the pieces that don't already exist.
/// Idempotent and clobber-safe: preserves user edits on re-runs.
///
/// The project instructions file (`<project_root>/JAN.md`) is deliberately not
/// scaffolded: an empty placeholder costs prompt space and teaches nothing.
pub(crate) fn ensure_project(project_root: &Path) -> Result<PathBuf, String> {
    if !project_root.is_dir() {
        return Err(format!(
            "project directory does not exist: {}",
            project_root.display()
        ));
    }
    // Before scaffolding, or an empty new store would turn the move into a
    // conflict. A no-op after the first call for this project.
    if let Some(note) = migrate_legacy_store(project_root) {
        log::info!("Agent: {note}");
    }
    let agent_dir = store_root(project_root);
    std::fs::create_dir_all(agent_dir.join("skills"))
        .map_err(|e| format!("Failed to create skills dir: {e}"))?;
    std::fs::create_dir_all(agent_dir.join("memory"))
        .map_err(|e| format!("Failed to create memory dir: {e}"))?;

    let toml_path = agent_dir.join("agent.toml");
    if !toml_path.exists() {
        std::fs::write(&toml_path, AGENT_TOML_TEMPLATE)
            .map_err(|e| format!("Failed to write {}: {e}", toml_path.display()))?;
    } else if drop_retired_keys(&toml_path) {
        log::info!("agent.toml: removed the retired [skills].inject key");
    }
    // Best-effort: only the memory index's project pointers read it.
    let _ = tauri_plugin_agent_tools::workspace::write_project_meta(&agent_dir, project_root);

    Ok(agent_dir)
}

/// Delete keys an older scaffold wrote that nothing reads any more, in place and
/// format-preserving. Only `[skills].inject` today (janhq/jan-internal#394): the
/// agent.toml is Jan's own scaffold in Jan's store, so tidying it here beats a
/// warning on every launch asking the user to do the same edit by hand.
///
/// Best-effort: a file that cannot be read, parsed or written is left alone,
/// since the key is ignored when parsing anyway. True when a key was removed.
fn drop_retired_keys(path: &Path) -> bool {
    let Ok(raw) = std::fs::read_to_string(path) else {
        return false;
    };
    let Ok(mut doc) = raw.parse::<toml_edit::DocumentMut>() else {
        return false;
    };
    let removed = doc
        .get_mut("skills")
        .and_then(|skills| skills.as_table_like_mut())
        .and_then(|skills| skills.remove("inject"))
        .is_some();
    removed && std::fs::write(path, doc.to_string()).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    static COUNTER: AtomicU32 = AtomicU32::new(0);

    /// The pid keeps the path unique across concurrently-running test
    /// binaries: a leftover root from one run makes `ensure_project` skip
    /// scaffolding in the next.
    fn unique_root(tag: &str) -> PathBuf {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let pid = std::process::id();
        let root = std::env::temp_dir().join(format!("jan_agent_test_{tag}_{pid}_{n}"));
        std::fs::create_dir_all(&root).expect("create test project root");
        root
    }


    /// `ensure_project` scaffolds `{skills,memory}` in the store, while the
    /// toolset reads those same directories through the store root it is
    /// handed. If the two ever drift a user's skills and memories stop being
    /// found. The store must also never land inside the project.
    #[test]
    fn scaffolded_dirs_match_the_toolset_store_layout() {
        use tauri_plugin_agent_tools::workspace;

        let root = unique_root("store_layout");
        let store = ensure_project(&root).expect("scaffold project");

        assert_eq!(store, store_root(&root));
        assert!(!store.starts_with(&root), "the store must live outside the project");
        assert!(!root.join(".jan").exists(), "nothing is written into the project");
        assert!(
            tauri_plugin_agent_tools::skills::skills_dir(&store).is_dir(),
            "skills dir the toolset reads is not the one ensure_project created"
        );
        assert!(
            workspace::store_dir(&store, "memory").is_dir(),
            "memory dir the toolset reads is not the one ensure_project created"
        );

        let _ = std::fs::remove_dir_all(&root);
    }

    /// `[skills].inject` was scaffolded but never read (janhq/jan-internal#394);
    /// it is gone from the template, and an agent.toml that still has it keeps
    /// parsing with the whitelist intact.
    #[test]
    fn retired_skills_inject_is_dropped_from_the_template_but_still_parses() {
        assert!(!AGENT_TOML_TEMPLATE.contains("inject ="));
        for value in ["\"always\"", "\"relevance\"", "true"] {
            let cfg: AgentToml =
                toml::from_str(&format!("[skills]\nenabled = [\"a\"]\ninject = {value}\n"))
                    .expect("a legacy inject key still parses");
            assert_eq!(cfg.skills.enabled, vec!["a".to_string()]);
        }
    }

    /// Starting a run removes the retired key from an existing agent.toml,
    /// keeping the rest of the file (comments included) byte for byte, and
    /// leaves a file without it untouched.
    #[test]
    fn ensure_project_removes_the_retired_skills_inject_key() {
        let root = unique_root("retired_inject");
        let store = ensure_project(&root).expect("scaffold");
        let path = store.join("agent.toml");
        let kept = "# my notes\n[skills]\n# only these\nenabled = [\"a\"]\n\n[tools]\ndefault = \"allow\"\n";
        let legacy = "# my notes\n[skills]\n# only these\nenabled = [\"a\"]\n# how skills reach the prompt\ninject = \"relevance\"\n\n[tools]\ndefault = \"allow\"\n";
        std::fs::write(&path, legacy).unwrap();

        ensure_project(&root).expect("ensure again");
        assert_eq!(std::fs::read_to_string(&path).unwrap(), kept);
        assert!(!drop_retired_keys(&path), "nothing left to remove");
        assert_eq!(std::fs::read_to_string(&path).unwrap(), kept);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn ensure_errors_when_project_dir_missing() {
        // A mistyped path (e.g. wrong case) must fail fast, not scaffold a
        // phantom project dir from nothing.
        let root = std::env::temp_dir().join(format!(
            "jan_agent_missing_{}",
            COUNTER.fetch_add(1, Ordering::SeqCst)
        ));
        assert!(!root.exists());
        let err = ensure_project(&root).expect_err("must reject missing dir");
        assert!(err.contains("does not exist"), "err: {err}");
        assert!(!root.exists(), "must not create the missing project dir");
    }

    /// The instructions file lives at the project root as `JAN.md` and is the
    /// user's to create -- the scaffold must not plant an empty
    /// one in the store, which nothing reads.
    #[test]
    fn ensure_does_not_scaffold_an_instructions_file() {
        let root = unique_root("no_instructions");
        let dir = ensure_project(&root).expect("ensure");
        assert!(!dir.join("AGENT.md").exists());
        assert!(!root.join("JAN.md").exists());
        assert!(!AGENT_TOML_TEMPLATE.contains("instructions_file"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn load_missing_errors() {
        let root = unique_root("missing");
        assert!(load_agent_config(&root).is_err());
    }
    #[test]
    fn ensure_creates_artifacts_and_is_idempotent() {
        let root = unique_root("ensure");
        let dir = ensure_project(&root).expect("ensure");
        assert!(dir.join("agent.toml").exists());
        assert!(dir.join("skills").is_dir());
        assert!(dir.join("memory").is_dir());

        // Second call must not error and must preserve user edits.
        std::fs::write(dir.join("agent.toml"), "[skills]\nenabled = [\"a\"]\n").unwrap();
        ensure_project(&root).expect("ensure again");
        let cfg = load_agent_config(&root).expect("load");
        assert_eq!(cfg.skills.enabled, vec!["a".to_string()]);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn template_parses() {
        let cfg: AgentToml = toml::from_str(AGENT_TOML_TEMPLATE).expect("scaffold template parses");
        assert!(cfg.skills.enabled.is_empty());
        assert!(cfg.hooks.is_empty());
    }
}
