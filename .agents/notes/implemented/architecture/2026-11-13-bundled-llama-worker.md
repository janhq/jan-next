# Agent Note: The bundled jan-llama-worker replaces the downloaded llama-server

Status: implemented

## Problem

The `llama-cpp` plugin downloaded a pinned prebuilt `llama-server` archive from GitHub on first use, unpacked it with `tar`, and ran it on the fixed port 39281 that the `llm-pi-ai` `local` route also hardcoded. That design had four costs. The first run depended on GitHub release availability, so the plugin carried mirror fallbacks and a shared engine-install state machine. Only the CPU and Vulkan builds llama.cpp publishes were available, so CUDA and HIP were out of reach. A second process on port 39281 blocked the start, which required a pre-spawn health probe and a key check. Switching models restarted the server, and a supervisor killed with SIGKILL left `llama-server` running.

## Decision

The app ships `jan-llama-worker` ([`native/llama-worker`](../../../../native/llama-worker/README.md)), built from source against a pinned llama.cpp. `pnpm run stage:llama-worker` copies the binary, `libggml`, `libggml-base` and every backend module into `native/llama-worker/dist/`, whose run path is `$ORIGIN` (`@loader_path` on macOS). The desktop package copies that directory to `<resources>/llama-worker/`.

The plugin's explicit `workerPath` key names the executable; the web-app row sets it from `JAN_LLAMA_WORKER`. Packaged desktop sets that variable to the bundled copy, and `pnpm run dev:web` and `pnpm run dev:desktop` set it to the staged dev build. A missing or non-executable worker publishes `failed` at boot, and the first-run install downloads nothing.

The plugin writes a router preset with one section per installed model, named by its model id, and starts the worker with `--port 0`. It reads the bound port from the stdout handshake. The plugin publishes `http://127.0.0.1:<port>/v1` as the `LLAMA_CPP_BASE_URL` credential next to the `LLAMA_CPP_API_KEY` key, and the `local` route reads it through the `llm-pi-ai` `baseURLEnv` profile key. Each model is `local/<model id>` on the route and loads on first use; `modelsMax` (default 1, as in Jan) bounds the resident set. `local/local`, which released sessions reference, stays an alias of the default model: the preset's `[local]` section holds only `alias-of = <model id>`, and the worker resolves an alias to its target before any lookup, so both names share one engine. Installing, removing or choosing another default rewrites the preset and calls `POST /models/reload`; the worker reloads only sections whose options changed, so moving the alias unloads nothing and the process, port and key survive. Stop closes stdin and terminates the worker only after `stopTimeoutMs`. Because the worker also exits when stdin reaches end of file, it does not outlive a supervisor killed with SIGKILL.

## Alternatives considered

**Keep downloading `llama-server`.** It keeps installers small, but it keeps the GitHub dependency, the CPU/Vulkan-only matrix, the fixed port and the restart-per-switch behavior that the worker removes.

**Download the worker on demand.** This trades installer size for the same network dependency, plus a release pipeline and integrity table for a second artifact; bundling ties the worker to the app version that speaks its protocol.

**Write the live port into the `llm-pi-ai` settings section.** `syncRoute` already writes the model list there. That write lands in one profile's patch file, so `jan acp` and SDK processes, which use other profiles, would not see the port; it would also rewrite the user's patch on every start. A credential is shared across profiles and is withdrawn together with the key.

**Duplicate the default model under a `[local]` section.** It needs no worker change, but the worker treats the two sections as two models, so the default model's file loads twice whenever both ids are used.

**Map `local` to a model id in the route.** `llm-pi-ai` sends the configured model id unchanged and offers no per-model request id; adding one for a single route, or a body hook, couples the route to this plugin.

**Keep a fixed port.** A configured port lets the route keep a static `baseURL`, but it brings back the port-collision refusal and the duplicated `port`/`baseURL` setting this change removes.

## Consequences

The installer grows by the staged worker (78 MB uncompressed for a Linux build with the CPU and Vulkan backends). The worker must be built and staged before packaging; `JAN_DESKTOP_OMIT_LLAMA_WORKER=1` packages without it. A source launch other than the dev scripts must export `JAN_LLAMA_WORKER`.

The plugin no longer needs the engine artifact table, archive unpacking, the shared engine-install state, the mirror fallback, the pre-spawn port probe or the restart on model switch. `llm-pi-ai` gains a general `baseURLEnv` key that resolves a route's endpoint per request through the credential seam.

The preset follows Jan's generator: options left unset are omitted so llama.cpp or the GGUF decides, and model-dependent keys (`ctx-size` capped at the trained context, `moe-cache-mib` only for a model with experts) go in each model's section. Jan's per-model `model.yml` settings, chat-template and grammar overrides, speculative-decoding sections, embedding sections and sampling defaults are not ported, because nothing in this harness produces them; projector sections are written as the [vision projector note](../feature/2026-11-16-local-model-vision-projectors.md) records. The preset omits `jinja = true` because the pinned llama.cpp enables Jinja by default (`use_jinja = true` in `common/common.h`), which is why Jan dropped `--jinja` when it moved to router mode. `fit` defaults off on macOS, as in Jan (janhq/jan#9198).

GGUF headers are read with `@huggingface/gguf` (MIT, ESM, maintained by Hugging Face) instead of a hand-written reader: it reads local files through `allowLocalFile`, names `general.file_type` quantizations, and can read remote headers through HTTP ranges for a later pre-download estimate. Its only dependency is `@huggingface/tasks`. The plugin records the facts in `install.json` version 3, refuses projector and embedding files as models at download and import, and judges model fit against `--list-devices` and system memory with Jan's thresholds. Jan's GPU-offload readiness check is not ported: it compares the worker's devices with a hardware probe that this harness does not have.

Per-thread KV persistence is wired (`slotCacheMiB`, `slots/`) but off. The worker needs `thread_id` and `id_slot` in the request body; `llm-pi-ai` offers only the `llm-pi-ai/request-headers` waterfall, and no Session event marks a deletion whose saved state could be erased.
