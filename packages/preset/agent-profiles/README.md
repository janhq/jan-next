---
description: "Named agents with their own instructions, model and tool limits, read from Jan, .agents, Claude Code, opencode and Codex agent folders."
kind: "package-reference"
---

# @janhq/jan-agent-profiles

## Summary

An agent profile is a named agent: a description, instructions, an optional model and effort, and tool limits. A profile is global or belongs to one project. A chat can run as one profile, the subagent tool can start a delegated task as one, and each bot points at one. A mode (agent preset) stays a separate choice: a profile never sets a mode.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

The web-app bundle mounts it before scoped settings:

```yaml
- id: agent-profiles
  name: '@janhq/jan-agent-profiles'
```

Config: `janHome`, `agentsHome` and `userHome` override the resolved homes; `debounceMs` (default 200) is the quiet period after file events; `maxFileBytes` (default 65536) is the largest file read. The service requires `workspaceRegistry`, `sessionProjections`, `agents` and `systemPrompt`, and reads the optional `sessionController` and `llm`.

Profiles are read from these folders, highest precedence first. When two files share an id, the higher one wins and the other is listed with `shadowedBy`.

| Source | Project folder | Global folder | Format | Writable |
|---|---|---|---|---|
| Jan | `<project>/.jan/agents` | `$JAN_HOME/agents` | Markdown | yes |
| `.agents` | `<project>/.agents/agents` | `~/.agents/agents` | Markdown | no |
| Claude Code | `<project>/.claude/agents` | `~/.claude/agents` | Markdown | no |
| opencode | `<project>/.opencode/agents` | `~/.config/opencode/agents` | Markdown | no |
| Codex | `<project>/.codex/agents` | `~/.codex/agents` | TOML | no |
| Built-in | - | this package's `agents/` | Markdown | no |

Every project folder outranks every global folder, and built-in profiles rank last, so any user file with the same id replaces one; deleting that file brings the built-in back. Discovery skips dot-prefixed entries and descends up to eight directories below a root. It reads only regular files, without following individual file symlinks. Unreadable files, files larger than `maxFileBytes`, and files that do not parse or lack a usable id appear under `problems`. A Claude or Codex file is named by its `name`; an opencode file by its path below the folder without the extension (`team/reviewer`); a Jan, `.agents` or built-in file by `name`, else its file name. Ids match `^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$`, with at most eight folder segments and no empty or dot-prefixed segments.

Jan ships eight built-in profiles. They inherit the chat's model, so they work with any provider. Settings offers **Copy to Jan** to customize one.

`sandbox` (Jan, `.agents` and built-in files; Codex `sandbox_mode`) caps the permission of a delegated task running the profile: `read-only`, `workspace-write` or `danger-full-access`. It is a cap, never a grant: the task keeps the narrower of the cap and the starting chat's permission. Claude and opencode files have no equivalent and inherit.

| Id | Available for | Permission as a subagent | Does |
|---|---|---|---|
| `reviewer` | chats and subagents | read-only, no file-edit tools | Reviews a diff for bugs, security and contract breaks; reports verified findings by severity with `path:line` and a fix. |
| `researcher` | chats and subagents | read-only, no file-edit tools | Answers from primary, dated sources with inline citations, cross-checks key claims, and separates fact from inference. |
| `explorer` | subagents | read-only, no file-edit tools | Maps unfamiliar code quickly and returns a compact briefing: key files with line ranges, the call flow, and conventions. |
| `planner` | chats and subagents | read-only, no file-edit tools | Turns a goal into ordered, code-grounded steps with the chosen approach, risks and verification. |
| `worker` | chats and subagents | workspace write | Implements a scoped change end to end, migrates every caller, runs the checks, and reports files and verification. |
| `debugger` | chats and subagents | workspace write | Reproduces, tests one hypothesis at a time, fixes the root cause, and proves the fix with a regression test. |
| `tester` | chats and subagents | workspace write | Writes deterministic behaviour tests in the project's own framework, runs them, and reports bugs rather than bending code. |
| `writer` | chats and subagents | workspace write | Drafts and edits prose for a named reader: main point first, plain words, no invented facts. |

A chat keeps the profile text it first read: editing the file reaches a running chat only when the profile is picked again or the chat is reopened, so a hot edit never rewrites that chat's system prompt or tools and its cached prompt prefix stays reusable.

Field mapping. Keys and values Jan cannot use are kept as `warnings` on the profile; the profile still loads.

- `description` and the Markdown body (Codex: `developer_instructions`) become the description and instructions.
- `mode` (Jan, `.agents`, opencode): `primary`, `subagent` or `all` (default).
- `model`: `inherit` or absent means none; `provider/model#effort` is an exact route; a bare id or a Claude alias (`sonnet`, `opus`, `haiku`, `fable`) is resolved against the model catalog when the profile is selected. `effort` (Claude, Jan) and Codex `model_reasoning_effort` set the effort.
- `tools` (allowlist) and `disallowedTools` accept a comma list or a YAML list. Claude names map to Jan names: `Read` -> `read`, `Write` -> `write`, `Edit`/`MultiEdit` -> `edit` and `apply_patch`, `Bash` -> `bash`, `Grep`, `Glob`, `WebFetch` -> `web_fetch`, `WebSearch` -> `web_search`, `TodoWrite` -> `todo_write`, `Agent`/`Task` -> `subagent`, `mcp__<server>` -> `mcp:<server>`. Jan names and `mcp:<server>` pass through. Patterns such as `Bash(git *)` and single MCP tools are dropped. An allowlist that maps to nothing is dropped, so every tool stays available.
- Jan files use Claude tool spellings where they preserve the selected set. In a Jan file, `Edit` covers both edit tools, while lowercase `edit` and `apply_patch` name them individually.
- opencode `tools` switches set to `false`, `permission` entries set to `deny`, and `permissions` rules whose last whole-resource (`*`) effect for an action is `deny` become `disallowedTools`.
- Codex `[features] shell_tool = false` denies `bash`.

