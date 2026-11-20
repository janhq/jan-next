# tokamak-harness

A fork of [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness). The DeepSeek account sign-in is replaced with **Tokamak sign-in**, using the same browser-approval flow as `jan login` in the Jan CLI. Models are served through the Tokamak router, which is OpenAI-compatible.

Current scope: web mode (`dsh web`) on Linux and macOS. Windows should work but is untested.

## Quick start

```sh
corepack enable
pnpm install && pnpm run build
pnpm dsh web          # opens http://127.0.0.1:3080/?token=…
```

To sign in: Settings → Account → **Sign in**. A browser tab opens `https://tokamak.sh/cli/authorize?code=XXXX-XXXX`. Check that the code matches the one in the harness dialog, then click Approve. The harness polls Tokamak and receives an API key, which it checks with `GET /v1/models`. It stores the key in `$DSH_HOME/.credentials.yaml` (mode 0600) in two places:

- `records.tokamak-account/default`: the key plus its id, expiry and account email. Used for state and sign-out.
- `refs.TOKAMAK_API_KEY`: the credential the `tokamak` model route reads (`llm-pi-ai`, `apiKeyEnv: TOKAMAK_API_KEY`).

Signing out deletes both entries and revokes the key on the server (`DELETE /auth/api-keys/{id}`). If you had saved your own `TOKAMAK_API_KEY` on the Models page before signing in, sign-out puts that key back instead of deleting it.

Sign-in also works when the UI is opened from a LAN address or through a proxy. Without a loopback address the harness can't receive the browser's ping, so it just keeps polling until you approve.

The account page checks the key whenever it loads. If you deleted the key on tokamak.sh, or it has expired, the harness signs you out and asks you to sign in again.

If you already have a key, skip sign-in: `TOKAMAK_API_KEY=sk_live_… pnpm dsh web`, or save the key on the Models page.

## First run

A new install with no usable model opens **Get started**. The first and recommended choice is the local model:

- **Download a model to this computer** downloads Jan v3.5 4B (below) and starts it. The popup shows the download's progress with percent, bytes, speed and time left. "Continue in background" closes the popup while it downloads; Settings → Models shows the same progress.
- **Sign in with Tokamak**, the flow above, for frontier models in the cloud. "Use an API key instead" pastes a key for the `tokamak` route.

The popup does not come back once either route can serve.

The desktop app has its own welcome window instead of the popup. Its first button is **Download a local model**: it starts the same download and shows its progress in the welcome window, with "Continue in background" and, once the model runs, "Start chatting". "Sign in with Tokamak" and "Add API Key" follow. The welcome window is skipped once a local model is installed.

## Local model (llama.cpp)

