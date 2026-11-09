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

A new install with no usable model opens **Get started** with two choices:

- **Sign in with Tokamak**, the flow above. "Use an API key instead" pastes a key for the `tokamak` route.
- **Run a model on this computer**, the local model below. "Continue in background" closes the popup while it downloads; Settings → Models shows the progress.

The popup does not come back once either route can serve.

## Local model (llama.cpp)

One hardcoded model for now: **Jan v3.5 4B** (`janhq/Jan-v3.5-4B-gguf`, Q4_K_M, 2.7 GB, Apache-2.0), served by `llama-server` from llama.cpp build `b12211`. The harness:

1. Downloads the prebuilt llama.cpp engine for this machine from the GitHub release, falling back to GitHub's asset API when `releases/download` fails, and the model from Hugging Face. Both are pinned by sha256 and size. An interrupted download resumes from `*.partial`.
2. Unpacks the engine and starts `llama-server -m … --alias jan-v3.5-4b --host 127.0.0.1 --port 39281 -c 32768 --fit on --fit-target 1024 -fa on -ctk q8_0 -ctv q8_0 --jinja --no-webui`. A fresh random key per launch, passed through `LLAMA_API_KEY` (never on the command line), protects the server.
3. Once the server answers with that key, stores it as the `LLAMA_CPP_API_KEY` credential, and removes it again when the server stops, crashes or the app exits, so the route is usable exactly while the server runs. The `llm-pi-ai` `local` route reads it, and the model appears in the picker as **Local (llama.cpp) → Jan v3.5 4B (local)**. If the default model can't serve (no Tokamak key), the local model becomes the default.
4. Starts it again on the next launch if you left it running; Stop is remembered. Settings → Models → **Local model** has Start, Stop (also while it is loading) and Remove. Remove deletes the files.

Only the web app (and desktop) manages the server, so one process owns it. Other profiles (`dsh acp`, SDK subagents) can use the `local` route while the web app runs it.

**Auto fit.** llama.cpp's `--fit` sizes whatever is left unset to the memory available, keeping `fitTargetMiB` (1024 MiB) free per device. The GPU layer count is left to fit, so Metal and Vulkan builds offload as many layers as fit. The context stays pinned at 32k, because left to fit it starts from the model's full 262k-token training context: on a 32 GB machine fit kept all of it, which is far more memory than the harness needs. Settings on the `llama-cpp` row in the profile patch:

| Setting | Default | Effect |
|---|---|---|
| `ctxSize` | 32768 | `0` lets fit choose the context too, never below `fitCtx` (16384). Keep the `local` route's `contextWindow` no larger than the size the card reports. |
| `fit` | `true` | `false` passes `--fit off` and offloads every layer (or `gpuLayers`). |
| `gpuLayers` | unset | A fixed `-ngl`. |
| `cacheType` | `q8_0` | KV cache type; `f16` doubles its memory. |

The card shows the context the running server settled on.

Files live in `$DSH_HOME/llama-cpp/` (`engine/`, `models/`, `install.json`, `run.json`). The model URL is pinned to a Hugging Face commit, so a re-upload upstream can't break installs. Expect about 3 GB of disk and 5–6 GB of RAM. The 32k context is needed because the harness's system prompt and tools alone take about 12k tokens. On CPU the first reply in a session takes a while: the whole prompt has to be processed once, and later turns reuse the cache. Small local models call tools less reliably than Tokamak's.

| Variable | Purpose |
|---|---|
| `LLAMA_CPP_BACKEND=vulkan` | Linux/Windows: use the Vulkan build for GPU offload. Needs a Vulkan driver (`libvulkan1` plus Mesa or the vendor driver on Linux). |
| `LLAMA_CPP_MODEL=small` | Swap in Qwen3 0.6B (429 MB) for quick smoke tests. |

To change the port, set `port` on the `llama-cpp` row and the `local` route's `baseURL` together in your profile patch (`$DSH_HOME/profiles/web/cordis.patch.yml`).

The headless profile doesn't manage the model. Run `llama-server` yourself on port 39281 and export `LLAMA_CPP_API_KEY` with the key you gave it.

The Linux builds come from llama.cpp's Ubuntu CI and need glibc 2.35 or newer (Ubuntu 22.04+, Debian 12+). Older distributions fail to start the server, and the card shows the loader error.

The first-run chooser appears only while the Tokamak route can be offered. If that route is missing or read-only, the popup doesn't open, and the local model is still available from Settings → Models.

Engines by platform (llama.cpp `b12211`):

| Platform | Build | GPU |
|---|---|---|
| macOS Apple Silicon | `macos-arm64.tar.gz` (17 MB) | Metal, all layers offloaded |
| macOS Intel | `macos-x64.tar.gz` (12 MB) | CPU |
| Linux x64 / arm64 | `ubuntu-*.tar.gz` (19–23 MB) | CPU, or Vulkan with `LLAMA_CPP_BACKEND=vulkan` |
| Windows x64 / arm64 | `win-cpu-*.zip` (13–25 MB) | CPU, or Vulkan with `LLAMA_CPP_BACKEND=vulkan` |

Speed depends heavily on the hardware. On an 8-vCPU Linux VM without a GPU, the model reads about 16 prompt tokens/s, so the first reply waits about 13 minutes for the ~12k-token prompt. Apple Silicon with Metal is much faster. The `local` route waits up to 30 minutes for the first token instead of retrying.

Not yet: other models or a catalog, CUDA/ROCm builds, idle unload, engine updates, desktop.

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
- `SignInAttemptView.userCode`, an optional field. The sign-in dialog and the account page show it.
- Account UI strings say Tokamak. The balance card is hidden for accounts without wallets.
- Local model: new `packages/llm/llama-cpp` (download and supervise), `packages/api/llama-cpp-controller` (browser Remote), and `packages/client/ui-settings-local-model` (Models card and first-run option).
- `ui-settings-models`: the first-run step targets a configurable `onboardingRoute` (Tokamak here; upstream's DeepSeek route by default) and has become the **Get started** chooser, with a new `settings.models.local-setup` slot.

Some repository checks are expected to fail in this fork, because it doesn't follow upstream's release rules:
- Fork packages are `private` and don't have bilingual package READMEs.
- The disabled DeepSeek and telemetry packages count as unused.
- `TOKAMAK_BASE_URL` is inlined in the bundle YAML.

`pnpm run build` passes.

## Branding

The English UI says **Jan** instead of DeepSeek Harness, Tokamak Harness or DSH: the sidebar, browser title, PWA manifest, Preview Notice, Get started, account, plugin manager and Office preview copy. Other locales still carry the upstream name. The logo is Jan's waving hand (`web-app/public/images/jan-logo.png` from [janhq/jan](https://github.com/janhq/jan)), stored once in `ui-brand-official`, which puts it in the sidebar and home-hero mark slots. `pnpm --filter @deepseek-ai/dsh-web-frontend run render:app-icons` renders the favicons and PWA icons in `apps/web/public/` from it. The upstream pixel-whale home decoration is removed. CLI help text and package names are unchanged.

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
