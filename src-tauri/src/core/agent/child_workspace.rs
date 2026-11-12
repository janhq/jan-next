//! Where a dispatched subagent works: its own checkout, or the parent's
//! checkout, read-only unless it is a writer.
//!
//! Decided by the harness when the child is dispatched, never by a tool the
//! model calls. A child whose tool set can change files (`write`/`edit`) is a
//! *writer*. With subagent worktrees on (`--subagent-worktrees`,
//! `[agent].subagent_worktrees`; off by default) it gets a fresh checkout on
//! `jan/agent/<name>-<id>`, so parallel writers never edit one checkout and
//! none of them mixes its edits with the user's uncommitted work; off, it
//! shares the parent's checkout and concurrent writers are not serialized.
//! Every other child is a *reader*: it runs in the
//! checkout it was given with that checkout read-only, enforced by the file
//! tools and by a sandbox that is always on for it.
//!
//! A child's checkout (a "worktree" to the user) is a repository of its own,
//! made by `git clone --shared`: it borrows the user's objects read-only and
//! keeps its refs, index, config and hooks to itself, so a sandboxed child
//! never writes the user's `.git` (which git reads, unsandboxed, the next time
//! the user works). Its branch comes back as `jan/agent/<name>-<id>` in the
//! user's repository when the child finishes, by a fetch that runs none of
//! the child's config (see [`Checkout`](crate::core::agent::git::Checkout)).
//!
//! A dispatch item's optional `workspace` overrides the default: `"new"`, a
//! fresh checkout; `"shared"`, the parent's checkout; the name of an earlier
//! subagent, that subagent's workspace; `{"ref": "<git ref>"}`, a fresh
//! checkout at that ref (fetched from `origin` when it is not local).
//!
//! Checkouts live under `~/.jan/worktrees/<project-slug>/`, never under `/tmp`
//! (the sandbox gives the shell a private, throwaway `/tmp`). The ledger here
//! remembers every child's workspace for the session, so a later dispatch can
//! name it, and at the session's end removes the checkouts that hold nothing:
//! no commit past their base and no uncommitted change, `ref` ones included
//! (a writer may have committed there). One git cannot read is kept. A
//! conversation ending (`/new`, `/clear`, `/resume`) does the same for its
//! own worktrees.
//!
//! Beside the checkouts, out of every child's reach, `.meta/<id>.json` records
//! what Jan made and `.meta/<id>.lock` is held by the process that owns it, so
//! a startup sweep can settle what a crashed session left without touching a
//! live one's. Removed checkouts are renamed into `.trash`, which that sweep
//! empties, so nobody waits on deleting them.
//!
//! The desktop never holds readers to a read-only checkout: every child works
//! in its parent's checkout as it always has (see [`READ_ONLY_READERS`]).

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

/// The `workspace` a dispatch item asked for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WorkspaceRequest {
    /// A fresh worktree from the parent checkout's `HEAD`.
    New,
    /// The parent's own checkout.
    Shared,
    /// The workspace of an earlier subagent of this session, by name.
    Reuse(String),
    /// A fresh worktree at a git ref.
    Ref(String),
}

/// Whether a child with this final tool allowlist can change files. `None`
/// is the parent's whole toolset, which writes unless the parent denies both.
pub(crate) fn is_writer(
    allowed_tools: Option<&[String]>,
    permissions: &tauri_plugin_agent_tools::permissions::ToolPermissions,
) -> bool {
    ["write", "edit"].iter().any(|tool| {
        !permissions.is_denied(tool)
            && allowed_tools.is_none_or(|tools| tools.iter().any(|t| t == tool))
    })
}

/// A checkout the ledger created.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ChildWorktree {
    /// The checkout's top level.
    pub(crate) path: PathBuf,
    pub(crate) branch: String,
    /// The commit it was branched from.
    pub(crate) base: String,
    /// The `{"ref": ...}` it was made for, if any.
    pub(crate) from_ref: Option<String>,
    /// The main checkout's top level, which its branch is fetched back into.
    repo: PathBuf,
    /// The user's object directory it borrows, as recorded when it was made:
    /// its own alternates file is the child's to rewrite.
    objects: PathBuf,
}

