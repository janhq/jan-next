---
name: editing-cordis-compositions
description: Use when creating, changing, or validating a Jan mode (agent preset), a named agent profile for chats, delegation or Bots, or another Jan Cordis composition, including Host versus preset placement.
---

# Create Jan modes and named agents

A **mode** selects a composition of plugins, tools, and prompts. An **agent profile** is a named set of instructions and optional model and tool limits, independent of mode. Use a profile when the user wants a specialist to select in a chat, delegate to, or reuse in a bot; use a mode when they want a different capability composition. For a bot's chat, memory, sources, and routines, use Jan's Bots page and choose a primary-capable profile there.

## Create a named agent

Write Markdown with YAML frontmatter to `<project>/.jan/agents/<id>.md` or `$JAN_HOME/agents/<id>.md`. Use the registered Jan project folder. Project and global files outrank Jan's eight built-ins (`reviewer`, `researcher`, `explorer`, `planner`, `worker`, `debugger`, `tester`, `writer`). Use **Copy to Jan** in Settings > Agents to customize a built-in or an agent from another tool without changing its source. Avoid accidental id collisions.

```markdown
---
name: test-report-reader
description: Summarizes failures in test reports without editing files.
mode: all
sandbox: read-only
tools: Read, Grep, Glob
---
Read the relevant test report. List distinct failures and point to their evidence.
```

`mode` means `primary`, `subagent`, or `all` (default), not a Jan mode. Omit `model` to inherit or set `provider/model#effort`. `tools` is an optional allowlist; `disallowedTools` is a denylist. Both take Jan tool names or supported Claude names as comma lists or YAML lists. Check names so an unmapped allowlist does not silently disappear. `sandbox` (`read-only`, `workspace-write`, `danger-full-access`) caps delegation at the narrower of the cap and the starting chat's permission. It neither grants access nor changes main-chat permission. See `packages/preset/agent-profiles/README.md` for full mapping and precedence.

Verify the saved profile in Settings > Agents: inspect its scope and warnings, select it in the chat's agent picker (or `/agent`) if it permits primary use, and try a harmless task to confirm the instructions and intended tools. For delegated use, ask Jan to delegate by the profile id. Reopen the chat or select the profile again to test edited instructions; an open chat does not rewrite its prompt or tools on a file save.

## Author a mode

Jan modes are `@janhq/jan-agent-preset` declarations carried by bundle patches. Query `Config.listConfigs` for a `preset-<id>` row's `entry` to locate the declaring plugin's README, or use Jan's read-only **View configuration** to inspect a mode's plugin list.

## Where declarations live

The Web bundle defines Code (`standard`), PTC (`ptc`), Minimal (`minimal`), and Creator (`cordis`) in `packages/bundle/web-app/presets/`. The source Desktop bundle (`plugins/desktop-app/cordis.patch.yml`) also declares Chat and adjusts the visible roster. Query the installed composition rather than assuming the roster. Use the file-read tool for an installed patch inside `app.asar`; `minimal.patch.yml` is a short example. Load `cordis-composition-reference` for Loader YAML and the generated package catalog.

A declaration row has these `config` fields: `id` (required, lowercase letters, digits and hyphens), `plugins` (required Cordis entry list), and optional `name`, `description` and `order` (roster position). The Loader row `id` is `preset-<id>` by convention.

## Create a preset

Create a workspace bundle. This minimal example shows the declaration; use `create-plugin` for the bundle's display metadata and artwork.

`writing-mode/package.json`:

```json
{
  "name": "@local/jan-writing-mode",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "jan": { "bundle": { "patch": "./cordis.patch.yml" } }
}
```

`writing-mode/cordis.patch.yml`:

```yaml
- insert:
    - id: preset-writing
      name: '@janhq/jan-agent-preset'
      config:
        id: writing
        name: Writing
        description: Write and edit text files without a shell tool.
        icon: skill-outline
        order: 10
        toolAllowlist: [read, write, edit]
        plugins:
          - id: persona
            name: '@janhq/jan-persona'
            config:
              prefix: You help the user write and edit text.
          - id: tool-fs
            name: '@janhq/jan-tool-fs'
```

For icons, use a Jan glyph name or one emoji. `toolAllowlist` restricts the mode to the named tools, including tools inherited from the Host; omitting a shell row alone does not ensure no shell tool is available.

Install with `plugin_manager`, `action: install_bundle`, `target` set to the absolute bundle directory. It runs package installation and bundle selection itself; do not reproduce those steps with shell commands.

## Change a shipped preset

Override the declaration by its Loader row id instead of inserting. The override replaces the complete `config`, so restate `id`, `plugins` and every other field the shipped file carries:

```yaml
- id: preset-standard
  name: '@janhq/jan-agent-preset'
  config:
    id: standard
    order: 1
    plugins:
      # the shipped list with your changes
```

## Migrate a legacy preset

Before declaration rows, a user preset was a directory `$JAN_HOME/.agent-presets/<id>/` holding `preset.yml` (display `name`, `description`, `order`) and `agent.cordis.yml` (the plugin entry list). Nothing reads that directory any more. To migrate one, create a bundle as above whose declaration takes `id` from the directory name, `name`, `description`, and `order` from `preset.yml`, and `plugins` from `agent.cordis.yml` verbatim; check each plugin name against `cordis-composition-reference` because packages renamed since the preset was written fail at activation. Install it, verify the row, then delete the legacy directory.

## Verify

Check the `plugin_manager` installation result, then inspect the `preset-<id>` row with `cordis_inspect_query` or open the mode configuration in Jan. A failed declaration can remain on the roster with a diagnostic. Select the new mode in a new chat and exercise its tools and prompt; existing chats and children keep their original preset revision. Keep prompt and tool definitions static within a running chat; use the skill bodies and runtime context for details that change.

## Choose plugin placement

Host plugins supply shared services: tools and prompt registries, the Agent loop, sessions, persistence, settings, sandbox policy, model routes, and subagent backends. Preset plugins contribute scoped tools, persona, prompt sections, and policies to those registries. Preset revisions are eagerly activated once and shared by their selecting Agents.

A preset plugin that supplies a service must isolate the provider and all its consumers in the same realm. A service consumed by Host plugins belongs in the Host configuration. Scope controls contributions and event visibility; `isolate` controls service instances. Use ordinary Cordis groups for nested plugin lists. Keep `!!js` expressions only in plugin configuration or `disabled`; the Loader evaluates them when activating the child plugin. Resolve assets from installed packages rather than a preset directory.

## Extend the Host

For profile-wide plugin code, use `create-plugin`; for an MCP server use `create-connector`. `cordis_inspect_list` and `cordis_inspect_query` inspect live APIs and Host Config schemas without calling Remote methods.
