---
description: "The Tokamak account provider: CLI device sign-in that mints a Tokamak API key, stores it as the credential the tokamak model route reads, and serves the account Service Definition."
kind: "package-reference"
---

# @janhq/jan-tokamak-account

## Summary

`jan-tokamak-account` defines the account Service Definition (`ctx.tokamakAccount`) and provides it through Tokamak's CLI device sign-in. Sign-in opens Tokamak's approval page, polls until the user approves, and receives a long-lived API key. The provider stores that key as its own grant record and as the `TOKAMAK_API_KEY` credential reference, which the `tokamak` model route in `jan-llm-pi-ai` resolves per request. The account controller and Settings account UI consume the service; this package registers no model-facing content.

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

Mount the provider after `jan-authorization` and a credentials provider; it injects `credentials` and `authorization`, and uses `webServer` only when it is mounted. The base bundle mounts it with endpoints derived from `TOKAMAK_BASE_URL` and `TOKAMAK_WEB_URL`:

```yaml
- id: tokamak-account
  name: '@janhq/jan-tokamak-account'
  config:
    apiBaseURL: https://api.tokamak.sh/v1
```

| Field | Default | Meaning |
|---|---|---|
| `apiBaseURL` | `https://api.tokamak.sh/v1` | OpenAI-compatible API base; a bare host gets `/v1`. Must be HTTPS unless `allowLoopbackHttp` permits loopback HTTP |
| `webOrigin` | `''` | Origin hosting `/cli/authorize`; empty derives it from `apiBaseURL` by stripping an `api.` host prefix |
| `clientName` | `Tokamak Harness` | Name shown on the approval page and on the minted key |
| `apiKeyRef` | `TOKAMAK_API_KEY` | Credential reference the model route reads |
| `modelProvider` | `tokamak` | Model route whose running tasks sign-out cancels |
| `allowLoopbackHttp` | `false` | Permit `http:` on `localhost`, `127.0.0.1`, or `[::1]` for local mocks |
| `requestTimeoutMs` | `30,000` | Deadline for each HTTP request |
| `attemptTimeoutMs` | `600,000` | Upper bound for one sign-in attempt, even when the server advertises a longer lifetime |

An invalid `apiBaseURL` throws at construction. The generated [configuration catalog](../../../docs/config-catalog.md) lists every accepted field.

### Sign-in, sign-out, and expiry

`startSignIn` returns the current attempt instead of starting a second one while an attempt is active. When the requesting UI is served from a loopback origin, the approval page redirects to a one-shot `/done` route on that origin to wake the poller early; no secret travels through the redirect. Approval writes the grant and the `apiKeyRef` credential; a hand-saved key that sign-in replaced is kept in the grant and restored on sign-out.

`signOut` cancels an active attempt, removes the grant and the credential it wrote, requests best-effort server-side revocation, cancels running tasks on the `modelProvider` route, and emits `tokamak-account/signed-out`. A credential that came from the environment or that the user changed after sign-in is left unchanged.

At startup, a stored key minted by a different API origin is removed and revoked at that origin, an expired key is removed, and a key that expires within seven days logs a warning. `getProfile` removes a key that Tokamak rejects with HTTP 401 or 403 and emits `tokamak-account/session-expired`; outages are not treated as rejection. `getBalance` returns an empty ready result because this provider has no wallet API.

`resolveToken(url)` returns the stored key only for URLs on the API origin that minted it.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

| File | Role |
|---|---|
| [`src/account.ts`](src/account.ts) | The `TokamakAccount` Service Definition, its events, and the Host-only Platform session type |
| [`src/index.ts`](src/index.ts) | `TokamakAccountProvider`: configuration, attempt lifecycle, grant storage, sign-out, and revocation |
| [`src/protocol.ts`](src/protocol.ts) | Device sign-in wire protocol: PKCE session creation, polling, key verification, and revocation |
| [`src/account-tasks.ts`](src/account-tasks.ts) | Running-task detection and cancellation for the account's model route |
| [`src/types.ts`](src/types.ts) | Account view, profile, balance, and sign-in attempt types |

The authorization flow registered with `ctx.authorization` owns the attempt's cancellation; the provider records attempt phases (`initializing` through `succeeded`, `failed`, `expired`, or `cancelled`) and notifies `watch` consumers after each change.

-----

<a id="further-exploration"></a>
## Further Exploration

- [Credentials subsystem](../../../docs/subsystems/credentials.md) — credential references, records, and authorization flows.
- [jan-api-account-controller](../../api/account-controller/README.md) — the Remote commands and snapshot stream that expose this service to the Client.
- [Account sign-out decision](../../../.agents/notes/implemented/architecture/2026-09-17-account-provider-signout.md) — why sign-out owns task cancellation.

-----

<a id="model-experience"></a>
## Model Experience

None, as account credentials affect HTTP authentication only and never enter model prompts, Session logs, or tool results.

#### KV Cache effect

No model request prefix changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Device sign-in only** — a deployment without the CLI session routes (HTTP 404 or 405) fails sign-in; the user must save an API key instead.
- **No profile or balance data** — Tokamak exposes no profile or wallet API to this provider, so the profile shows the stored account label and balance widgets stay empty.
- **Revocation is best effort** — a failed server-side revocation logs a warning; the local key is removed regardless.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