/// Where one child works.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ChildWorkspace {
    /// The child's `project_root`.
    pub(crate) root: PathBuf,
    /// Whether the child may change `root` (a reader may not).
    pub(crate) read_only: bool,
    /// The worktree `root` is in, when it is not the parent's checkout.
    pub(crate) worktree: Option<ChildWorktree>,
    /// Why a worktree that was wanted could not be made.
    pub(crate) fallback: Option<String>,
    /// Whether the parent's checkout had uncommitted changes the new worktree
    /// does not carry.
    pub(crate) left_changes: bool,
    /// The parent's subdirectory of the repository when the worktree lacks
    /// it (untracked, ignored, or absent at the ref), so `root` is the
    /// worktree's top level instead.
    pub(crate) missing_subdir: Option<String>,
    /// Whether the `assign` that returned this made `worktree` for it, rather
    /// than handing out an earlier child's: only then may [`Ledger::undo`]
    /// remove it.
    fresh: bool,
}

impl ChildWorkspace {
    /// The parent's checkout, as is.
    fn shared(root: &Path, read_only: bool) -> Self {
        Self {
            root: root.to_path_buf(),
            read_only,
            worktree: None,
            fallback: None,
            left_changes: false,
            missing_subdir: None,
            fresh: false,
        }
    }

    /// The line the dispatch result carries for this child.
    pub(crate) fn note(&self) -> String {
        let fallback = self
            .fallback
            .as_deref()
            .map(|why| format!(" ({why}, so it uses your checkout)"))
            .unwrap_or_default();
        match (&self.worktree, self.read_only) {
            (Some(wt), read_only) => {
                let mode = if read_only { "read-only " } else { "" };
                let from = match &wt.from_ref {
                    Some(r) => format!("{r} at {}", short(&wt.base)),
                    None => short(&wt.base).to_string(),
                };
                let left = if self.left_changes {
                    "; uncommitted changes in your checkout are not in it"
                } else {
                    ""
                };
                let subdir = match &self.missing_subdir {
                    Some(rel) => format!(
                        "; your directory {rel} is not in this checkout, so it starts at the \
                         top level"
                    ),
                    None => String::new(),
                };
                format!(
                    "working in {mode}worktree {} (branch {}, from {from}){left}{subdir}",
                    display(&self.root),
                    wt.branch
                )
            }
            (None, true) => format!("working read-only in {}{fallback}", display(&self.root)),
            (None, false) => format!("working in your checkout {}{fallback}", display(&self.root)),
        }
    }

    /// The short form a `SubagentStart` event and the TUI show.
    pub(crate) fn label(&self) -> String {
        let mode = if self.read_only { "read-only " } else { "" };
        match &self.worktree {
            Some(wt) => format!("{mode}{} ({})", display(&self.root), wt.branch),
            None => format!("{mode}{}", display(&self.root)),
        }
    }

    /// Bring a writer's branch from its checkout into the user's repository,
    /// where the parent merges it. `Some(why)` when it could not be. Runs git.
    pub(crate) fn bring_back(&self) -> Option<String> {
        let wt = self.worktree.as_ref().filter(|_| !self.read_only)?;
        bring_back(wt).err()
    }

    /// The line appended to the child's answer, so the parent reading it later
    /// knows which branch to merge, or why that branch is not in the user's
    /// repository (`problem`, from [`Self::bring_back`]).
    pub(crate) fn answer_footer(&self, problem: Option<&str>) -> Option<String> {
        let wt = self.worktree.as_ref().filter(|_| !self.read_only)?;
        let path = display(&wt.path);
        Some(match problem {
            None => format!("[worked in {path} on branch {}]", wt.branch),
            Some(why) => format!(
                "[worked in {path} on branch {}, which is only there: it could not be brought \
                 into your repository ({why})]",
                wt.branch
            ),
        })
    }
}

fn short(sha: &str) -> &str {
    &sha[..sha.len().min(9)]
}

