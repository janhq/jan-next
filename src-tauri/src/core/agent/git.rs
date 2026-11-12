//! Git-backed workspace snapshots. The agent edits files in place in the
//! directory it works in; to make a run revertible we snapshot the state after
//! each turn and can restore it, Claude-Code style.
//!
//! That directory is the user's own checkout by default, and a dedicated
//! worktree when the session asked for one, which the
//! snapshots follow: the worktree isolates the files, these snapshots make the
//! turns inside it revertible. The worktree primitives below are the git side
//! of that, kept here because this module owns every `git` invocation.
//!
//! Snapshots never scan the working tree. Each checkpoint stages only the exact
//! paths the caller reports as touched this turn (`edit`/`write` tool calls);
//! the base snapshot seeds from the current `HEAD` tree plus a `git diff
//! --name-only HEAD` (tracked files only -- no untracked-file walk). This keeps
//! cost bounded by what actually changed instead of the size of the repo, which
//! matters on large trees or ones with big non-ignored build/model directories.
//! A known trade-off: changes made by other means (a `bash` tool call, an
//! external editor) are not captured unless also reported via `changed`.
//!
//! Snapshots are kept OUT of the user's branch, HEAD, and index: we stage into a
//! throwaway index file (`GIT_INDEX_FILE`) and build commit objects with
//! `commit-tree`, reachable only from a hidden `refs/jan/agent/snapshots/<id>`
//! ref. The user's `git status`, current branch, and staged changes are never
//! touched. Shelling out keeps us free of a libgit2 dependency.

use std::path::Path;
use std::process::Command;

/// A `git` command, resolved by [`jan_utils::git_program`] so Windows never
/// runs a `git.exe` from Jan's own folder.
///
/// It never talks to the user's terminal: `GIT_TERMINAL_PROMPT=0` and (unix)
/// its own session, so neither git nor anything it runs (a credential helper,
/// ssh asking to trust a host key) can open `/dev/tty`. Under the TUI such a
/// prompt would wait behind the TUI's screen, with the TUI and git both
/// reading the same keystrokes; now the command fails with git's own error.
/// For a git that may prompt, see [`git_command_on_terminal`].
pub(crate) fn git_command() -> Result<Command, String> {
    let mut cmd = git_command_on_terminal()?;
    cmd.stdin(std::process::Stdio::null())
        .env("GIT_TERMINAL_PROMPT", "0");
    #[cfg(unix)]
    tauri_plugin_agent_tools::tools::proc::detach_std_from_terminal(&mut cmd);
    Ok(cmd)
}

/// A plain `git` that shares Jan's terminal, so it can ask for credentials
/// there. Only for a caller that knows nothing else is using the terminal --
/// a plain `jan plugin install`, never the TUI.
pub(crate) fn git_command_on_terminal() -> Result<Command, String> {
    jan_utils::git_program()
        .map(Command::new)
        .map_err(|e| format!("failed to launch git: {e}"))
}

/// Run `git` with literal args (callers pass their own `-C`). Returns trimmed
/// stdout on success, trimmed stderr (or a generic message) on failure.
fn git(args: &[&str]) -> Result<String, String> {
    let out = git_command()?
        .args(args)
        .output()
        .map_err(|e| format!("failed to launch git: {e}"))?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    } else {
        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
        Err(if stderr.is_empty() {
            format!("git {} failed", args.first().copied().unwrap_or(""))
        } else {
            stderr
        })
    }
}

/// True when git tracks any file under `path` (a directory in a work tree).
/// `false` outside a repo, for an untracked or ignored directory, and when `git`
/// is not installed -- callers use it to avoid deleting files a team shares.
pub(crate) fn tracks_any(path: &Path) -> bool {
    let (Some(dir), Some(name)) = (path.parent(), path.file_name()) else {
        return false;
    };
    let dir = dir.to_string_lossy();
    let name = name.to_string_lossy();
    git(&["-C", &dir, "ls-files", "--", &name])
        .map(|out| !out.is_empty())
        .unwrap_or(false)
}

/// The current branch name for the repo containing `path`, or `None` when
/// `path` is not inside a git work tree, `git` is not installed, or `HEAD` is
/// detached (no symbolic branch). A detached `HEAD` yields the empty string
/// from `--abbrev-ref`, filtered out here.
pub(crate) fn current_branch(path: &Path) -> Option<String> {
    let p = path.to_string_lossy();
    git(&["-C", &p, "rev-parse", "--abbrev-ref", "HEAD"])
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty() && s != "HEAD")
}

/// Most lines of `git status` / diff stat a continuation state carries. A run
/// that regenerated a build tree can list thousands of paths, and the state is
/// re-sent on every request after the compaction that wrote it.
const WORKSPACE_STATUS_LINES: usize = 80;

/// `git status --short` plus `git diff --stat HEAD` for the work tree holding
/// `path`, for a compaction's Files touched: the write/edit ledger cannot see
/// what a `shell` call changed, and git can. `None` outside a work tree or
/// with no change. Long output keeps its head and says how much was cut.
pub(crate) fn workspace_status(path: &Path) -> Option<String> {
    let p = path.to_string_lossy();
    let status = git(&["-C", &p, "status", "--short", "--untracked-files=normal"]).ok()?;
    if status.trim().is_empty() {
        return None;
    }
    // No stat on an unborn HEAD: `status` already lists every path.
    let stat = git(&["-C", &p, "diff", "--stat", "HEAD"]).unwrap_or_default();
    let clip = |text: &str| {
        let lines: Vec<&str> = text.lines().collect();
        if lines.len() <= WORKSPACE_STATUS_LINES {
            return text.to_string();
        }
        format!(
            "{}\n[... {} more lines]",
            lines[..WORKSPACE_STATUS_LINES].join("\n"),
            lines.len() - WORKSPACE_STATUS_LINES
        )
    };
    let mut out = format!("Workspace `git status --short`:\n{}", clip(&status));
    if !stat.trim().is_empty() {
        out.push_str(&format!("\nDiff stat against HEAD:\n{}", clip(&stat)));
    }
    Some(out)
}