The first-run model is **Jan v3.5 4B** (`janhq/Jan-v3.5-4B-gguf`, Q4_K_M, 2.7 GB, Apache-2.0), served by `jan-llama-worker`, a Rust executable that links llama.cpp build `b12359` and ships with the app ([`native/llama-worker`](native/llama-worker/README.md)). More models can be added from the model manager ([below](#model-manager)). The harness:

1. Downloads the model from Hugging Face, pinned by sha256 and size. An interrupted download resumes from `*.partial`. It then reads the file's GGUF header and refuses a vision projector or embedding model as the model file.
2. Writes a llama.cpp router preset to `run/preset.ini`: a `[*]` block with the settings below, one section per installed model named by its model id, and a `[local]` section holding only `alias-of = <default model id>`, and starts `jan-llama-worker --preset run/preset.ini --port 0 --models-max 1 --slot-cache-mib 0`. A fresh random key per launch, passed through `JAN_LLAMA_API_KEY` (never on the command line), protects the worker. The worker binds a port the OS chooses and prints it in a one-line JSON handshake on stdout.
3. Loads the default model with `POST /models/load`, then stores the worker's endpoint as the `LLAMA_CPP_BASE_URL` credential and the key as `LLAMA_CPP_API_KEY`, and removes both again when the worker stops, crashes or the app exits, so the route is usable exactly while the worker serves. The `llm-pi-ai` `local` route reads them through `baseURLEnv` and `apiKeyEnv`, and the picker lists **Jan v3.5 4B (local default)** (`local/local`) and **Jan v3.5 4B (local)** (`local/jan-v3.5-4b`). If the default model can't serve (no Tokamak key), `local/local` becomes the default.
4. Starts it again on the next launch if you left it running; Stop is remembered. Settings → Models → **Local model** has Start, Stop (also while it is loading) and Remove. Remove deletes the files.

Stop closes the worker's stdin; the worker stops accepting requests, gives in-flight ones up to 10 seconds, and exits. A worker still running after `stopTimeoutMs` (15 s) is terminated. A worker whose supervisor dies also exits, because its stdin reaches end of file.

Only the web app (and desktop) manages the worker, so one process owns it. Other profiles (`dsh acp`, SDK subagents) can use the `local` route while the web app runs it, because the endpoint and key are shared credentials.

**Worker location.** The `llama-cpp` row reads the executable from `workerPath`, set from `JAN_LLAMA_WORKER`. The desktop app sets it to `<resources>/llama-worker/jan-llama-worker`. `pnpm run dev:web` and `pnpm run dev:desktop` set it to `native/llama-worker/dist/jan-llama-worker`, which `pnpm run build:llama-worker` followed by `pnpm run stage:llama-worker` produces; other source launches (`pnpm dsh web`) need `JAN_LLAMA_WORKER` exported. Without a usable worker the card reports the failure at startup and nothing downloads.

**Auto fit.** llama.cpp's `fit` sizes whatever is left unset to the memory available, keeping `fitTargetMiB` (1024 MiB) free per device. The GPU layer count is left to fit, so builds with a GPU backend offload as many layers as fit. The context stays pinned at 32k, because left to fit it starts from the model's full 262k-token training context: on a 32 GB machine fit kept all of it, which is far more memory than the harness needs. A model trained with a shorter context is served at its trained context. Fit is off by default on macOS, where Metal counts the whole memory-mapped file against its working set and fit plans loads that then fail. Settings on the `llama-cpp` row in the profile patch:

| Setting | Default | Effect |
|---|---|---|
| `ctxSize` | 32768 | `0` lets fit choose the context too, never below `fitCtx` (16384). |
| `fit` | on (off on macOS) | `false` writes `fit = off` and offloads every layer (or `gpuLayers`). |
| `gpuLayers` | unset | A fixed `n-gpu-layers`; with fit on it also stops fit from sizing anything. |
| `cacheType` | `q8_0` | KV cache type; `f16` doubles its memory. |
| `flashAttn` | `on` | `auto` or `off`; `off` needs `cacheType: f16`. |
| `modelsMax` | 1 | Resident models the worker keeps loaded; loading another unloads the least recently used idle one. 1 matches Jan, because one model usually fills the GPU. 0 removes the bound. |
| `parallel` | unset | Requests decoded at once, each with the full context (`kv-unified = true`). |
| `batchSize`, `ubatchSize`, `threads` | unset | llama.cpp's `batch-size`, `ubatch-size` and `threads`. |
| `device`, `splitMode`, `mainGpu` | unset | Which GPUs to offload to and how to split across several. |
| `nCpuMoe`, `moeCacheMiB` | unset | Keep MoE expert weights in system memory, with an optional GPU cache for them (written only for models with experts). |
| `kvOffload` | `true` | `false` keeps the KV cache in system memory. |
| `mmprojOffload` | `true` | `false` writes `mmproj-offload = false`, keeping vision projectors in system memory. |
| `loadMode` | unset | `none`, `mmap`, `mlock` or `mmap+mlock`. |
| `cacheRamMiB` | unset | Prompt cache in system memory (`cache-ram`, llama.cpp default 8192). |
| `slotCacheMiB` | 0 | Disk budget for per-thread KV state in `slots/`; nothing is saved yet, because requests on the `local` route do not name their thread. |

The card shows the context the default model settled on, and each model's `contextWindow` on the `local` route follows the context the worker reported the last time it loaded that model, never more than the model's trained context.

**Fit to this machine.** At startup the plugin runs `jan-llama-worker --list-devices` once and reads system memory. The state then carries the offload backend (`vulkan`, `cuda`, `metal` or `cpu`), the devices with their memory, and for every curated, looked-up and installed model whether it `fits` on the GPU, is `tight` (needs system memory beside it, or little headroom on Apple Silicon) or is `too-large`. Downloads are judged by file size plus the projector downloaded with them; installed models add their projector and the KV cache at the configured context. The card shows the devices, backend and system memory, and a Fits, Tight fit or Too large badge on each model and file. As in Jan, the badge only warns: a model that is too large can still be downloaded and loaded.

Files live in `$DSH_HOME/llama-cpp/` (`models/<id>/`, `run/preset.ini`, `slots/`, `install.json`, `run.json`). The model URL is pinned to a Hugging Face commit, so a re-upload upstream can't break installs. Expect about 3 GB of disk and 5–6 GB of RAM. The 32k context is needed because the harness's system prompt and tools alone take about 12k tokens. On CPU the first reply in a session takes a while: the whole prompt has to be processed once, and later turns reuse the cache. Small local models call tools less reliably than Tokamak's.

| Variable | Purpose |
|---|---|
| `JAN_LLAMA_WORKER` | Absolute path of the `jan-llama-worker` executable the web app runs. |
| `LLAMA_CPP_MODEL=small` | Make Qwen3 0.6B (429 MB) the first-run model, for quick smoke tests. |

The headless profile doesn't manage the model. Run `jan-llama-worker` yourself and export `LLAMA_CPP_BASE_URL` (`http://127.0.0.1:<port>/v1`) and `LLAMA_CPP_API_KEY` with the key you gave it in `JAN_LLAMA_API_KEY`.

The first-run chooser appears only while the Tokamak route can be offered. If that route is missing or read-only, the popup doesn't open, and the local model is still available from Settings → Models.

The worker's GPU backends are Cargo features chosen when it is built (`engine-vulkan`, `engine-cuda`, `engine-hip`, `engine-metal`); the CPU backend is always present.

Speed depends heavily on the hardware. On an 8-vCPU Linux VM without a GPU, the model reads about 16 prompt tokens/s, so the first reply waits about 13 minutes for the ~12k-token prompt. Apple Silicon with Metal is much faster. The `local` route waits up to 30 minutes for the first token instead of retrying.

Not yet: GPU builds in CI, idle unload, multi-part (split) GGUF files, audio input, choosing among a repository's projectors.

### Model manager

Settings → Models → **Local model** lists:

- **Installed models.** Each row shows the fit badge, a Vision tag when the model reads images, architecture, context (the one the worker settled on, else the trained one), source and, while the worker runs, whether the model is Loaded, Loading… or Not loaded. "Load" and "Unload" load a model ahead of its first request or free its memory. "Make default" moves `local/local` to that model and loads it, without restarting the worker or reloading any other model. "Delete" removes a downloaded file after a confirmation, unloading it first; for an imported file it only removes the entry and leaves the file on disk. The worker refuses to unload a model that is answering a request, and the row says so.
- **Downloads** with the same progress line, Cancel (discards the partial file; a download interrupted by quitting the app keeps it and resumes), and the error with Retry and Dismiss when one fails. Downloads run one at a time.
- **Add a model.** A curated list, the same idea as Jan's hub: Jan v3.5 4B, Qwen3 4B Instruct 2507, Llama 3.2 3B Instruct, Qwen3 8B, Qwen3 0.6B and Qwen3 VL 2B Instruct (with its vision projector), each pinned to a Hugging Face commit and sha256. The search box filters it. Paste a Hugging Face repository (`unsloth/Qwen3-8B-GGUF`) or its link and "Look up on Hugging Face" lists the repository's single-file GGUF models with their size and quantization, Q4_K_M and IQ4_XS marked recommended. The Host reads the file list, size and LFS sha256 from `huggingface.co/api/models/<repo>?blobs=true` itself and pins the download to the current commit, so the browser never chooses a URL. Importance matrices (`imatrix*`), speculative-decoding drafts (`dflash-*`, `*-draft*`), split files and files without an LFS digest are left out. Projector (`mmproj`) files are not listed as models: as in Jan, downloading any file of the repository also downloads its projector, `mmproj-f16.gguf` (any case) if present, otherwise the first one, and the list names it.
- **Import a .gguf file.** Enter the full path of a GGUF file on the Host. Its GGUF header is read, a vision projector or embedding model is refused as the model, and the file is used where it is, without copying. An optional second path names the model's vision projector, which must be a GGUF file with `general.architecture = clip`; it is also used in place. Importing an already imported file with a projector replaces its projector.

The model picker lists every installed model as `local/<model id>`, so a session can use any of them and two sessions can use different ones; a model loads on its first request. `local/local` (`routeModelId` on the `llama-cpp` row) is an alias of the default model: the worker sends its requests to the default model's engine, so the file is never loaded twice, and sessions that picked it follow "Make default". The plugin keeps the route's model list in the `llm-pi-ai` settings section equal to the installed models (`routeNamespace` on the `llama-cpp` row; empty turns this off). With `modelsMax` at 1, a request for a model that is not loaded unloads the loaded one when it is idle; while it is answering, the worker refuses the request with HTTP 503. Making another model the default moves an agent default on a `local/<model id>` entry to `local/local`, and deleting the model an agent default names moves that default to `local/local`. That write puts the whole `providers` section into your profile patch (`$DSH_HOME/profiles/web/cordis.patch.yml`), so later bundle changes to those routes need that copy removed. Model ids come from the file name, e.g. `qwen3-0.6b-q4_k_m`.

`install.json` is version 3: the installed models (`file` relative to `llama-cpp/`, or absolute for an import) with the facts read from each file's GGUF header (architecture, trained context, chat template, expert count, quantization, KV cache size per token), and the default model's id (`active`). A model with a vision projector also records `mmproj`: its `file` (`models/<id>/mmproj-<sha256 prefix>.gguf` when downloaded, absolute when imported), size, sha256 when downloaded, and whether it encodes images. The preset gives such a model `mmproj = <path>`, and the `local` route lists it with `input: ['text', 'image']`, so image attachments reach it; other models list `['text']`. A projector that is missing or changed size at startup is dropped from its model with a warning, and the model stays. Deleting a model deletes a downloaded projector and leaves an imported one on disk. A model recorded under the id `local` moves to a free id at startup, because the alias takes that name. A version 1 or 2 file from an earlier build is converted at startup by reading each model's header; a model that is missing, unreadable or not a chat model is dropped from the list, and model files stay where they are. The `engine/` and `downloads/` directories earlier builds used for the downloaded `llama-server` are deleted at startup.

## Environment

| Variable | Purpose |
|---|---|
| `TOKAMAK_BASE_URL` | API base, default `https://api.tokamak.sh/v1`. A bare host gets `/v1` added. |
| `TOKAMAK_WEB_URL` | Web app origin for the approval page. Defaults to the API host with the `api.` / `api-` prefix removed. |
| `TOKAMAK_API_KEY` | Key used directly when nobody has signed in. |
| `TOKAMAK_ALLOW_LOOPBACK_HTTP` | Set to `1`/`true` to allow an `http://127.0.0.1` base URL, for the local mock. |

## Local mock (no Tokamak account needed)

```sh
pnpm tsx packages/credentials/tokamak-account/tests/mock-tokamak.ts 8787   # auto-approves sign-ins
TOKAMAK_BASE_URL=http://127.0.0.1:8787/v1 TOKAMAK_ALLOW_LOOPBACK_HTTP=1 pnpm dsh web
```

## What changed versus upstream

- New `packages/credentials/tokamak-account`. It implements the existing `deepseekAccount` service seam, so the account UI, controller and events work as before.
- `packages/bundle/base/cordis.patch.yml`:
  - The account row uses the Tokamak package.
  - `llm-pi-ai` gets a `tokamak` route, and the default model is `tokamak/tokamak-1-preview`.
  - The DeepSeek model routes and DeepSeek web search are disabled.
  - Web search uses the new `packages/web/web-search-exa`; see [Web search](#web-search).
- `SignInAttemptView.userCode`, an optional field. The sign-in dialog and the account page show it.
- Account UI strings say Tokamak. The balance card is hidden for accounts without wallets.
- Local model: new `packages/llm/llama-cpp` (download models and supervise the bundled `jan-llama-worker`), `packages/api/llama-cpp-controller` (browser Remote), and `packages/client/ui-settings-local-model` (Models card with the model manager, and the first-run option).
- `ui-settings-models`: the first-run step targets a configurable `onboardingRoute` (Tokamak here; upstream's DeepSeek route by default) and has become the **Get started** chooser, with a new `settings.models.local-setup` slot that it shows first.
- `llm-pi-ai`: its config check before a live update sees a route that stores a `!!js` value (the `tokamak` route's `baseURL`) as that route's current value. It used to reject every settings write to the section, which kept the picker on the bundle's model list.
- Desktop welcome: a **Download a local model** page (`apps/desktop/src/client/WelcomePage.tsx`, `welcome-backend.ts`), and `needsWelcome` counts an installed local model.

Some repository checks are expected to fail in this fork, because it doesn't follow upstream's release rules:
- Fork packages are `private` and don't have bilingual package READMEs.
- The disabled DeepSeek and telemetry packages count as unused.
- `TOKAMAK_BASE_URL` is inlined in the bundle YAML.

`pnpm run build` passes.

## Web search

`web_search` works without any key or account, through Exa's hosted MCP endpoint `https://mcp.exa.ai/mcp`, which is the same default as the Jan app. The `web-search-exa` row registers an `exa` search provider and an `exa` fetch provider. The base bundle selects `exa` for search and keeps the direct `http` provider for `web_fetch`. Both can be switched in **Plugins → Web search and fetch**. Each search query, and each URL read through the `exa` fetch provider, is sent to Exa. The hosted endpoint is rate-limited; a throttled call fails with "Exa rate-limited this request" instead of returning no results. Row config: `url`, `numResults` (default 5, at most 20), `maxCharacters` (default 40000) and `timeoutMs` (default 30000).

## Branding

The English UI says **Jan** instead of DeepSeek Harness, Tokamak Harness or DSH, and so do the package descriptions the Plugins page shows. The system prompt opens with "You are Jan, an AI agent." (`includeHarnessIdentity: false` plus `personaPrefix` on every bundle's `system-prompt` row) instead of upstream's DeepSeek Harness identity. Elsewhere in the English UI: the sidebar, browser title, PWA manifest, Preview Notice, Get started, account, plugin manager and Office preview copy. Other locales still carry the upstream name. The logo is Jan's waving hand (`web-app/public/images/jan-logo.png` from [janhq/jan](https://github.com/janhq/jan)), stored once in `ui-brand-official`, which puts it in the sidebar and home-hero mark slots. `pnpm --filter @deepseek-ai/dsh-web-frontend run render:app-icons` renders the favicons and PWA icons in `apps/web/public/` from it. The upstream pixel-whale home decoration is removed. The desktop shell has its own English copy in `apps/desktop/src/locale.ts` (menus, quit dialog, welcome window) and its own welcome logo (`apps/desktop/renderer/assets/welcome-brand.svg`); both say Jan. The development bundle that `pnpm run start:desktop` launches is named "Jan Alpha Dev" and uses the Jan logo as its Dock icon. The welcome window's "Add API Key" saves the Tokamak key. The packaged app's files carry no spaces (`JanAlpha.app`, executable `JanAlpha`, `JanAlpha.exe`); the macOS menu bar reads JanAlpha because Electron finds its helper apps by the bundle name, while Finder, About, quit copy, the installer and shortcuts read **Jan Alpha** with bundle identifier `com.janhq.jan-alpha` (the local default of `DSH_DESKTOP_APP_ID`), so it installs beside the Jan desktop app instead of replacing it, and uses Jan's app icon (`src-tauri/icons/icon.png` from janhq/jan, stored as `apps/desktop/resources/jan-icon.png`); `apps/desktop/scripts/render-jan-icons.ts` renders the macOS, Windows and generic icons and their SVGs from it, and `pnpm --filter @deepseek-ai/dsh-desktop run render:tray-icon` renders the Windows tray icon from the Windows SVG. Electron names its settings folder after the package name, so the rename does not move it; sessions stay in `~/.dsh`. Release artifact file names keep the upstream `deepseek-harness-…` pattern, which the release scripts parse. The sidebar shows "Jan" with an "Alpha" tag in every build instead of the local build number. CLI help text and package names are unchanged.

To build the macOS app locally: `pnpm --filter @deepseek-ai/dsh-desktop run package:mac:arm64:dir --unsigned`. The app lands in `apps/desktop/.desktop-build/targets/mac-arm64/unsigned-artifacts/mac-arm64/JanAlpha.app`. The local build packs the fork's private packages too (`apps/desktop/scripts/pack-local-packages.ts`).

## Telemetry

Everything that reports usage is unmounted in every profile:

- `session-telemetry-otel` (session-log export to DeepSeek's collector)
- `otel`
- `desktop-product-telemetry`
- `product-analytics`

The rows are `disabled: true` in the bundle YAML, not gated on environment variables. `/feedback` and message ratings are still recorded, but only into the local session log.

The account menu no longer links to DeepSeek's feedback form, which was a third-party Feishu page. The Plugins page no longer probes npm registries in the background. Plugins install from `registry.npmjs.org`, with no npmmirror fallback.

The web and CLI profiles have no update checker. Desktop auto-update (download.deepseek.com) is out of scope, because the desktop app isn't built for Linux. The plugin market contacts npm registries, and the experimental translator contacts Google Translate, but only when you use those features.

## Other profiles

- `dsh acp` defaults to the Tokamak route.
- `dsh headless` reads only launch-time credentials, by upstream design. Export `TOKAMAK_API_KEY` to use it.

## Pulling upstream

```sh
git fetch upstream && git merge upstream/master
```

Most of the fork lives in its own package, plus YAML rows marked `tokamak-harness:`. That keeps conflicts small.