fn display(path: &Path) -> String {
    let shown = match crate::core::agent::project::jan_home()
        .and_then(|home| home.parent().map(Path::to_path_buf))
    {
        Some(home) if !home.as_os_str().is_empty() => match path.strip_prefix(&home) {
            Ok(rest) => format!("~/{}", rest.display()),
            Err(_) => path.display().to_string(),
        },
        _ => path.display().to_string(),
    };
    shown.replace('\\', "/")
}

/// What a child's run is held to beyond its `project_root`: whether that root
/// is read-only, the extra directories its sandboxed shell may write, and the
/// environment its shell gets. `None` on a top-level run.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct ChildScope {
    pub(crate) read_only: bool,
    /// Directories its tools may read besides its workspace and write roots:
    /// the user's objects its checkout borrows.
    pub(crate) read_roots: Vec<PathBuf>,
    pub(crate) write_roots: Vec<PathBuf>,
    pub(crate) env_set: Vec<(String, String)>,
}

/// `~/.jan/worktrees/<slug>` for the repository `root` belongs to: its
/// subagents' worktrees and their shared build directory. Keyed on the main
/// checkout's top level, so a session running in a Jan worktree or in any
/// subdirectory finds the same one, and so the slug is the one `project_key`
/// checks a clone's alternates (which name that top level) against.
pub(crate) fn project_worktrees_dir(root: &Path) -> Option<PathBuf> {
    let key = tauri_plugin_agent_tools::workspace::project_key(root);
    let top = key.ancestors().find(|dir| dir.join(".git").exists()).unwrap_or(&key);
    Some(
        crate::core::agent::project::jan_home()?
            .join("worktrees")
            .join(tauri_plugin_agent_tools::workspace::path_slug(top)),
    )
}

/// The one `CARGO_TARGET_DIR` every child of the project builds into, so a
/// fresh worktree does not start with a cold Rust build.
const CARGO_TARGET: &str = "cargo-target";

/// The scope a child in `ws` runs under: the shared build directory for any
/// child outside the plain writable checkout. A writer is granted nothing of
/// the user's `.git`: its commits go to its own, inside its workspace.
/// Package caches need nothing here: a sandboxed child, reader or not, gets
/// the project's package cache like any run (its checkout keys to the same
/// project), which is how a reader that cannot write its checkout still
/// installs.
pub(crate) fn scope_for(ws: &ChildWorkspace, parent_root: &Path) -> ChildScope {
    let mut scope = ChildScope {
        read_only: ws.read_only,
        ..ChildScope::default()
    };
    if builds_in_cache(ws) {
        if let Some(target) = project_worktrees_dir(parent_root).map(|d| d.join(CARGO_TARGET)) {
            if std::fs::create_dir_all(&target).is_ok() {
                scope.env_set.push((
                    "CARGO_TARGET_DIR".to_string(),
                    target.to_string_lossy().into_owned(),
                ));
                scope.write_roots.push(target);
            }
        }
    }
    if let Some(wt) = &ws.worktree {
        scope.read_roots.push(wt.objects.clone());
    }
    scope
}

/// Whether a child in `ws` is given the shared build directory: any child
/// outside the plain writable checkout, readers in the parent's own checkout
/// included.
fn builds_in_cache(ws: &ChildWorkspace) -> bool {
    ws.worktree.is_some() || ws.read_only
}

/// What a child's args take from its workspace beyond `project_root`, read
/// from git by [`place`] when the child is dispatched.
#[derive(Debug)]
pub(crate) struct Placement {
    /// The child's own Session Start, when it is not in the parent's checkout.
    session_start: Option<crate::core::agent::context::SessionStart>,
    scope: ChildScope,
    /// The child's shared lock on the build directory (see
    /// [`hold_build_cache`]), which the child keeps until it is done.
    build_hold: Option<std::fs::File>,
}

/// Resolve the [`Placement`] of a child in `ws`: its checkout's branch and the
/// scope its tools enforce. Runs git, so the dispatch calls it on
/// the blocking pool and [`apply`], on the async child task, runs none. The
/// build lock is taken before the scope creates the build directory, so a
/// trim never moves it away between the two.
pub(crate) fn place(ws: &ChildWorkspace, parent_root: &Path) -> Placement {
    let build_hold = builds_in_cache(ws).then(|| hold_build_cache(parent_root)).flatten();
    Placement {
        session_start: ws.worktree.as_ref().map(|wt| {
            crate::core::agent::context::SessionStart::with_branch(worktree_branch(wt))
        }),
        scope: scope_for(ws, parent_root),
        build_hold,
    }
}

