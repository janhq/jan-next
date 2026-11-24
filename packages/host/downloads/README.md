---
description: "One sidebar inbox for every Host download: model, update, backend, plugin, voice and file transfers with progress and actions."
kind: "package-reference"
---

# @janhq/jan-downloads

## Summary

Open Downloads beside the sidebar toggle to see model, app update, backend, plugin, voice, and file transfers. The ring combines active progress; a dot marks an unseen completion or failure. Open the inbox to acknowledge the dot, or use Clear finished to remove terminal rows. Supported actions appear beside each transfer. The full Downloads page in the More menu still manages local model downloads and stored files. Pausing a model transfer keeps its partial file; discarding it requires confirmation.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Producers optionally look up `ctx.get('downloads')` on the Host. Call `start({ kind, name, actions? })` once per logical transfer, report cumulative bytes, percent, speed or state with `handle.update()`, and call `handle.finish('done' | 'failed' | 'cancelled', error?, actions?)` when settled. Only expose actions currently supported by that attempt. For a resumable operation, a stable namespaced `id` lets the next attempt replace the original row without accepting stale reports from its handle. Do not report cache hits as downloads.

<a id="understand-the-implementation"></a>
## Understand the implementation

The Host retains terminal rows until cleared or restarted. Byte-only updates publish at most every 150 ms and speed is a rolling four-second average; state and action changes publish at once. The authenticated owner-only `/api/downloads.inbox` route streams snapshots and dispatches supported actions; no callback or local filesystem path is serialized as a structured field. The Desktop bridge reports transfers owned by Electron's main process to the same Host store. The deployed Web and Desktop composition supplies this plugin; producers continue to work when it is not installed.

<a id="further-exploration"></a>
## Further Exploration

- [llama.cpp](../../llm/llama-cpp) and [Plugin Manager](../../boot/plugin-manager/README.md) for two producers that report into the inbox.

<a id="model-experience"></a>
## Model Experience

None, as transfer progress and actions stay in the Host and the browser and never enter model requests.

#### KV Cache effect

No effect; the package adds nothing to any request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- History is kept in memory: finished rows disappear when the Host restarts.

-----

<a id="dev-note"></a>
### Dev Note

None.
