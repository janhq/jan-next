# Cowork on DSH, plus a UI/UX pass

Status: built and verified in the running app (panel tabs, preview, approval allow/deny, plugin manager). Not yet seen live: question and plan-review cards.

## Goal

Bring upstream Jan's Cowork (janhq/jan `upstream/main`, ~40 commits, `containers/Cowork*`) into open-waifu, but with DSH doing all the agent work. Upstream builds Cowork on Jan's own TS agent runner, which we deleted. Here the app only renders what DSH streams and answers what DSH asks.

## What upstream Cowork is (summary)

- A thread can be a **task**: `metadata.mode = 'cowork'`, set once by "Continue as task", and it cannot be switched back. A task gets a working folder (an attached project, or `agent-workspace/threads/<id>`), runs tools without asking, and has extra UI.
- Composer chips: workspace pill, Plan toggle, todo `done/total`, changes `+a -d`, files count, tasks (subagents) count.
- Side rail, one panel at a time, resizable: Progress (todo), Changes (diffs), Files (attachments plus artifacts), Preview (sandboxed HTML/image/text), Tasks (subagents).
- In the transcript: artifact cards, an ask card (multi-question), and run, parked and budget notices.
- Slash commands: `/plan`, `/todo`, `/tasks`, `/clear`, `/compact`.
- Diffs, artifacts and todos are derived from tool parts. Only live run state needs a store.

## Decision: no chat/task split

Upstream needed two modes because chat and Cowork ran on different agent loops. We have one loop (DSH), so a mode switch only adds a conversion step and a one-way door. Instead:

- Every thread has a **folder**: the attached project, or by default its own `<data>/threads/<id>/workspace`.
- Every thread has an **edit policy**: `ask` (default when a project folder is attached) or `auto` (default for the private workspace). Shown as a chip and changeable at any time.
- The Cowork chips and panel appear as soon as a thread has any of todos, changes or files. A plain chat looks like a plain chat.

## DSH side

`src-tauri/src/core/dsh/cordis.yml` gains (all upstream DSH packages, no new plugin code):

|Plugin|Why|
|---|---|
|`dsh-fs-local` + `dsh-fs-observation-policy` + `dsh-tool-fs` + `dsh-tool-fs-search`|read/write/edit/find/grep scoped to the session cwd|
|`dsh-tool-todo`|`todo_write`; the `todo/write` event drives Progress|
|`dsh-plan-mode` (+ `section`)|`exit_plan_mode` plan review|
|`dsh-user-questions` + `dsh-tool-ask-user`|`ask_user_question`|
|`dsh-user-approval` (`policy: ask`)|write/edit/bash approval when the thread policy is `ask`|

`extensions/dsh-openwaifu-server/index.js` gains:

- a `cwd` param on `session/prompt` → `createSession({ meta: { cwd } })` (tool-fs and bash already resolve against the session header cwd);
- a `ctx.userQuestions` provider that sends `interaction.question { requestId, sessionId, questions, intent? }` and waits for `interaction/answer { requestId, answers }`, or for cancel;
- an `approval/request` answerer: `auto` policy approves straight away, otherwise it sends `approval.request { requestId, sessionId, toolName, input }` and waits for `approval/answer { requestId, outcome }`;
- `session/plan { sessionId, active }` and `session/policy { sessionId, policy }`.

## App side

- `dsh-protocol.ts` maps `todo/write` and `plan/mode` into `data-*` UI parts; `interaction.question` and `approval.request` become pending cards in a small store (`useDshInteractions`).
- New `web-app/src/containers/work/`: `WorkChips`, `WorkPanel` (tabs: Progress, Changes, Files, Preview), `AskCard`, `ApprovalCard`, `ArtifactCard`. Diffs come from `write`/`edit` tool results (`before`/`after`), artifacts from `write` creates.
- Thread metadata: `folder`, `editPolicy`, `planMode`.
- Slash commands in the composer: `/plan`, `/todo`, `/changes`, `/files`.
- Ported from upstream as ideas, not code: their components are tied to `useCoworkRun`/`coworkRunner`, which do not exist here.

## UI/UX pass (seen in the running app)

- The failure card dumps raw JSON (`503: {"message":"[codex/gpt-5.5] ...`). Show the provider's message in one line, the HTTP code as a small badge, and the raw text behind "Details".
- The sidebar label "New Projects" becomes "New project". The Hub, Plugin manager and Settings rows sit at the same weight as New Chat; group them below the chat list as quieter rows.
- The composer's bare `+` and slider icons need tooltips and labels; the folder chip joins that row.
- The empty state for a new thread offers 3 short starters (chat, work on a folder, plan first).
- The model picker shows `9 cc/claude-sonnet-5`; drop the stray count badge and show the provider as a muted prefix.

## Wireframe

```
┌ sidebar ─────────┬───────────────── thread ───────────────────┬─ WorkPanel (resizable, closable) ─┐
│ + New chat   ^N  │ [provider/] model ▾                          │ Progress | Changes | Files | Prev │
│ ⌕ Search     ^K  │                                              │ ───────────────────────────────── │
│                  │  user ▸ build a dashboard in this folder     │ ▓▓▓▓▓░░░ 3/5                      │
│ Chats            │                                              │ ✓ read package.json               │
│  ● Dashboard     │  ▸ Worked for 12s (4 tools)                  │ ● write dashboard.html            │
│    hi            │  ┌ Approve edit ─────────────────────────┐   │ ○ style cards                     │
│    ...           │  │ write  dashboard.html  (+84)          │   │                                   │
│                  │  │ [Approve] [Approve all in thread] [No]│   │ Changes  +84 -0                   │
│                  │  └───────────────────────────────────────┘   │  dashboard.html  +84  ▸           │
│                  │  ┌ dashboard.html ───────── Open ┐ artifact │                                   │
│ ─────────        │  └───────────────────────────────┘          │                                   │
│ Hub              │ ┌──────────────────────────────────────────┐ │                                   │
│ Plugins          │ │ Ask anything, / for commands             │ │                                   │
│ Settings         │ │ [+] [📁 my-app ▾] [Plan] [Ask edits ▾]   │ │                                   │
│                  │ │       [☑ 3/5] [± +84 -0] [📄 2]     [➤] │ │                                   │
└──────────────────┴──────────────────────────────────────────────┴───────────────────────────────────┘
States: no folder/todos/changes → chip row shows only [+] [📁 Workspace] and model; panel hidden.
Ask card replaces the composer focus while pending; answering resumes the turn.
Window < 1100px: panel overlays from the right; < 640px: bottom sheet.
```

## Plan

1. cordis.yml composition + server plugin methods (cwd, questions, approvals, plan, policy).
2. Transport/protocol: new notifications and requests, `data-todo`/`data-plan` parts, interaction store.
3. Thread metadata + folder picker + policy chip; the per-thread workspace dir in Rust.
4. WorkPanel (Progress, Changes, Files, Preview) + chips + Ask/Approval/Artifact cards + slash commands.
5. UI/UX pass items.
6. Verify in the running app: one thread in a temp folder, ask for a file, approve, see todo, diff, artifact and preview; screenshots.