/// Point a child's run at its workspace: `project_root` (and so its prompt's
/// Working Directory and Runtime Environment blocks), its own Session Start
/// when it is not in the parent's checkout, and the scope its tools enforce.
/// Returns the child's build lock, which the caller holds until the child
/// has finished: dropping it lets a trim move the build directory away.
pub(crate) fn apply(
    args: &mut crate::core::agent::r#loop::OrchestrationArgs,
    ws: &ChildWorkspace,
    placement: Placement,
) -> Option<std::fs::File> {
    if let Some(start) = placement.session_start {
        args.session_start = Some(start);
    }
    args.project_root = Some(ws.root.clone());
    args.child_scope = Some(placement.scope);
    placement.build_hold
}

/// The desktop gives no child the shared build directory.
fn hold_build_cache(_root: &Path) -> Option<std::fs::File> {
    None
}

/// Whether a reader's checkout is read-only. Off: the desktop's Windows
/// sandbox (AppContainer) has no read-only workspace, so enforcing one there
/// would take the shell away from every reader child instead.
const READ_ONLY_READERS: bool = false;

#[derive(Debug, Default)]
struct LedgerState {
    /// Every child's workspace, by worker name, for `workspace: "<name>"`.
    by_name: HashMap<String, ChildWorkspace>,
    /// Worktrees with a writer in them right now.
    busy: HashSet<PathBuf>,
    /// Worktrees a sweep or undo is checking for removal right now, which no
    /// dispatch may be given: they may be gone before its child starts.
    removing: HashSet<PathBuf>,
    /// Worktrees this session created, in creation order.
    created: Vec<ChildWorktree>,
    /// The lock on each of `created`'s metadata, held so no other jan
    /// process's startup sweep takes a worktree this one still owns.
    holds: HashMap<PathBuf, std::fs::File>,
}

/// The session's record of its children's workspaces.
#[derive(Debug, Default)]
pub(crate) struct Ledger {
    state: Mutex<LedgerState>,
}

/// A writer's hold on its worktree, released when the child is done (it
/// finished, failed, was stopped or was torn down), before the child counts
/// as finished.
#[derive(Debug)]
pub(crate) struct WriterLease {
    ledger: Arc<Ledger>,
    path: PathBuf,
}

impl Drop for WriterLease {
    fn drop(&mut self) {
        self.ledger.state.lock().unwrap().busy.remove(&self.path);
    }
}