Remote methods (`ctx.remote.agentProfiles`):

- `list({ workspaceId? })` returns `{ profiles, problems }`: project profiles first, then global ones. Without a project, only global profiles.
- `get({ id, workspaceId?, path? })` returns one profile with its instructions: the precedence winner, or the listed file at `path`. Throws `agent-profiles/not-found`.
- `save({ scope, workspaceId?, profile, path? })` writes `<id>.md` into the scope's Jan folder (mode `0644`, meant to be committed), replacing a Jan file with that id. With `path`, only the Jan file at that exact path holding the same id is replaced, so a duplicate id in one folder edits the row the user picked. Throws `agent-profiles/invalid` if the file would exceed `maxFileBytes` or a symlink below the configured project or Jan home redirects its folder, and `agent-profiles/not-found` for a `path` with no matching file.
- `deleteProfile({ scope, workspaceId?, id, path? })` deletes a Jan file; `path` picks the exact file as for `save`, with the same symlink check. A profile that only exists in another tool's folder throws `agent-profiles/read-only`. (`remove` is reserved by the client remote namespace.)
- `select({ sessionId, id, keepModel? })` records the chat's profile, or `null` for plain Jan, at a turn boundary (`agent-profiles/locked` during a turn), then switches the chat to the profile's model unless `keepModel`. A model that does not resolve leaves the chat's model and adds `model "<x>" is not available` to the profile's warnings. A `subagent`-only profile throws `agent-profiles/invalid`.

Host callers also use `snapshot(workspaceId?)` (the last read, synchronously), `profileForSession(session)`, `projectOf(agent)`, `selectedProfile(agent)`, `toolLimitsFor(agent)`, `toolRestrictionOf(profile)` and `resolveModel(model)`. `agent-profiles/changed` is emitted after a file change in any folder, a write, and a chat's selection change.

In a chat, use the agent chip beside the mode picker. It lists project agents first, then global agents, and keeps the selected agent with the chat. A choice made before the chat exists is sent when the draft opens; **Jan (no agent)** overrides the project default. **Manage agents…** opens **Settings > Agents**, where you can create, edit, delete, or reveal Jan files and copy files from other tools into the matching Jan folder.

Type `/agent ` in an open chat to see **Jan (no agent)** and the usable profiles from its project and the global folders. Tab fills the choice; Enter selects it for the chat. Enter on bare `/agent` opens the agent picker.

A Jan file uses Claude-compatible keys plus `mode`, so Claude Code reads it too:

```md
---
name: reviewer
description: Reviews changes without editing
mode: all
model: tokamak/anthropic/claude-sonnet-5-5#high
tools: Read, Grep, Glob
disallowedTools: Bash
---
Instructions.
```

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals - click to expand</summary>

The [parser](src/parse.ts) is pure: it turns one file's text into a profile or a problem, and renders a Jan file. [Roots](src/roots.ts) lists the ten folders, reads one folder, and watches it with chokidar. A missing folder is watched through its nearest existing parent, one level deep, and the watch moves down as folders appear; each watch triggers one re-read when it becomes ready, so changes made while it starts are not lost.

The [service](src/index.ts) keeps the last read of every folder in memory for synchronous readers (the prompt section, tool limits, the subagent list). `list`, `get`, `save` and `deleteProfile` read their folders again first. Project folders are tracked for every registered project and refreshed after file events and agent creation. Selections are serialized per chat and logged as `agent-profile/selected`; the [projection](src/session.ts) `agentProfile` restores them on replay, resume and fork.

Selection resolves the profile and verifies its model before committing either selection. If a turn opens during preparation and is still open at commit time, the request leaves the current profile and model unchanged.

</details>

<a id="further-exploration"></a>
## Further Exploration

- [Scoped settings](../../settings/scoped-settings/README.md) - applies profile tool limits and stores each project's default agent.
- [Subagent tool](../../subagent/tool-subagent/README.md) - starts delegated tasks as a profile.
- [Agent preset registry](../agent-preset-registry/README.md) - modes, which stay independent of profiles.

<a id="model-experience"></a>
## Model Experience

### Selected agent profile

#### What the model sees

When a chat selected a profile, the system prompt gains the section `agent-profile` (order 10200) after Jan's own sections. The id, description and instructions are read from the profile file at each request.

##### Verbatim text for this field, when needed

```markdown
Agent: <id>

<description>

<instructions>
```

#### Token effect

Adds the section's text to every request of that chat; empty descriptions and instructions are left out. Plain Jan chats add nothing.

#### KV Cache effect

Selecting, clearing or editing the profile changes the system prompt, so the next request of that chat starts a new cache prefix. Unchanged files keep the prefix stable.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Profile instructions are read from disk at each request rather than copied into the session log, so replaying an old chat after its file changed shows the current instructions.
- Claude `skills`, `hooks`, `mcpServers`, `permissionMode`, `memory`, `isolation` and `maxTurns`, opencode `steps` and `hidden`, and Codex `skills` and `sandbox_mode` are not applied.
- Projects on a remote Host are not covered.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers - click to expand</summary>

None.

</details>
