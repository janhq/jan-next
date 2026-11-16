---
kind: upgrade-guide
description: "The llama-cpp plugin runs the bundled jan-llama-worker on an OS-assigned port instead of a downloaded llama-server on a fixed port, and its engine, port and test-override keys are removed."
---

# `llama-cpp` runs the bundled `jan-llama-worker`

English | [中文](guide.zh.md)

## Change

The `@deepseek-ai/dsh-llama-cpp` row no longer downloads a `llama-server` engine. It runs the `jan-llama-worker` executable named by the new `workerPath` key, which the desktop app and `pnpm run dev:web` set through `JAN_LLAMA_WORKER`; without a usable worker the row reports `failed` at startup. The worker binds a port the OS chooses, and the row publishes it as the `LLAMA_CPP_BASE_URL` credential while the worker serves. The keys `backend`, `port`, `binaryPath` and `artifactOverrides` are removed, and `LLAMA_CPP_BACKEND` is no longer read. The `llm-pi-ai` `local` route reads its endpoint through the new `baseURLEnv` key instead of `baseURL: http://127.0.0.1:39281/v1`. The `llamaCpp/readState` and `llamaCpp/follow` results drop `model.engineBytes`, `model.backend`, `model.engineVersion`, `progress.phase`, `progress.overallReceivedBytes` and `progress.overallTotalBytes`. Startup deletes `$DSH_HOME/llama-cpp/engine/` and `downloads/`, keeping installed models.

The row now reads each model's GGUF header. Importing a vision projector or embedding model as a chat model fails, and `install.json` becomes version 3 with the header facts of each model; startup converts a version 1 or 2 file and drops a model whose header cannot be read or that is not a chat model. The preset omits `jinja = true`, the bundled llama.cpp default, and writes `slot-save-path` under `$DSH_HOME/llama-cpp/slots/`. `fit` has no fixed default: unset, it is on except on macOS. The new llama.cpp option keys ([configuration catalog](../../../config-catalog.md)) are optional; a quantized `cacheType` with `flashAttn: off` fails at load. The row writes the `local` route's `contextWindow` from the context the worker reports, never above the model's trained context. `llamaCpp/readState` and `llamaCpp/follow` add `hardware`, `fit` on curated, looked-up and installed models, and `architecture`, `contextLength`, `status` and `contextSize` on installed models.

The route lists every installed model as `local/<model id>`, loaded on first use, with at most `modelsMax` (default 1) resident; `local/local` stays an alias of the default model. The `llamaCpp` Remote replaces `selectModel` with `setDefaultModel` and adds `loadModel` and `unloadModel`.

## Migration

1. In a profile patch, delete `backend`, `port`, `binaryPath` and `artifactOverrides` from the `llama-cpp` row. Tests replace `artifactOverrides.model` with `firstModelOverride` and `binaryPath` with `workerPath`.
2. In a profile patch that copies the `llm-pi-ai` `providers.local` route, replace `baseURL: http://127.0.0.1:39281/v1` with `baseURLEnv: LLAMA_CPP_BASE_URL`.
3. For a source launch other than `pnpm run dev:web` or `pnpm run dev:desktop`, run `pnpm run build:llama-worker` and `pnpm run stage:llama-worker`, then export `JAN_LLAMA_WORKER` with the absolute path of `native/llama-worker/dist/jan-llama-worker`.
4. A headless profile that ran its own `llama-server` exports `LLAMA_CPP_BASE_URL=http://127.0.0.1:<port>/v1` next to `LLAMA_CPP_API_KEY`.
5. Clients of the `llamaCpp` Remote read download progress from `progress.receivedBytes` and `progress.totalBytes`, and call `setDefaultModel` instead of `selectModel`.
6. On macOS, set `fit: true` on the `llama-cpp` row to keep fit on.
7. Re-import a model the startup log dropped only if it is a chat model GGUF file.
8. In Settings → Models, confirm the Local model card reaches Running and answers a chat on the `local` route.
