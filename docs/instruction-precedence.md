---
description: "How Jan resolves conflicting chat, workspace, preset, and skill instructions, and how to name your assistant."
---

# Instruction precedence

Jan uses the project and user instruction files you provide. They can replace the product's default name, persona, tone, and working style. They cannot change safety rules, tool contracts, or what you directly ask Jan to do in chat.

## Which instruction wins?

Read the table from highest precedence to lowest. The order governs conflicting instructions, not the order in which text is sent to the model. Jan includes applicable file contents as context; it does not parse prose into settings or resolve individual contradictions in code.

| Priority | Source | Location and conflict rule |
|---|---|---|
| 1 | Safety rules, tool contracts, and required system instructions | The model provider and Jan's active profile and plugins supply these rules. The profile comes from [bundle and patch layers](architecture.md#profiles-and-bundles); [tool contracts](subsystems/tools.md) come from registered tools. Chat and instruction files do not grant extra permissions or change a tool's schema. |
| 2 | Your direct chat instructions | The messages you send in the current Session. A request in chat takes precedence over a standing preference from a file. |
| 3 | Project instructions | `AGENTS.md`, `CLAUDE.md`, `AGENTS.local.md`, `CLAUDE.local.md` in the project and its applicable subdirectories. A deeper directory wins for work under it; in one directory the later file in this default order wins on conflict. |
| 4 | Shared user-global instructions | `$JAN_AGENTS_HOME/AGENTS.md`, default `~/.agents/AGENTS.md`. Applies to all projects and wins over Jan-home instructions. |
| 5 | Jan-only user-global instructions | `$JAN_HOME/AGENTS.md`, default `~/.config/jan-alpha/AGENTS.md`. Applies to all projects in that Jan home unless a more specific file or direct chat instruction says otherwise. Neither user-global root loads `.local.md` overlays. |
| 6 | Skill instructions | Task-specific procedures loaded on demand from the active skill provider, usually `<skill-root>/<name>/SKILL.md` or `<skill-root>/<name>.md`. A skill guides the task it was loaded for; it does not set standing identity or override chat, workspace instructions, or required policy. |
| 7 | Preset persona and prompt defaults | An active preset can mount [`@janhq/jan-persona`](../packages/preset/persona/README.md) with `prefix` and `suffix` in its agent composition. Profile-declared presets live in the bundle or a `cordis.patch.yml` layer; Preset Square stores installed compositions at `$JAN_HOME/.agent-presets/<id>/agent.cordis.yml`. The preset replaces the deployment's persona sections for that Session; a complete preset can replace the entire assembled system prompt. Its default identity and style remain customizable by applicable instruction files when workspace instructions are enabled. |
| 8 | Jan's deployment defaults | The `system-prompt` row in a [profile bundle patch](../packages/bundle/headless/cordis.patch.yml) supplies `personaPrefix`, for example `You are Jan, an AI agent.` The [system-prompt plugin](../packages/core/system-prompt/README.md) can also supply a fixed harness identity if the bundle enables it. Profile and home patches can change the deployment defaults. An applicable file may change how the assistant introduces itself; it does not rename the product, model, or Session. |

### How Jan finds project files

Jan starts at the Session's working directory and finds the nearest ancestor with `.git` by default. If no marker exists, the working directory is the project root. Jan reads from that root down to the working directory, in the order shown in the table; it loads all present candidates, not just the first matching name. Within a candidate group, matching content after trimming appears only once. Successful `read`, `write`, or `edit` calls can expose additional nested instructions. A file found in one nested scope does not apply to a sibling directory. The [agent-instructions package](../packages/context/agent-instructions/README.md) documents configurable markers, byte budgets, and how edits become visible.

### Where Jan finds skills

For same-name local skills, earlier roots win: project `.jan/skills`, project `.agents/skills`, configured custom roots, `$JAN_HOME/skills`, `$JAN_AGENTS_HOME/skills`, then a configured bundled root. Plugins may also provide bundled or registered skills. The catalog lists names and descriptions; Jan receives the body when the skill is loaded. See [skills](subsystems/skills.md#local-discovery-priority) for provider and scope resolution.

## Set the assistant's name

Add this line to the project's `AGENTS.md` and start a new Session in that project. Ask `what is your name?` to check which instructions it follows.

```markdown
Your name is hihihaha.
```

Use `$JAN_HOME/AGENTS.md` for a Jan-wide default, or `$JAN_AGENTS_HOME/AGENTS.md` for a default shared with other agents that read that directory. If Jan uses a different name, check the Session's working directory and look for a conflicting instruction in chat, a deeper directory, or a later candidate in the same directory.

## Comparison with Hermes

Hermes uses `$HERMES_HOME/SOUL.md` to replace its default identity slot. It adds a separate `Project Context` section with the first available project context type: `.hermes.md` or `HERMES.md`, then `AGENTS.md`, `CLAUDE.md`, or Cursor rules. Jan does not load `SOUL.md`. It loads a chain of user-global and project files as instruction context and tells the model explicitly that those files can override Jan's default identity. The product's system-prompt opener stays in the request.
