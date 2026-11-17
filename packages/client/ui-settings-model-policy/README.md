---
description: "Models page cards for fallback models and automatic context compaction."
kind: "package-reference"
---

# @janhq/jan-client-ui-settings-model-policy

## Summary

**Settings > Models** shows a **Fallback models** card for the order Jan tries other models and a **Context** card for automatic compaction. Each card appears only when its Host settings namespace is served. Changes take effect immediately, without a Save button.

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

Add the browser plugin to the profile:

```yaml
- id: ui-settings-model-policy
  name: '@janhq/jan-client-ui-settings-model-policy'
```

Add and order fallback models from the available Host catalog. An empty chain disables fallback. Adjust when Jan tries the original model again and how small the conversation must be before switching back. In Context, toggle automatic compaction, choose its threshold and select a summary model. Manual `/compact` remains available when automatic compaction is off.

-----

<a id="understand-the-implementation"></a>

## Understand the implementation

<details>
<summary>Implementation internals - click to expand</summary>

The Host entry is inert; the browser entry registers two cards in `settings.models.footer`, separately gated by `ctx.configForms.whileServed` for `model-fallback` and `compaction-settings`. `compaction-settings` is the host-plane `@janhq/jan-compaction-basic/settings` entry: agent presets mount their own compaction backend in an isolated realm that Settings does not serve, so the shared preferences live on the host and override each backend's own value field by field. An unset field shows the backend default (auto on, 80%, same model as the chat). Each card reads its own `ctx.configForms.get` snapshot and writes changes immediately. The catalog loads after mounting a card; the summary model's provider and model are written together with one `mutate` call. All eight UI dictionaries live in `src/client/locales.ts`.

</details>

-----

<a id="further-exploration"></a>

## Further Exploration

- [ui-settings-models](../ui-settings-models/README.md) provides the Models page and its footer slot.
- [ui-settings](../ui-settings/README.md) provides the live config forms and served-namespace watch.
- [ui-primitives](../ui-primitives/README.md) provides the card controls.

-----

<a id="model-experience"></a>

## Model Experience

### Model policy choices

#### What the model sees

The browser cards add no text to a model request. The Host uses the selected `model-fallback` and `compaction-settings` preferences to route requests and manage conversation history.

#### Token effect

The browser adds no tokens directly. Host compaction can shorten a later request by trimming large tool results and summarizing older messages.

#### KV Cache effect

Changing settings in the browser does not itself modify the prompt cache. Switching models drops the cache for that conversation.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

The catalog may not include every model a user previously selected:

- A previously selected model missing from the current catalog remains visible by its stored ID, but cannot be picked again until it returns.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers - click to expand</summary>

Run this package's client specs and TypeScript check after editing its browser surface.

</details>
