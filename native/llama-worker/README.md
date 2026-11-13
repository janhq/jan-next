# jan-llama-worker

English | [中文](README.zh.md)

## Summary

`jan-llama-worker` is a standalone Rust executable that links llama.cpp and serves OpenAI-compatible HTTP on a loopback port. A supervisor starts one worker process, reads a single JSON handshake line from its stdout, sends requests with a bearer token, and stops it by closing its stdin. The process boundary contains `GGML_ASSERT` aborts and GPU driver faults, so a failed model costs the worker rather than its supervisor. The crate is not part of the pnpm workspace, and no install or build script compiles it.

## Table of Contents

- [Build](#build)
- [Pinned llama.cpp](#pinned-llamacpp)
- [Command line](#command-line)
- [Handshake](#handshake)
- [HTTP API](#http-api)
- [Shutdown and exit codes](#shutdown-and-exit-codes)
- [Dev Note](#dev-note)

## Build

The build needs a stable Rust toolchain, CMake 3.14 or later, a C++17 compiler, and git. `ccache` or `sccache` is used when found. Each GPU backend adds its own toolchain: Vulkan needs the Vulkan headers, loader, and `glslc`; CUDA needs `nvcc`; HIP needs ROCm with rocWMMA; Metal needs Xcode. Windows builds need Ninja and clang-cl.

From the repository root, `pnpm run build:llama-worker` fetches the pinned llama.cpp and builds the CPU worker in release mode. Extra Cargo arguments are appended to `cargo build`; for example, `pnpm run build:llama-worker --features engine-vulkan` adds the Vulkan backend. From this directory, run `scripts/fetch-llama-cpp.sh` once and then `cargo build --release --features <features>`.

| Cargo feature | Adds |
|---|---|
| `engine` | llama.cpp, the C++ shim, and multi-variant CPU backends; required by the binary |
| `engine-vulkan` | the Vulkan backend module |
| `engine-cuda` | the CUDA backend module, for the CUDA major version of the `nvcc` found |
| `engine-hip` | the HIP backend module |
| `engine-metal` | the Metal backend module |

The binary is written to `target/release/jan-llama-worker`. ggml is built as shared libraries plus runtime-loaded backend modules under the build script's output directory. The binary finds them through its run path and a compiled-in build-tree directory, so it runs in place but cannot be moved on its own.

`pnpm run stage:llama-worker`, or `scripts/stage.sh [<dir>]` from this directory, copies the release binary, `libggml`, `libggml-base`, and every `ggml-*` backend module of the build that binary was linked against into one directory, `dist/` by default, and fails when the binary, its ggml prefix, or a backend module is missing. ggml loads backend modules from the executable's directory, and the libraries resolve through the `$ORIGIN` run path on Linux, `@loader_path` on macOS, and the executable's directory on Windows, so the staged directory runs from any location. The script removes the absolute build-tree run paths from the staged binary with `install_name_tool` on macOS and with `patchelf` on Linux when it is installed; without `patchelf` they remain after `$ORIGIN`, so the staged ggml libraries still take precedence. The desktop package copies `dist/` to `<resources>/llama-worker/`, so the packaged worker is `<resources>/llama-worker/jan-llama-worker` (`.exe` on Windows); packaging fails when `dist/` has no worker unless `DSH_DESKTOP_OMIT_LLAMA_WORKER=1`.

| Build variable | Effect |
|---|---|
| `JAN_LLAMA_CPP_DIR` | Builds against an existing llama.cpp checkout instead of `vendor/llama.cpp` |
| `JAN_ENGINE_BUILD_LOG` | Appends CMake output to this file for live progress |
| `JAN_ENGINE_BUILD_DIR` | Places the CMake build trees under this directory |
| `JAN_ENGINE_CUDA_ARCHS` | Overrides `CMAKE_CUDA_ARCHITECTURES` |
| `JAN_ENGINE_HIP_TARGETS` | Overrides the HIP `GPU_TARGETS` list |

## Pinned llama.cpp

`build.rs` declares the pin in `LLAMA_CPP_TAG`, `LLAMA_CPP_COMMIT`, `LLAMA_CPP_BUILD_NUMBER`, and `LLAMA_CPP_VERSION`; the crate version equals `LLAMA_CPP_VERSION`. The current pin is tag `b12110`, llama.cpp version 0.9.0, at commit `cd959bae99ff4bed22bef2604f45241c09bbb8c8`. llama.cpp source is never committed: `scripts/fetch-llama-cpp.sh` reads the tag and commit from `build.rs`, shallow-clones the tag from the upstream GitHub repository into the ignored `vendor/llama.cpp`, and fails unless `HEAD` equals the pinned commit. At startup the worker compares the linked llama.cpp build number with the pin and exits with code 3 on a mismatch.

To move the pin, update all four constants and the crate version together, delete `vendor/llama.cpp`, and rerun the fetch script. Unit tests reject a crate version, compiled-in constant, or fetch script that disagrees with `build.rs`. A CUDA build additionally fails when upstream's default CUDA architecture list no longer matches the list `build.rs` derives.

## Command line

| Invocation | Behavior |
|---|---|
| `jan-llama-worker --preset <ini> [--port N] [--models-max N] [--slot-cache-mib N]` | Serves the preset's models; port 0, the default, lets the OS choose |
| `jan-llama-worker` | Serves with no registered models |
| `jan-llama-worker --list-devices` | Prints the offloadable devices as one JSON array and exits |
| `jan-llama-worker --diagnose [--diagnose-preset quick\|full\|model] [--diagnose-plan JSON] [--device NAME]...` | Runs the ggml op diagnostic and prints one JSON event per line |
| `jan-llama-worker --version` | Prints the pinned llama.cpp tag |

`--models-max` bounds the number of resident models; it defaults to 1, and 0 removes the bound. Loading past the bound evicts the least recently used idle model, and a request that needs another model while every resident model is busy gets HTTP 503. `--slot-cache-mib` bounds the per-thread KV cache directory named by `slot-save-path` and defaults to 0, which disables saving. `--diagnose-run`, `--diagnose-devices`, and `--diagnose-ops` start the leaf processes that `--diagnose` supervises.

The preset is the llama.cpp router preset INI format. Each section other than `[*]` registers one model whose id is the section name; `[*]` holds defaults applied to every section, and a section's own keys override them. Keys are llama.cpp server option names without leading dashes, such as `model`, `ctx-size`, `n-gpu-layers`, `device`, `flash-attn`, `cache-type-k`, `cache-type-v`, `fit`, and `split-mode`; unknown keys are ignored. The worker itself reads `slot-save-path` from `[*]` and creates that directory before serving. Models load on the first request that names them or on `POST /models/load`.

The bearer token is read from the `JAN_LLAMA_API_KEY` environment variable and removed from the process environment; an empty or unset value disables authentication.

## Handshake

Once the listener is bound, the worker prints exactly one JSON line to stdout and flushes it; serving mode prints nothing else to stdout.

```json
{"port":39271,"pid":1234,"models":["a","b"],"cuda_toolkit":null,"devices":[{"id":"Vulkan0","name":"AMD Radeon"}]}
```

`models` lists the preset section names, sorted. `cuda_toolkit` is the `major.minor` CUDA version a CUDA build was compiled with, otherwise `null`. `devices` lists the devices this process initialised, or is `null` when they could not be read; an empty array means the machine has no offload device.

## HTTP API

The worker listens on `127.0.0.1` and checks `Authorization: Bearer <key>` on every request.

| Method and path | Purpose |
|---|---|
| `GET /v1/models`, `GET /models` | Every registered model with its llama.cpp router `status` and a `busy` flag |
| `GET /models/sse` | Server-sent model lifecycle events with load progress |
| `POST /models/load`, `POST /models/unload` | Loads or unloads `{"model": id}` |
| `POST /models/reload` | Re-reads `{"preset_path", "models_max"?}` and reloads only changed models |
| `POST /slots/state/erase` | Deletes saved KV state for `{"thread"}` or `{"model"}` |
| `POST /v1/chat/completions`, `/v1/completions`, `/v1/embeddings`, `/rerank`, `/tokenize`, `/detokenize`, `/apply-template` | llama.cpp's own handlers, streaming included |
| `GET /health`, `GET /props`, `GET /slots` | llama.cpp's own handlers |

A request picks its model from the body's `model` field, or from the `model` query parameter; without one, any resident model answers. A `thread_id` field in a completion request enables per-thread KV state reuse and is removed before llama.cpp sees the body.

## Shutdown and exit codes

The worker stops when its stdin reaches end of file, and on Unix also on SIGTERM. It then stops accepting connections, gives in-flight requests up to 10 seconds, saves resident thread KV state, releases every model, and exits 0. Bytes written to stdin are ignored. A force-killed worker skips the KV save and model release. `--diagnose` cancels the same way.

| Code | Meaning |
|---|---|
| 2 | Invalid arguments |
| 3 | The linked llama.cpp is not the pinned build |
| 4 | The preset could not be read |
| 5 | The listener could not be bound |
| 6 | `--list-devices` could not enumerate devices |
| 7 | The `slot-save-path` directory could not be created |
| 8, 9, 10 | Diagnostic setup failure, lost reader, or leaf deadline |

## Dev Note

`cargo test` and `cargo clippy --all-targets` run without CMake: only the `engine` feature compiles llama.cpp, and the HTTP, preset, registry, KV state, and diagnostic orchestration logic is tested without it. `cargo test --features engine` additionally runs the shim, op diagnostic, and worker process tests; the model-backed cases in `tests/engine_smoke.rs` and `tests/worker_http.rs` run only when `JAN_TEST_GGUF` names a small GGUF file. `src/sys.rs` is the crate's only `unsafe` code.
