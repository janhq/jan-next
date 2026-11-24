---
description: "Model, mode, tool and skill switches that resolve per chat, then per project, then globally."
kind: "package-reference"
---

# @janhq/jan-scoped-settings

## Summary

Give each project its own default model and mode for new chats, and switch tools and skills off for every chat, one project or one chat. Values live in one document in Jan's home, not in the project folder. A chat's own model and mode choices stay in its log and always win.

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

It needs `agents`, `workspaceRegistry` and `tools`; `agentPresets` is optional and only checks that a project mode still exists, and `skills` is optional and receives the skill filter.

Open **Project settings** from a project's context menu to choose its default model, reasoning effort and mode, or to switch off tools and skills in that project. Use `/tools` in a chat (**Tools and skills for this chat**) or **Settings > General > Tools and skills for every chat** to edit the other two scopes. A checked tool or skill is not switched off at the scope you are editing; a wider scope can still switch it off.

| Setting | Chat | Project | Global | Resolution |
|---|---|---|---|---|
| Model and reasoning effort | Chat's own selection (session log) | `model` | `agent-default-model` | Chat, then project, then global |
| Mode (agent preset) | Chat's own selection (session log) | `mode` | `agent-preset-registry` default | Chat, then project, then global |
| Tools off | `toolsDisabled` | `toolsDisabled` | `toolsDisabled` | Union: any scope can switch a tool off |
| Skills off | `skillsDisabled`, `skillFoldersDisabled` | same | same | Union: any scope can switch a skill or its folder off |

`toolsDisabled` lists tool names, or `mcp:<server>` for every tool of one MCP server, including tools that server registers later. `skillsDisabled` lists skill names; `skillFoldersDisabled` lists the absolute folder that holds `<name>/SKILL.md` or `<name>.md`, matched exactly so each entry is one row of the editor. To use a tool or skill a wider scope switched off, switch it back on at that scope.

The project page's **Skills** card and the agent's `project_skills_read` / `project_skills_change` tools (jan-theme) read and write the project layer through this service.

Remote methods (`ctx.remote.scopedSettings`):

- `read({ scope, id? })` returns the values one scope stores, without inherited ones.
- `write({ scope, id?, values })` sets keys; `null` or an empty list removes one. Global and chat scopes store only the switch lists; a project id must exist.
- `setSwitch({ scope, id? }, key, entry, off)` adds or removes one entry of one switch list inside the write queue, so concurrent switches never drop each other.
- `toolCatalog()` lists global tool names outside MCP and the MCP servers with tools.
- `skillCatalog({ scope, id? })` lists every skill a chat in that scope could load, grouped by folder, with the scope's own switches and `offAt` naming the wider scope that already switched one off.

Host callers use `resolveModel(sessionId, workspaceHint?)`, `resolveMode(workspaceId)`, `resolveToolsDisabled(sessionId)` and `projectOf(sessionId, cwd?)`. The session controller reads the first two when it creates a chat. Each write emits `scoped-settings/changed`.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals - click to expand</summary>

The [store](src/store.ts) validates the document with the same schema on every load. A file that does not parse is renamed to `scoped.json.invalid-<timestamp>` with a warning, and Jan starts empty. Writes run one at a time and replace the file atomically with mode `0600`.

The [service](src/index.ts) keeps one `tools.restrict({ deny })` per live agent. It recomputes on `agent/created`, `tools/change` and `scoped-settings/changed`, and changes the restriction only when the deny list changed, because changing it emits `tools/change` again. A chat belongs to the project whose session list holds it, or else to the innermost project whose folder holds the chat's folder.

Skills use one `skills.registerFilter` entry. For a lookup whose scope is a chat's agent, it unions the global, project and chat switches; a lookup without an agent (a new chat, the project page) uses the global switches and the project that holds its folder. Each write calls `skills.refresh()`, so the next turn gets a new skill catalog. [Skill matching](src/skills.ts) groups skills by the folder above `<name>/SKILL.md` or `<name>.md`.

</details>

<a id="further-exploration"></a>
## Further Exploration

- [Settings reference](../../../docs/subsystems/settings.md) - plugin forms and the scoped layer.
- [Tools reference](../../../docs/subsystems/tools.md) - per-agent restrictions.

<a id="model-experience"></a>
## Model Experience

A switched-off tool leaves the chat's tool list for the next request, and a switched-off skill leaves the skill catalog from the next step. A project model or mode applies only to chats created after the change.

#### KV Cache effect

Switching a tool off or on changes the tool list, so the next request of each affected chat starts a new cache prefix. A skill switch appends a replacement skill catalog to the conversation instead of rewriting the prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Jan has no chat deletion today, so chat entries stay in the document until removed through `write`.
- Scoped registrations inside a preset are not listed by `toolCatalog()` and are switched off only by exact name.
- Plugins that run once per Host (theme, sidebar, bundles) stay global.
- Projects and chats on a remote Host are not covered yet.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers - click to expand</summary>

None.

</details>
