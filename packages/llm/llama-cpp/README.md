---
description: "Managed local llama.cpp models: verified GGUF downloads from a curated catalog or Hugging Face, local file import, hardware fit estimates, and supervision of the bundled jan-llama-worker that serves the llm-pi-ai `local` route."
kind: "package-reference"
---

# @deepseek-ai/dsh-llama-cpp

English | [中文](README.zh.md)

## Summary

Run chat models on this computer without an API key. The service downloads verified GGUF models from a curated catalog or a Hugging Face repository, or imports a local file, and serves every installed model through the bundled `jan-llama-worker` on a loopback port. The model picker lists each model as `local/<model id>`, and `local/local` follows the default model. Models load on first use, and one stays resident by default. Fit badges estimate whether a model fits the machine's memory; they block nothing.

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

The `web-app` bundle mounts the service in the Host process; ACP, SDK, and subagent processes reach the same models through the `local` route that the base bundle declares in `llm-pi-ai`.

### When to choose it

Choose it when a deployment serves GGUF chat models on the user's own machine through llama.cpp. Remote providers need only [llm-pi-ai](../llm-pi-ai/README.md) routes. Mount it in one Host process per `dataRoot`; that process owns the worker and the files under `dataRoot`.

### Minimal configuration

```yaml
- id: llama-cpp
  name: '@deepseek-ai/dsh-llama-cpp'
  config:
    dataRoot: !!js dshHomePath('llama-cpp')
    workerPath: !!js "process.env.JAN_LLAMA_WORKER || undefined"
```

The desktop app sets `JAN_LLAMA_WORKER` to its bundled worker; `pnpm run dev:web` and `pnpm run dev:desktop` set it to the `pnpm run stage:llama-worker` output. Without a usable worker, the service reports the `failed` phase at boot and starts nothing.

| Field | Default | Meaning |
|---|---|---|
| `dataRoot` | required | Absolute directory for models, `install.json`, `run/preset.ini`, and slot state |
| `workerPath` | unset | Absolute path of `jan-llama-worker`, with its ggml libraries beside it |
| `model` | `default` | Curated model the first-run offer installs; `small` selects a 429 MB test model |
| `modelsMax` | `1` | Models kept resident; `0` removes the bound |
| `ctxSize` | `32768` | Requested context; `0` lets `fit` choose, starting from the trained context and never below `fitCtx` (`16384`) |
| `fit` | on; off on macOS | Let llama.cpp size GPU layers, and the context when `ctxSize` is `0`, to device memory |
| `slotCacheMiB` | `0` | Disk budget for per-thread KV state under `<dataRoot>/slots`; `0` saves nothing |
| `autoStart` | `true` | Start the worker at boot when a model is installed and the user left it running |
| `provider`, `routeModelId` | `local`, `local` | Route name and the alias model id of the default model |
| `apiKeyRef`, `baseURLRef` | `LLAMA_CPP_API_KEY`, `LLAMA_CPP_BASE_URL` | Credential references the route reads as `apiKeyEnv` and `baseURLEnv` |
| `routeNamespace` | `llm-pi-ai` | Settings namespace whose `providers.<provider>.models` the service rewrites; empty disables the rewrite |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-llama-cpp) lists every accepted field, including GPU, batch, and KV cache options.

### Models and the picker

The service records installed models in `<dataRoot>/install.json` (version 3) with facts read from each GGUF header: architecture, trained context, and KV cache dimensions. A download is verified against its SHA-256 digest and size before it is recorded. An imported file stays where it is and is not hashed. Vision projector (CLIP) and embedding-only files are refused. Removing a downloaded model deletes its file; removing an imported model only forgets it.

The first installed model becomes the default and starts the worker. The picker lists every installed model as `local/<model id>`, and `local/local` always selects the default model, so a released Session that recorded `local/local` keeps working after the default changes. When the settings section declares the `local` provider, the service keeps its `models` list equal to the installed set: `<name> (local default)` for the alias first, then `<name> (local)` per model. Each `contextWindow` is the context the worker last settled on for that model, otherwise the planned context, and never exceeds the trained context.

When the agent default model names no model this route serves, or names another route that offers no models, the service moves it to `local/local`. **Make default** also moves a default on another local model id to `local/local`. A usable default on another route stays.

### Worker lifecycle

Start runs the worker with `--port 0`, so the operating system assigns a loopback port, and passes a fresh API key in the `JAN_LLAMA_API_KEY` environment variable. After the default model loads, the service stores the endpoint in `LLAMA_CPP_BASE_URL` and the key in `LLAMA_CPP_API_KEY`; it withdraws both when the worker stops, so the route offers no models while nothing serves. Stop closes the worker's stdin and terminates the worker after `stopTimeoutMs`. Later boots start the worker only when the user left it running.

