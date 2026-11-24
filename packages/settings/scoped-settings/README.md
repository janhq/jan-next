---
description: "Project defaults for model, mode and agent profile, plus scoped tool and skill switches."
kind: "package-reference"
---

# @janhq/jan-scoped-settings

## Summary

Give each project its own default model, mode and agent for new chats, and switch tools and skills off for every chat, one project or one chat. Settings live in a document in Jan's home, not in the project folder. A chat's own selections stay in its log.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

The web-app bundle mounts it after the workspace controller:

```yaml
- id: scoped-settings
  name: '@janhq/jan-scoped-settings'
  config:
    file: !!js janHomePath('settings', 'scoped.json')
```

The service requires `agents`, `workspaceRegistry` and `tools`. Optional `agentPresets` validates the project mode, `agentProfiles` supplies chat tool limits, and `skills` receives the skill filter.

Open **Project settings** from a project's context menu to choose its default model, reasoning effort, mode and agent, or to switch off tools and skills in that project. The **Default agent** menu offers profiles that can run a chat; **None** clears the default. Use `/tools` in a chat (**Tools and skills for this chat**) or **Settings > General > Tools and skills for every chat** to edit the other two scopes. A checked tool or skill is not switched off at the scope you are editing; a wider scope can still switch it off.

| Setting | Chat | Project | Global | Resolution |
|---|---|---|---|---|
| Model and reasoning effort | Chat's own selection (session log) | `model` | `agent-default-model` | Chat, then project, then global |
| Mode (agent preset) | Chat's own selection (session log) | `mode` | `agent-preset-registry` default | Chat, then project, then global |
| Agent profile | Chat's own selection (session log) | `agent` | None | Requested profile or plain Jan, then project default |
| Tools off | `toolsDisabled` | `toolsDisabled` | `toolsDisabled` | Union: any scope can switch a tool off |
| Skills off | `skillsDisabled`, `skillFoldersDisabled` | same | same | Union: any scope can switch a skill or its folder off |

`toolsDisabled` lists tool names, or `mcp:<server>` for every tool of one MCP server, including tools that server registers later. `skillsDisabled` lists skill names; `skillFoldersDisabled` lists the absolute folder that holds `<name>/SKILL.md` or `<name>.md`, matched exactly so each entry is one row of the editor. To use a tool or skill a wider scope switched off, switch it back on at that scope.

The project page's **Skills** card and the agent's `project_skills_read` / `project_skills_change` tools (jan-theme) read and write the project layer through this service.

Remote methods (`ctx.remote.scopedSettings`):

- `read({ scope, id? })` returns the values one scope stores, without inherited ones.
- `write({ scope, id?, values })` sets keys; `null` or an empty list removes one. Global and chat scopes store only the switch lists; a project id must exist.
- `setSwitch({ scope, id? }, key, entry, off)` adds or removes one entry of one switch list inside the write queue, so concurrent switches never drop each other.
- `toolCatalog()` lists tool names outside MCP and MCP servers from the global registry and the default preset.
- `skillCatalog({ scope, id? })` lists every skill a chat in that scope could load, grouped by folder, with the scope's own switches and `offAt` naming the wider scope that already switched one off.

Host callers use `resolveModel(sessionId, workspaceHint?)`, `resolveMode(workspaceId)`, `resolveAgent(workspaceId)`, `resolveToolsDisabled(sessionId)` and `projectOf(sessionId, cwd?)`. The session controller reads the project defaults when it creates a chat. Each write emits `scoped-settings/changed`.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals - click to expand</summary>

The [store](src/store.ts) validates the document with the same schema on every load. A file that does not parse is renamed to `scoped.json.invalid-<timestamp>` with a warning, and Jan starts empty. Writes run one at a time and replace the file atomically with mode `0600`.

The [service](src/index.ts) keeps at most one tool restriction per live agent. It expands MCP server entries against the agent's own scope before applying restrictions, and refreshes on agent creation, tool registration changes, scoped settings writes, and profile changes. A chat belongs to the project whose session list holds it, or else to the innermost project whose folder holds the chat's folder.

Skills use one `skills.registerFilter` entry. For a lookup whose scope is a chat's agent, it unions the global, project and chat switches; a lookup without an agent (a new chat, the project page) uses the global switches and the project that holds its folder. Each write calls `skills.refresh()`, so the next turn gets a new skill catalog. [Skill matching](src/skills.ts) groups skills by the folder above `<name>/SKILL.md` or `<name>.md`.

</details>

<a id="further-exploration"></a>
## Further Exploration

- [Settings reference](../../../docs/subsystems/settings.md) - plugin forms and the scoped layer.
- [Tools reference](../../../docs/subsystems/tools.md) - per-agent restrictions.

<a id="model-experience"></a>
## Model Experience

### Switched-off tools

#### What the model sees

A tool named in any scope's `toolsDisabled` or denied by the chat's agent profile is absent from the chat's tool list from the next request. A profile allowlist also hides global tools it does not include; it cannot restore a denied tool. The model is not told what was removed. A project's defaults apply only when starting a new chat.

#### Token effect

Each switched-off tool removes its name, description and parameter schema from every request of the affected chats; switching it back on adds them again.

#### KV Cache effect

Switching a tool off or on changes the tool list, so the next request of each affected chat starts a new cache prefix.

### Switched-off skills

#### What the model sees

A skill named in any scope's `skillsDisabled`, or held by a folder in `skillFoldersDisabled`, leaves the skill catalog from the next step, and the agent cannot load it.

#### Token effect

The replacement skill catalog adds one message listing the remaining skills; the earlier catalog stays in the conversation.

#### KV Cache effect

A skill switch appends a replacement skill catalog to the conversation instead of rewriting the prefix, so the cached prefix stays valid.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Jan has no chat deletion today, so chat entries stay in the document until removed through `write`.
- `toolCatalog()` does not list registrations unique to a live agent or to a non-default preset.
- Plugins that run once per Host (theme, sidebar, bundles) stay global.
- Projects and chats on a remote Host are not covered yet.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers - click to expand</summary>

None.

</details>
