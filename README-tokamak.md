# tokamak-harness

A fork of [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness). The DeepSeek account sign-in is replaced with **Tokamak sign-in**, using the same browser-approval flow as `jan login` in the Jan CLI. Models are served through the Tokamak router, which is OpenAI-compatible.

Current scope: Linux, web mode (`dsh web`).

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
