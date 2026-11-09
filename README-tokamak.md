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
2. Unpacks the engine and starts `llama-server -m … --alias jan-v3.5-4b --host 127.0.0.1 --port 39281 -c 32768 -fa on -ctk q8_0 -ctv q8_0 --jinja --no-webui`. A random key passed through `LLAMA_API_KEY` (never on the command line) protects the server.
3. Stores that key as the `LLAMA_CPP_API_KEY` credential. The `llm-pi-ai` `local` route reads it, and the model appears in the picker as **Local (llama.cpp) → Jan v3.5 4B (local)**. If the default model can't serve (no Tokamak key), the local model becomes the default.
4. Starts it again on each launch. Settings → Models → **Local model** has Start, Stop and Remove. Remove deletes the files and the key.

Files live in `$DSH_HOME/llama-cpp/` (`engine/`, `models/`, `install.json`). Expect about 3 GB of disk and 5–6 GB of RAM. The 32k context is needed because the harness's system prompt and tools alone take about 12k tokens. On CPU the first reply in a session takes a while: the whole prompt has to be processed once, and later turns reuse the cache. Small local models call tools less reliably than Tokamak's.

| Variable | Purpose |
|---|---|
| `LLAMA_CPP_BACKEND=vulkan` | Linux/Windows: use the Vulkan build for GPU offload. Needs a Vulkan driver (`libvulkan1` plus Mesa or the vendor driver on Linux). |
| `LLAMA_CPP_MODEL=small` | Swap in Qwen3 0.6B (429 MB) for quick smoke tests. |

To change the port, set `port` on the `llama-cpp` row and the `local` route's `baseURL` together in your profile patch (`$DSH_HOME/profiles/web/cordis.patch.yml`).

The headless profile doesn't manage the model. Run `llama-server` yourself on port 39281 and export `LLAMA_CPP_API_KEY` with the key you gave it.

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
