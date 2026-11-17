---
description: "Local model card on the Settings Models page and the local option in first-run setup: download, import, load, and choose GGUF models, see hardware fit, and start or stop the local llama.cpp worker."
kind: "package-reference"
---

# @janhq/jan-client-ui-settings-local-model

## Summary

Users run models on their own computer from Settings → Models and from first-run setup. The Local model card starts, stops, and removes the local worker, lists installed models with fit, context, and residency, and adds models from the curated list, a Hugging Face repository, or a `.gguf` path. First-run setup offers the recommended model as the primary choice and shows its download. The [jan-llama-cpp](../../llm/llama-cpp/README.md) service on the Host does the work.

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

Mount the row with [ui-settings-models](../ui-settings-models/README.md) and the Host rows `llama-cpp` and `llama-cpp-controller`; the plugin has no configuration and no Host behavior.

```yaml
- id: ui-settings-local-model
  name: '@janhq/jan-client-ui-settings-local-model'
```

### Local model card

The card renders in the `settings.models.footer` slot. Its header shows the default model's name, the worker phase, and one hardware line naming the GPU devices with their memory, the backend, and system memory. While the worker runs, the card shows the context window it serves. Actions follow the phase: download the first-run model, cancel, start, stop, try again, and **Remove all**, which stops the worker and deletes every downloaded model. A failure shows the message and the worker's last log lines under **Details**.

### Model manager

The manager inside the card lists installed models. Each row shows a **Default** tag on the default model, a **Vision** tag on a model whose projector reads images, a fit badge (**Fits**, **Tight fit**, or **Too large**, with a hover hint), size, architecture, context, and source. While the worker runs, each row also shows **Loaded**, **Loading…**, or **Not loaded**. Rows offer **Load**, **Unload**, **Make default**, and **Delete**; deleting asks for confirmation, and an imported file is only removed from the list. A failed action shows its error on the row until the next attempt.

Below the list, **Downloads** shows progress, speed, and time left per download, with pause, resume, retry and cancel. A paused download keeps its partial file and shows how far it got; Resume continues from that byte, Cancel discards it. **Add a model** searches the curated models; text shaped like `owner/name` or a link instead looks up that Hugging Face repository and lists its files. Curated entries and repository files carry fit badges, and curated entries with a projector carry the **Vision** tag. When the repository has a vision projector, a note above its files names the projector and its size, because each download includes it. **Import a .gguf file** adds a file by its full path on the Host, with an optional second path for the model's vision projector (`mmproj`) file; the example path follows the Host platform, not the browser's.

### First-run option

The `settings.models.local-setup` slot renders the local option in the first-run dialog of ui-settings-models. Choosing it starts the download, or starts an installed model, and expands into progress and status. The user can continue in the background while it downloads, and finishes with **Start chatting** once the worker runs. A reload during a download or start reopens the expanded view.

Copy lives in the `settings.local-model` locale namespace.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The browser entry mounts the `llamaCpp` Remote unless the host already provides it, then registers both slots. One reconnecting mirror follows the controller's `follow` stream and feeds every view; a lost stream marks the mirror disconnected without changing the last Host state. Actions call controller operations and return outcomes, so each view owns its pending and error display.

| File | Owns |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | Remote mount, locale registration, slot registrations |
| [`src/client/state.ts`](src/client/state.ts) | State mirror, byte and time formatting |
| [`src/client/actions.ts`](src/client/actions.ts) | Controller calls and their outcomes |
| [`src/client/LocalModelCard.tsx`](src/client/LocalModelCard.tsx), [`src/client/ModelManager.tsx`](src/client/ModelManager.tsx) | Card and model manager |
| [`src/client/LocalSetup.tsx`](src/client/LocalSetup.tsx) | First-run option |
| [`src/client/locales.ts`](src/client/locales.ts) | Dictionaries |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [jan-llama-cpp](../../llm/llama-cpp/README.md) — models, the worker, and fit.
- [llama-cpp-controller](../../api/llama-cpp-controller/README.md) — the Remote operations this UI calls.
- [ui-settings-models](../ui-settings-models/README.md) — the Models page and the first-run dialog that host both slots.

-----

<a id="model-experience"></a>
## Model Experience

### Local model choices

#### What the model sees

The plugin adds no model-visible text. Its actions change which models the `local` route serves and which one `local/local` selects; [jan-llama-cpp](../../llm/llama-cpp/README.md#model-experience) owns that effect.

#### Token effect

No direct token effect. **Make default** and **Delete** can change the `contextWindow` listed for `local/local`.

#### KV Cache effect

**Unload**, **Delete**, **Stop**, and **Remove all** discard the worker's prompt cache for the affected model; **Make default** reloads no model.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The non-English dictionaries carry English text for the model manager, fit, hardware, and download progress strings.
- Import takes a typed path on the Host; there is no file picker or upload.
- The card has no per-model settings.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
