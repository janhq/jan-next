//! Tauri command surface for the agent's project-scoped skills.

use crate::core::agent::project::{ensure_project, store_root};
use crate::core::agent::skills as agent_skills;
use tauri_plugin_agent_tools::skills::{self, SkillMeta};

/// Strip the internal `ERROR: ` prefix (an agent-tool-output convention) so the
/// message reads cleanly in a UI toast.
fn ui_error(e: String) -> String {
    e.strip_prefix("ERROR: ").map(str::to_string).unwrap_or(e)
}

/// List the skills under `<store>/skills/` (folder `<name>/SKILL.md`
/// and legacy flat `<name>.md`). These are the same skills `load_skills` injects
/// into the agent's system prompt; managing them here is CRUD over that
/// directory. Read-only: returns empty when the project isn't scaffolded yet.
#[tauri::command]
pub async fn agent_skill_list(project: String) -> Result<Vec<SkillMeta>, String> {
    let root = std::path::PathBuf::from(&project);
    Ok(skills::list_meta(&store_root(&root)))
}

/// Read one skill's raw SKILL.md (frontmatter included) for the editor.
#[tauri::command]
pub async fn agent_skill_read(project: String, name: String) -> Result<String, String> {
    let root = std::path::PathBuf::from(&project);
    skills::read_raw(&store_root(&root), &name).map_err(ui_error)
}

/// Create or overwrite a skill. New skills are written as `<name>/SKILL.md`;
/// existing ones keep their on-disk form. `name` is sanitized (no path escape).
#[tauri::command]
pub async fn agent_skill_write(
    project: String,
    name: String,
    content: String,
) -> Result<(), String> {
    let root = std::path::PathBuf::from(&project);
    ensure_project(&root)?;
    skills::write(&store_root(&root), &name, &content).map_err(ui_error)
}

/// Delete a skill by name. Idempotent: a missing skill is treated as success.
#[tauri::command]
pub async fn agent_skill_delete(project: String, name: String) -> Result<(), String> {
    let root = std::path::PathBuf::from(&project);
    skills::delete(&store_root(&root), &name).map_err(ui_error)
}

/// Build the user message for invoking an enabled skill (`/skill:<name>` /
/// `<skill>` semantics shared with the console): the full skill body wrapped
/// in an invocation header, skill directory announcement for bundled files,
/// and the user's `args` threaded in. Err when the skill is unknown or
/// disabled. UIs submit the returned message through their own session flow.
#[tauri::command]
pub async fn agent_skill_invoke(
    project: String,
    name: String,
    args: String,
) -> Result<String, String> {
    let root = std::path::PathBuf::from(&project);
    agent_skills::build_invocation_message(&root, &name, &args)
        .map(|(message, _)| message)
        .map_err(ui_error)
}