The service writes `<dataRoot>/run/preset.ini` with one section per installed model, named by model id, and an alias section `[local]` with `alias-of = <default model id>`. A request for `local` reaches the default model's engine without a second load. Installing, importing, removing, or changing the default rewrites the preset and calls `POST /models/reload` on the running worker without a restart; the worker reloads only changed sections, so retargeting the alias reloads no model. **Make default** and removing the default then load the new default into the running worker; a load failure sets the `failed` phase.

A model loads on its first request or on an explicit load. At most `modelsMax` models stay resident: loading another evicts the least recently used idle model, and the worker answers HTTP 503 while every resident model is busy. Removal unloads a resident model first, because Windows cannot delete a file the worker maps, and fails while the model has requests in flight.

### Hardware fit

At boot the service runs the worker with `--list-devices` and reads system memory. Each installed model, catalog entry, and Hugging Face file then carries a fit of `fits`, `tight`, or `too-large`. Installed models count their weights plus the estimated KV cache at the planned context; catalog entries and repository files count their file size. Fit is a warning, and nothing is blocked. A failed device listing leaves fit unknown.

### State

`follow()` streams complete snapshots: phase, the Host platform (`linux`, `macos`, or `windows`), the default model, installed models with `status` (`loading`, `loaded`, or `unloaded`) and `contextSize`, downloads with progress, the catalog, and the hardware summary. Snapshots carry no paths or keys. The [Remote controller](../../api/llama-cpp-controller/README.md) forwards them to browsers.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

One `LlamaCpp` service serializes install-record and worker mutations through a task queue. Downloads run one at a time on a separate queue and commit through the task queue, so Start and Stop stay responsive during a download. The worker's handshake line names its port and aliases; the service then subscribes to `/models/sse` to mirror residency and, after each load, reads the settled context from `/props` and rewrites the route list.

| File | Owns |
|---|---|
| [`src/index.ts`](src/index.ts) | Service, install record, downloads, worker lifecycle, route list, default adoption |
| [`src/config.ts`](src/config.ts) | Validated configuration |
| [`src/preset.ts`](src/preset.ts) | Preset rendering and the planned context |
| [`src/worker.ts`](src/worker.ts) | Handshake and device-list parsing, worker HTTP client |
| [`src/gguf.ts`](src/gguf.ts) | GGUF header facts and the KV cache estimate |
| [`src/memory.ts`](src/memory.ts) | Fit assessment |
| [`src/catalog.ts`](src/catalog.ts), [`src/huggingface.ts`](src/huggingface.ts), [`src/download.ts`](src/download.ts) | Curated catalog, repository lookup, verified resumable download |
| [`src/types.ts`](src/types.ts) | Client-visible state |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [jan-llama-worker](../../../native/llama-worker/README.md) — the worker's command line, handshake, and HTTP API.
- [llm-pi-ai](../llm-pi-ai/README.md) — the adapter that serves the `local` route.
- [llama-cpp-controller](../../api/llama-cpp-controller/README.md) — browser access to this service.
- [ui-settings-local-model](../../client/ui-settings-local-model/README.md) — the Settings card and first-run option.
- [LLM streaming subsystem](../../../docs/subsystems/llm-streaming.md) — the generated `ctx.llamaCpp` API.

-----

<a id="model-experience"></a>
## Model Experience

### Local model requests

#### What the model sees

Requests on `local/<model id>` or `local/local` reach the selected GGUF model through the `llm-pi-ai` `openai-completions` route. The service adds no prompt text; llama.cpp formats messages with the model's embedded chat template, or a generic template when the file has none.

#### Token effect

The service adds no tokens. It sets each route entry's `contextWindow` to the context the worker serves, capped at the trained context, and `maxTokens` to `routeMaxTokens` (`8192`). The harness prompt and tools take about 12k tokens; the service logs a warning when a model settles below `fitCtx`.

#### KV Cache effect

Prefix reuse happens in the worker's llama.cpp prompt cache for the resident model. Unloading, evicting, or reloading the model, stopping the worker, and switching models discard that reuse; retargeting the `local` alias reloads no model. Per-thread KV state on disk (`slotCacheMiB`) is off by default.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

The worker serves text chat models with shared launch options.

- The preset has no vision projector, embedding, or speculative decoding sections; projector and embedding files are refused at install.
- Launch options apply to every model; there are no per-model settings and no settings UI for them.
- KV state reuse across restarts is off: `slotCacheMiB` defaults to `0`, and the `llm-pi-ai` route does not send the thread name the worker caches by.
- Fit thresholds estimate driver and operating system overhead; a `fits` model can still fail to load, and a `too-large` model can load.
- `fit` defaults off on macOS, where Metal counts the whole memory-mapped file against its working set; the context there follows `ctxSize`.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