impl Ledger {
    /// Assign `name` its workspace and record it. A writer in a worktree gets
    /// the lease that keeps a second writer out until it is done: a second
    /// writer naming a busy worktree is refused, not queued. `worktrees` is
    /// whether a writer with no `request` gets a worktree of its own; without
    /// it, it shares the parent's checkout. A request is honored either way.
    pub(crate) fn assign(
        self: &Arc<Self>,
        parent_root: &Path,
        name: &str,
        writer: bool,
        request: Option<&WorkspaceRequest>,
        worktrees: bool,
    ) -> Result<(ChildWorkspace, Option<WriterLease>), String> {
        let read_only = !writer && READ_ONLY_READERS;
        let (ws, hold) = match request {
            Some(WorkspaceRequest::Shared) => {
                (ChildWorkspace::shared(parent_root, read_only), None)
            }
            Some(WorkspaceRequest::Reuse(earlier)) => {
                let found = self.state.lock().unwrap().by_name.get(earlier).cloned();
                let mut ws = found.ok_or_else(|| {
                    format!(
                        "workspace '{earlier}' names no earlier subagent of this session; use \
                         \"new\", \"shared\", or the name of a subagent that has already been \
                         dispatched"
                    )
                })?;
                ws.read_only = read_only;
                ws.left_changes = false;
                ws.fresh = false;
                (ws, None)
            }
            Some(WorkspaceRequest::New) => create(parent_root, name, None, read_only)?,
            Some(WorkspaceRequest::Ref(r)) => create(parent_root, name, Some(r), read_only)?,
            None if writer && worktrees => create(parent_root, name, None, read_only)?,
            None => (ChildWorkspace::shared(parent_root, read_only), None),
        };
        let mut state = self.state.lock().unwrap();
        // A reuse was looked up under an earlier hold of the lock: a sweep may
        // have removed that worktree since (dropping it from `created`). Only
        // a worktree the ledger still records, and that is still on disk, is
        // handed out; never a path git has already deleted.
        if let (Some(WorkspaceRequest::Reuse(earlier)), Some(wt)) = (request, ws.worktree.as_ref()) {
            let recorded = state.created.iter().any(|c| c.path == wt.path);
            if !recorded || !wt.path.is_dir() {
                return Err(format!(
                    "refused: the worktree of '{earlier}' ({}) was removed, as it held no \
                     work. This subagent was not started. Give it workspace \"new\" instead",
                    display(&wt.path)
                ));
            }
        }
        if let Some(wt) = ws.worktree.as_ref().filter(|wt| state.removing.contains(&wt.path)) {
            return Err(format!(
                "refused: {} (branch {}) is being removed, as it held no work. This \
                 subagent was not started. Give it workspace \"new\" instead",
                display(&wt.path),
                wt.branch
            ));
        }
        let lease = match ws.worktree.as_ref().filter(|_| writer) {
            Some(wt) => {
                if !state.busy.insert(wt.path.clone()) {
                    return Err(format!(
                        "refused: another subagent is still writing in {} (branch {}), and \
                         only one writer may work in a worktree at a time. This subagent was \
                         not started. Dispatch it again once that one has finished, or give \
                         it workspace \"new\"",
                        display(&wt.path),
                        wt.branch
                    ));
                }
                Some(WriterLease {
                    ledger: self.clone(),
                    path: wt.path.clone(),
                })
            }
            None => None,
        };
        if let Some(wt) = &ws.worktree {
            if !state.created.iter().any(|c| c.path == wt.path) {
                state.created.push(wt.clone());
            }
            if let Some(hold) = hold {
                state.holds.insert(wt.path.clone(), hold);
            }
        }
        state.by_name.insert(name.to_string(), ws.clone());
        Ok((ws, lease))
    }

    /// Take back the assignment `ws` that `name`'s dispatch got and never
    /// used (the run was torn down before the child could start): forget the
    /// name, and remove the worktree only when that `assign` made it and it
    /// holds nothing. Everything else the session made stays, since a later
    /// dispatch may still name it. Call after the dispatch's lease is gone.
    pub(crate) fn undo(&self, name: &str, ws: &ChildWorkspace) {
        // Only while the name is still this dispatch's: an undo arriving after
        // the conversation ended must not drop the next one's same name.
        let mut state = self.state.lock().unwrap();
        if state.by_name.get(name) == Some(ws) {
            state.by_name.remove(name);
        }
        drop(state);
        if let Some(wt) = ws.worktree.as_ref().filter(|_| ws.fresh) {
            self.remove_unless_busy(wt);
        }
    }

    /// Mark `path` as being removed, unless a writer is in it or it already
    /// is. While marked, `assign` hands it to nobody, so the git that decides
    /// and does the removal runs without the ledger's lock: a lease dropping
    /// meanwhile never waits on it.
    fn claim(&self, path: &Path) -> bool {
        let mut state = self.state.lock().unwrap();
        !state.busy.contains(path) && state.removing.insert(path.to_path_buf())
    }

    /// Remove `wt` when no writer is in it and it holds nothing, forgetting it
    /// and every name that pointed at it. Returns whether it went.
    fn remove_unless_busy(&self, wt: &ChildWorktree) -> bool {
        if !self.claim(&wt.path) {
            return false;
        }
        let gone = remove_if_empty(wt);
        if gone {
            forget_meta(wt);
        }
        self.release(&wt.path, gone);
        gone
    }

