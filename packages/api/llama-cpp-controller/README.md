---
description: "Authenticated Remote operations and a state stream for the managed local llama.cpp models: downloads, Hugging Face lookup, import, default selection, load and unload, worker start and stop, and removal."
kind: "package-reference"
---

# @janhq/jan-api-llama-cpp-controller

## Summary

Browser screens manage local models through authenticated Remote operations and one state stream. They can download, import, load, unload, delete, and choose the default model, and start, stop, or remove the local worker. The controller forwards each operation to [jan-llama-cpp](../../llm/llama-cpp/README.md) and never returns file paths or keys.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Mount the row beside `llama-cpp`; it requires the `llamaCpp` and `typert` services and has no configuration. Browsers reach it as the `llamaCpp` Remote namespace.

```yaml
- id: llama-cpp-controller
  name: '@janhq/jan-api-llama-cpp-controller'
```

| Operation | Effect |
|---|---|
| `readState`, `follow` | Read the current state; `follow` streams the current snapshot, then one per change, until the caller disconnects |
| `beginInstall`, `cancelInstall` | First run: download the first-run model and start the worker, or start the installed default; stop every download |
| `downloadModel`, `lookupRepo`, `downloadRepoFile` | Download a curated model; list a Hugging Face repository's GGUF files and its vision projector; download one of them, with the repository's projector, and return its model id |
| `pauseDownload`, `retryDownload`, `cancelDownload` | Pause a running or queued download, keeping its partial file; restart a failed or paused download from that file; stop one download and discard its files, or dismiss a failed one |
| `importModel` | Add a `.gguf` file by its absolute Host path, with an optional absolute path of its vision projector, both left in place, and return its model id; a projector given for an already imported file replaces that model's projector |
| `setDefaultModel`, `loadModel`, `unloadModel`, `deleteModel` | Make a model the default and load it; load or unload a model now; remove a model |
| `getModelContext`, `setModelContext`, `setModelFit`, `increaseModelContext` | Read the current and GGUF-trained maximum context; save a per-model context length or auto-fit choice and reload the running worker; grow in 8k -> 32k -> 1.5x steps up to the maximum, returning `null` at the limit |
| `startServer`, `stopServer`, `removeInstall` | Start or stop the worker; stop it and delete every downloaded model and the route credentials |

A failed operation throws a `RemoteError` with code `llama-cpp/failed` and details `{ reason }`, where `reason` is the service's message. A worker start failure from `startServer` or `setDefaultModel` arrives as the `failed` phase on `follow` instead. State snapshots carry no paths or keys; `importModel` accepts paths but returns only an id.

<a id="understand-the-implementation"></a>
## Understand the implementation

The controller is a `TypertRemoteService` that forwards each operation to `ctx.llamaCpp` and converts thrown errors to `llama-cpp/failed`. It keeps no state of its own. It re-exports the client-visible state types so browser code depends on this package instead of the Host service.

<a id="further-exploration"></a>
## Further Exploration

[jan-llama-cpp](../../llm/llama-cpp/README.md) owns the operations' behavior; [ui-settings-local-model](../../client/ui-settings-local-model/README.md) is the browser consumer; [api](../README.md) maps the Remote controllers.

<a id="model-experience"></a>
## Model Experience

### Local model operations

#### What the model sees

The controller adds no model-visible text. Its operations change which models the `local` route serves and which one `local/local` selects; [jan-llama-cpp](../../llm/llama-cpp/README.md#model-experience) owns that effect.

#### Token effect

No direct token effect. `setDefaultModel` and `deleteModel` can change the `contextWindow` listed for `local/local`.

#### KV Cache effect

Unloading, deleting, stopping, or removing through the controller discards the worker's prompt cache for the affected model; changing the default reloads no model.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Failures carry one free-text `reason`; callers cannot distinguish a busy model, a missing file, or an unreachable Hugging Face by code.
- `importModel` takes paths on the Host's filesystem; a remote browser cannot upload a model or projector file through it.

<a id="dev-note"></a>
### Dev Note

None.
