# Fix-all: sandbox, dead routes, stale tests, legacy removal, full DSH

## WHY
open-waifu now runs every chat on DeepSeek Harness (DSH). The migration left three loose ends (no shell sandbox, dead `lib/service.ts` routes, stale web tests), leftover Jan legacy code, and a base composition that switches off most of what DSH can do. The owner wants Jan desktop fully on DSH, using DSH's full capability set.

## Original checklist (verbatim order)
1. Sandbox: removing tauri-plugin-agent-tools removed its Windows sandbox, and no DSH sandbox plugin replaces it yet in the base cordis.yml. Shell tools in chats currently run with no sandbox.
2. Dead routes: about 18 routes in lib/service.ts have no Rust command behind them and would fail if called (getTools, callTool, copyFile, ...).
3. Old test expectations: the web tests still need updating.
4. Remove legacy old code that is no longer needed or no longer makes sense.
5. Fully DSH inside Jan desktop, with the full power / potential of DSH.

## Expected state/behavior
1. Shell commands from a chat run through DSH's sandbox (`dsh-sandbox-local` + `dsh-sandbox-policy`, Windows ACL restricted token via `dsh-pwsh-sandbox`; `dsh-bash-sandbox` on macOS). Writes inside the thread workspace succeed; a write outside it is denied and the model sees the denial. File tools use `dsh-fs-sandbox` under the same policy.
2. `lib/service.ts` lists only routes with a Rust command; the wrappers that called dead routes are gone, no caller breaks.
3. `yarn test` (core + web) passes.
4. Code that only served Jan's removed extension/agent/MCP stack is deleted (dead wrappers, legacy test globals, stale shims), with no remaining caller.
5. The base composition mounts DSH's agent capabilities the app had switched off: workspace instructions (AGENTS.md), skills, background jobs, subagent fork/control, goals, workflows, spill/timeout/pruner policies, time context. A chat can use them.

## Verification matrix
|#|Original item|Real-user scenario|Expected observation|Result|Evidence|
|---|---|---|---|---|---|
|1|Sandbox|In the app, chat asks the model to write a file inside the thread workspace and one outside it via the shell tool|inside: file exists; outside: denied, no file|pass|cx/gpt-5.6-luna chat: `inside-probe.txt` = `inside-ok` in the thread workspace; outside write returned `Access ... denied [sandbox: file access denied under workspace-write mode] [exit code: 1]`, no file on disk; screenshot `fa-10-sandbox.png`|
|2|Dead routes|Grep route table vs `generate_handler!`; app boots, chats, model hub list loads|no unmatched route; app works|pass|17 routes removed; app boots, chats and model picker work in the dev build|
|3|Old test expectations|`corepack yarn test`|all pass|pass|tsc exit 0; test:core 7 files / 8 tests; test:web 225 files / 2817 tests, all passed|
|4|Legacy removal|Type check + app boot + chat after deletions|no reference to removed code; app works|pass|tsc clean; app boot + two chats after deletions; eslint on changed files reports the same 26 pre-existing errors as HEAD|
|5|Full DSH|In the app, `plugins/list` shows the new rows active; chat uses skill/subagent/todo tools|rows `active`, tool calls render|pass|Plugin manager shows pwsh-sandbox, sandbox-policy, fs-sandbox, subagent fork/control, workflow, ralph, spill, timeout, pruner, repeat reminder, time-context as Running; chat called `skill`, `subagent` (answer 42) and `todo_write`, todo badge 2/2; screenshot `fa-11-dsh-tools.png`|

## Current task
Done.

## Completed work
- Recon: reference composition is DSH `packages/bundle/base/cordis.patch.yml`. `dsh-pwsh-sandbox` loads by `{{DSH_PACKAGES}}` path (plugins.rs `base_text`). pwsh 7 is not installed; pwsh-local falls back to Windows PowerShell 5.1.
- Item 1 + 5 composition: cordis.yml rewritten (sandbox, pwsh/bash sandbox, fs-sandbox, spine with skills/jobs/goals/workspaceContext maxBytes 65536, subagent fork/control/report, workflow, ralph, spill/timeout/pruner/repeat reminder, time-context). Standalone boot: 42 rows, all active. Server gates `pwsh`; UI renders `pwsh` as terminal. cargo check passes.
- Item 2: 17 dead routes removed from service.ts, native/core.ts, native/fs.ts, core api enums, setup.ts mock.

## Next action
None.

## Blockers
None.