    /// End a [`Self::claim`] of `path`; when it is `gone`, forget it and
    /// every name that pointed at it, dropping its lock.
    fn release(&self, path: &Path, gone: bool) {
        let mut state = self.state.lock().unwrap();
        state.removing.remove(path);
        if gone {
            state.holds.remove(path);
            state.created.retain(|c| c.path != path);
            state
                .by_name
                .retain(|_, ws| ws.worktree.as_ref().is_none_or(|w| w.path != path));
        }
    }
}

/// Where Jan keeps what it knows of each checkout of a project: beside the
/// checkouts, out of every child's write roots (a child can rewrite anything
/// in its own checkout, so nothing there may say what to fetch from).
const META_DIR: &str = ".meta";

/// `<id>.<ext>` in the metadata directory of the checkouts in `dir`.
fn meta_file(dir: &Path, id: &str, ext: &str) -> PathBuf {
    dir.join(META_DIR).join(format!("{id}.{ext}"))
}

/// Beside a lock file its owner could not lock: the checkout is never a
/// sweep's to decide (see [`reserve`]).
const UNLOCKED_EXT: &str = "unlocked";

/// Drop what was recorded of `wt` once it is gone: the record, then its
/// lock, which only the holder of that lock may unlink (a new owner never
/// reopens an existing lock file, see [`reserve`]).
fn forget_meta(wt: &ChildWorktree) {
    let (Some(dir), Some(id)) = (wt.path.parent(), wt.path.file_name()) else { return };
    forget_meta_at(dir, &id.to_string_lossy());
}

/// [`forget_meta`] by checkout id, for a checkout with no usable record.
fn forget_meta_at(dir: &Path, id: &str) {
    let _ = std::fs::remove_file(meta_file(dir, id, "json"));
    let _ = std::fs::remove_file(meta_file(dir, id, UNLOCKED_EXT));
    let _ = std::fs::remove_file(meta_file(dir, id, "lock"));
}

/// The desktop makes no checkouts, so there is never a branch to bring back.
fn bring_back(_wt: &ChildWorktree) -> Result<(), String> {
    Ok(())
}

/// The desktop makes no worktrees.
fn worktree_branch(_wt: &ChildWorktree) -> Option<String> {
    None
}

/// The desktop makes no worktrees, so there is never one to remove.
fn remove_if_empty(_wt: &ChildWorktree) -> bool {
    false
}

/// The desktop has no subagent worktrees: a child keeps its parent's
/// workspace, as before.
fn create(
    parent_root: &Path,
    _name: &str,
    _git_ref: Option<&str>,
    read_only: bool,
) -> Result<(ChildWorkspace, Option<std::fs::File>), String> {
    let ws = ChildWorkspace {
        fallback: Some("subagent worktrees are CLI-only".to_string()),
        ..ChildWorkspace::shared(parent_root, read_only)
    };
    Ok((ws, None))
}

#[cfg(test)]
mod tests {
    use super::*;


    /// The desktop has no read-only children: a reader there works in its
    /// parent's checkout with nothing added to its tools, exactly as before
    /// subagent workspaces (AppContainer has no read-only workspace, so
    /// enforcing one would take the shell away from every reader on Windows).
    #[test]
    fn a_desktop_reader_child_is_held_to_nothing_new() {
        let root = std::env::temp_dir().join(format!("jan_child_ws_desk_{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let ledger = Arc::new(Ledger::default());
        let (ws, lease) = ledger.assign(&root, "explore", false, None, true).unwrap();
        assert!(lease.is_none());
        assert!(!ws.read_only, "{ws:?}");
        assert_eq!(scope_for(&ws, &root), ChildScope::default());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_writer_is_a_child_that_can_write_or_edit() {
        use tauri_plugin_agent_tools::permissions::ToolPermissions;
        let all = ToolPermissions::allow_all();
        let names = |t: &[&str]| t.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert!(is_writer(None, &all));
        assert!(is_writer(Some(&names(&["read", "edit"])), &all));
        assert!(!is_writer(Some(&names(&["read", "ls", "shell"])), &all));
        let denied = ToolPermissions::new(
            tauri_plugin_agent_tools::permissions::PermissionDefault::Allow,
            &[],
            &names(&["write", "edit"]),
            &[],
        );
        assert!(!is_writer(None, &denied));
    }
}

