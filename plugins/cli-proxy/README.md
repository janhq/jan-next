# Jan subscriptions

Open **Settings > AI Models > Bring your own subscription**, choose a provider, and complete sign-in in your browser. A provider may display a device code to enter in the browser. Once connected, supported chat models appear under **Subscriptions (CLIProxyAPI)** in Jan's model picker. No API key is required. The Local proxy card displays the release Jan uses. Sign out here to remove Jan's local copy of the account; this does not revoke the provider's grant or cancel your subscription.

## Placement

`@janhq/jan-cli-proxy` is private, plain JavaScript shipped as source in `plugins/cli-proxy`. It uses the authenticated plugin API, the LLM adapter registry, and the `settings.models.setup-subscription` slot. Its browser contribution also registers Settings search and redirects the old `jan-cli-proxy` section id. The desktop bundle mounts the plugin; the published `@janhq/jan-web-app` bundle does not.

## Runtime

Jan downloads only the pinned `v8.1.2` archive for the Host's OS and CPU on first use or when restoring saved accounts. Windows uses ZIP; macOS and Linux use TAR.GZ. Linux uses the upstream no-plugin builds. Jan verifies the archive against the SHA-256 recorded from the release checksums before extracting only the executable. The executable, private config and OAuth files are under `$JAN_HOME/cli-proxy/` (0600 config and a private auth directory on filesystems supporting POSIX permissions). Jan launches `cli-proxy-api --config <path> --local-model`; the latter uses the pinned embedded catalogs. Jan supervises the process, retries unexpected exits with backoff, and stops it when the plugin unloads.

The proxy listens only on `127.0.0.1`, with separate random management and inference keys regenerated each launch. Discovery, management panel downloads and upstream plugin loading are disabled. Jan calls the [v8 management API](https://github.com/router-for-me/CLIProxyAPI/blob/v8.1.2/docs/management-api-v8.md) to start, check and cancel OAuth (`GET /oauth/auth-url`, `GET /oauth/status`, `DELETE /oauth/session`) and list or delete accounts (`GET` or `DELETE /credentials`). Jan uses its own temporary loopback listener for fixed-port browser redirects rather than enabling CLIProxyAPI's wildcard callback forwarder. A browser sign-in requiring a loopback redirect must run on the Host machine; another local application already on the provider's fixed port must be closed first.

Jan fetches `GET /v1/models` with the inference key and registers or updates one `cli-proxy` adapter using the regular LLM catalog notification. Claude models use Messages, OpenAI models use Responses, and other chat models use Chat Completions. The route is removed after the last account signs out or if the proxy exits. CLIProxyAPI v8.1.2 supports Claude, ChatGPT (Codex), Google Antigravity, Grok, Kimi Code, GitHub Copilot, Devin and Meta Muse sign-in. It does not offer standalone Gemini CLI OAuth. Availability, quotas, and use of third-party clients remain subject to each provider's terms and account plan.

## Model experience

The proxy is used only after selecting a subscription model. It uses Jan's existing pi-ai transcript conversion and streaming, adds no prompt tokens, and makes no guarantee about upstream token limits, billing, or KV reuse. Upstream model IDs come from the proxy. The installed pi-ai catalog describes matching models; unrecognized models use text-only descriptors with estimated limits, because the proxy's OpenAI listing does not expose capability or size metadata. The UI does not transmit proxy keys or OAuth tokens.

## Origin

[CLIProxyAPI v8.1.2](https://github.com/router-for-me/CLIProxyAPI/releases/tag/v8.1.2), [MIT](https://github.com/router-for-me/CLIProxyAPI/blob/v8.1.2/LICENSE). Jan downloads its unmodified release executable. The pinned release also supplies the provider marks in `assets/logo/`, rendered in the text foreground; marks belong to their respective owners. The Go source is not bundled in Jan.
