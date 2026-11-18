---
description: "Keyless search and fetch backends for ctx.web through Exa's hosted MCP endpoint: how deployments mount them and what Exa returns."
kind: "package-reference"
---

# @janhq/jan-web-search-exa

## Summary

With `jan-web-search-exa`, the web service (`ctx.web`) can search the web and read pages through Exa's hosted MCP endpoint without an account or API key. The package registers one search provider and one fetch provider, both under the id `exa`, and both are available on every model route. Queries and fetched URLs are sent to Exa, which rate-limits keyless use. The model-facing `web_search` and `web_fetch` tools live in `jan-tool-web`.

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

Mount the providers in a composition that loads the web service. The web service selects `exa` automatically when it is the only usable backend of a kind; otherwise pin it with `searchProvider: exa` or `fetchProvider: exa`.

```yaml
- name: '@janhq/jan-web'
- name: '@janhq/jan-web-search-exa'
```

| Field | Default | Meaning |
|---|---|---|
| `url` | `https://mcp.exa.ai/mcp` | Exa MCP endpoint; a value that is not a URL fails at plugin load |
| `numResults` | `5` | Results requested when the caller sets no bound, from 1 to 20 |
| `maxCharacters` | `40,000` | Characters of page text one fetch requests |
| `timeoutMs` | `30,000` | Milliseconds one search or fetch may take |

The generated [configuration catalog](../../../docs/config-catalog.md) lists every accepted field.

### What the providers return

A search returns one source per Exa result, in Exa's order, with its URL, title, publication date, and highlights; the snippet is the first 300 characters of the highlights. A result without a parseable URL is dropped. A caller's `maxResults` is clamped to 1 through 20.

A fetch accepts only `http:` and `https:` URLs and returns Exa's extracted page text as a `text` body. Exa reports no HTTP status for the page, so a returned page reports status 200. The result is marked truncated when the text reaches `maxCharacters`.

### Failures

Failures throw `WebError`: `WEB_INVALID_URL` for a non-HTTP fetch URL, `WEB_ABORTED` on caller cancellation, `WEB_PROVIDER_TIMEOUT` after `timeoutMs`, and `WEB_PROVIDER_ERROR` for transport, HTTP, JSON-RPC, tool, oversized-reply, and rate-limit failures. Exa answers a rate-limited call with HTTP 200 and a flag in the reply metadata; the provider reports it as `WEB_PROVIDER_ERROR` instead of an empty result.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

Each operation is one stateless JSON-RPC `tools/call` POST naming Exa's `web_search_exa` or `web_fetch_exa` tool. Redirects are rejected, replies over 4 MiB are refused, and the reply body may be either a JSON object or a single-message SSE stream.

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: config schema, URL validation, provider registration |
| [`src/provider.ts`](src/provider.ts) | JSON-RPC transport, reply parsing, search-text parsing, and the two providers |

-----

<a id="further-exploration"></a>
## Further Exploration

- [Web subsystem](../../../docs/subsystems/web.md) — the search and fetch request and result vocabulary and error codes.
- [Web package map](../README.md) — the web package family and each role.
- [jan-tool-web](../tool-web/README.md) — the model-facing tools that render these providers' results.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through `jan-tool-web`, which renders this provider's search sources and fetched page text under its own result wrappers.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Third-party data flow** — every query and fetched URL is sent to Exa; a deployment that must not disclose them needs another provider.
- **Keyless rate limits** — Exa throttles keyless use, and the package has no API-key configuration to raise the limit.
- **No page status** — fetches always report status 200, so a missing or error page is visible only in the returned text.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
