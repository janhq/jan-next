---
description: "Define an Agent’s child plugins in ordinary Cordis YAML. Declare several presets and let sessions select one. Definitions load eagerly, and edits affect subsequently created Agents."
kind: "package-reference"
---

# @janhq/jan-agent-preset

## Summary

Define an Agent’s child plugins in ordinary Cordis YAML. Declare several presets and let sessions select one. Definitions load eagerly, and edits affect subsequently created Agents.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

```yaml
- id: agent-preset-registry
  name: '@janhq/jan-agent-preset-registry'
  config:
    default: standard
- id: preset-standard
  name: '@janhq/jan-agent-preset'
  config:
    id: standard
    plugins: []
```

| Field | Default | Meaning |
|---|---|---|
| `id` | required | Stable preset identifier |
| `plugins` | required | Child plugin entry list |
| `name` | unset | Display name |
| `description` | unset | Display description |
| `icon` | unset | Menu icon: a product glyph name such as `code-outline` or `layers-outline`, or one emoji; unset shows the generic preset glyph |
| `order` | unset | Roster order |
| `showInModePicker` | `true` | Offer this preset in the mode picker; `false` leaves delegation and explicit preset lookup unchanged |
| `toolAllowlist` | unset | Restrict model-facing tools to these names, including inherited tools |
| `readOnlyDelegation` | `false` | Pin new local delegated sessions using this preset to a read-only sandbox with no approval escalation |

The declaration row’s `id` addresses Loader edits; `config.id` is the preset identity saved by sessions. Child entry IDs may be omitted and assigned by Loader.

Jan's Creator mode (`cordis`) mounts this package's `skills/` through `skill-filesystem`. It customizes the running Jan app: install plugins, modes, or connector bundles into the current Jan profile, or save agent profiles and skills in the Jan home or project. A mode is a plugin composition; a [named agent](../agent-profiles/README.md) has its own instructions and optional model and tool limits and can be selected without changing the mode.

The composer exposes `/create-plugin` for plugins, pages, and agent tools, `/create-connector` for MCP bundles, and `/create-skill` for reusable instructions. `editing-cordis-compositions` covers modes and named agents; `agent-experience` covers prompt, tool, and context design; `cordis-composition-reference` links the generated package inventory, refreshed by `pnpm run gen-plugin-packages`. The procedures start with live inspection and verify the installed result in Jan. Skill bodies and templates load on demand to keep the static Creator prompt small; rendered `SKILL.md` results fit under the tool-result pruner's 8192-character threshold.

Edit `agent-experience` in [skills/agent-experience/SKILL.md](skills/agent-experience/SKILL.md). The repository discovery path, `.agents/skills/agent-experience/SKILL.md`, is a relative symbolic link to this file; the published package contains the regular file.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

[index.ts](src/index.ts) registers a definition and returns its disposer to Cordis. The plugin’s group marker preserves child `!!js` expressions until their own plugins load. The [registry](../agent-preset-registry/README.md) owns revision retention and release.

</details>

<a id="further-exploration"></a>
## Further Exploration

- [Scope](../../core/scope/README.md) — Registration isolation.
- [Agent](../../core/agent/README.md) — Session runtime.
- [Cordis](../../../docs/cordis-primer.md) — Plugin configuration and lifecycle.

<a id="model-experience"></a>
## Model Experience

Indirectly, through the declared plugins, which own model-visible tools and prompts.

#### KV Cache effect

A live Agent’s composition stays stable; new Agents can use an updated definition.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Requires the `agentPresets` service. Duplicate preset IDs fail declaration loading. Declarations provide no directory, file-copy or file-delete operations.
- Repository discovery of `agent-experience` requires a checkout with symbolic links enabled. With `core.symlinks=false`, Git writes the link target as plain text, not a skill. Creator mode uses the regular file in the package and does not depend on that alias.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
