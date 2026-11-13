# Agent Note: The bundled jan-llama-worker replaces the downloaded llama-server

Status: implemented

English | [中文](2026-11-13-bundled-llama-worker.zh.md)

## Problem

The `llama-cpp` plugin downloaded a pinned prebuilt `llama-server` archive from GitHub on first use, unpacked it with `tar`, and ran it on the fixed port 39281 that the `llm-pi-ai` `local` route also hardcoded. That design had four costs. The first run depended on GitHub release availability, so the plugin carried mirror fallbacks and a shared engine-install state machine. Only the CPU and Vulkan builds llama.cpp publishes were available, so CUDA and HIP were out of reach. A second process on port 39281 blocked the start, which required a pre-spawn health probe and a key check. Switching models restarted the server, and a supervisor killed with SIGKILL left `llama-server` running.

## Decision

The app ships `jan-llama-worker` ([`native/llama-worker`](../../../../native/llama-worker/README.md)), built from source against a pinned llama.cpp. `pnpm run stage:llama-worker` copies the binary, `libggml`, `libggml-base` and every backend module into `native/llama-worker/dist/`, whose run path is `$ORIGIN` (`@loader_path` on macOS). The desktop package copies that directory to `<resources>/llama-worker/`.

The plugin's explicit `workerPath` key names the executable; the web-app row sets it from `JAN_LLAMA_WORKER`. Packaged desktop sets that variable to the bundled copy, and `pnpm run dev:web` and `pnpm run dev:desktop` set it to the staged dev build. A missing or non-executable worker publishes `failed` at boot, and the first-run install downloads nothing.

The plugin writes a router preset with one `[local]` section and starts the worker with `--port 0`. It reads the bound port from the stdout handshake. The plugin publishes `http://127.0.0.1:<port>/v1` as the `LLAMA_CPP_BASE_URL` credential next to the `LLAMA_CPP_API_KEY` key, and the `local` route reads it through the `llm-pi-ai` `baseURLEnv` profile key. Selecting another model rewrites the preset and calls `POST /models/reload`, so the process, port and key survive the switch. Stop closes stdin and terminates the worker only after `stopTimeoutMs`. Because the worker also exits when stdin reaches end of file, it does not outlive a supervisor killed with SIGKILL.

## Alternatives considered

**Keep downloading `llama-server`.** It keeps installers small, but it keeps the GitHub dependency, the CPU/Vulkan-only matrix, the fixed port and the restart-per-switch behavior that the worker removes.

**Download the worker on demand.** This trades installer size for the same network dependency, plus a release pipeline and integrity table for a second artifact; bundling ties the worker to the app version that speaks its protocol.

**Write the live port into the `llm-pi-ai` settings section.** `syncRoute` already writes the model list there. That write lands in one profile's patch file, so `dsh acp` and SDK processes, which use other profiles, would not see the port; it would also rewrite the user's patch on every start. A credential is shared across profiles and is withdrawn together with the key.

**Keep a fixed port.** A configured port lets the route keep a static `baseURL`, but it brings back the port-collision refusal and the duplicated `port`/`baseURL` setting this change removes.

## Consequences

The installer grows by the staged worker (78 MB uncompressed for a Linux build with the CPU and Vulkan backends). The worker must be built and staged before packaging; `DSH_DESKTOP_OMIT_LLAMA_WORKER=1` packages without it. A source launch other than the dev scripts must export `JAN_LLAMA_WORKER`.

The plugin no longer needs the engine artifact table, archive unpacking, the shared engine-install state, the mirror fallback, the pre-spawn port probe or the restart on model switch. `llm-pi-ai` gains a general `baseURLEnv` key that resolves a route's endpoint per request through the credential seam.

The preset is deliberately minimal; a later change ports Jan's full preset generator and GGUF metadata reading.
