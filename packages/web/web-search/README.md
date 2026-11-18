---
description: "Exa, Tavily, SearXNG, and You.com search and fetch backends for ctx.web: how deployments mount and configure them, which keys or instance each needs, and what each returns."
kind: "package-reference"
---

# @janhq/jan-web-search

## Summary

With `jan-web-search`, the web service (`ctx.web`) can search the web and read pages through the four backends of the Jan app's web search plugin. Each registers under its own id: Exa (`exa`) and You.com (`you`) work without an account and use their REST APIs once an API key is set, Tavily (`tavily`) needs an API key, and SearXNG (`searxng`) searches a self-hosted instance. Queries and fetched URLs are sent to the selected backend. The model-facing `web_search` and `web_fetch` tools live in `jan-tool-web`.

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

Mount the package in a composition that loads the web service. Several backends register at once, so the web service cannot auto-select: pin each capability with `searchProvider` and `fetchProvider`, or list one backend in `providers`. The **Web search provider** and **Web fetch provider** menus on the **Web search and fetch** settings page list every registered backend.

```yaml
- name: '@janhq/jan-web'
  config:
    searchProvider: exa
    fetchProvider: exa
- name: '@janhq/jan-web-search'
```

| Backend | Id | Search | Fetch | Without a key | Credential reference |
|---|---|---|---|---|---|
| Exa | `exa` | yes | yes | Keyless hosted endpoint, rate-limited | `exa.apiKeyEnv` (`EXA_API_KEY`) |
| Tavily | `tavily` | yes | yes | Not ready; calls fail naming the reference | `tavily.apiKeyEnv` (`TAVILY_API_KEY`) |
| SearXNG | `searxng` | yes | no | Needs no key; needs `searxng.url` | none |
| You.com | `you` | yes | yes | Keyless free tier; PDFs cannot be read | `you.apiKeyEnv` (`YDC_API_KEY`) |

| Field | Default | Meaning |
|---|---|---|
| `providers` | `[exa, tavily, you]` | Backends to register; listing `searxng` requires `searxng.url`, and an unknown, empty, or repeated list fails at load |
| `exa.mcpUrl` | `https://mcp.exa.ai/mcp` | Keyless Exa MCP endpoint |
| `exa.apiUrl` | `https://api.exa.ai` | Exa REST base URL; `/search` and `/contents` are appended |
| `exa.apiKeyEnv` | `EXA_API_KEY` | Credential reference for the Exa API key |
| `exa.searchTextCharacters` | `800` | Characters of page text each keyed Exa result carries as its summary |
| `tavily.apiUrl` | `https://api.tavily.com` | Tavily REST base URL; `/search` and `/extract` are appended |
| `tavily.apiKeyEnv` | `TAVILY_API_KEY` | Credential reference for the Tavily API key |
| `searxng.url` | (unset) | Base URL of a SearXNG instance with the `json` format enabled; `/search` is appended |
| `you.mcpUrl` | `https://api.you.com/mcp?profile=free` | Keyless You.com MCP endpoint, used for search |
| `you.extractUrl` | `https://api.you.com/v1/extract` | Keyless You.com extraction endpoint, used for fetch |
| `you.apiUrl` | `https://ydc-index.io` | You.com REST base URL; `/v1/search` and `/v1/contents` are appended |
| `you.apiKeyEnv` | `YDC_API_KEY` | Credential reference for the You.com API key |
| `you.userAgent` | `jan-web-search (+https://github.com/janhq/jan-next)` | `User-Agent` sent to You.com |
| `numResults` | `5` | Results requested when the caller sets no bound, from 1 to 20 |
| `maxCharacters` | `40,000` | Characters of page text one fetch returns |
| `timeoutMs` | `30,000` | Milliseconds one search or fetch may take |

Every URL must be `http:` or `https:` and every credential reference an environment-variable name; an invalid value fails at plugin load. The generated [configuration catalog](../../../docs/config-catalog.md#janhqjan-web-search) lists every accepted field.

### API keys

Each operation resolves the backend's credential reference through `ctx.credentials`, or through the launch environment when the composition mounts no credential service. A stored or exported key applies to the next search or fetch without a restart; an unset or blank key selects the keyless endpoint for Exa and You.com. A Tavily provider without its key reports not ready, so `jan-tool-web` withholds the tool it serves. Requests that carry a key never follow a redirect; SearXNG requests carry none and follow the instance's redirects.

### What the providers return

| Backend | Search without a key | Search with a key | Fetch without a key | Fetch with a key |
|---|---|---|---|---|
| Exa | MCP tool `web_search_exa` | `POST /search` | MCP tool `web_fetch_exa` | `POST /contents` |
| Tavily | (fails) | `POST /search` | (fails) | `POST /extract` |
| SearXNG | `GET /search?format=json` | (no key) | (not registered) | (not registered) |
| You.com | MCP tool `you-search` | `POST /v1/search` | `POST /v1/extract` | `POST /v1/contents` |

A search returns one source per result, in the backend's order, with its URL, title, publication date, an excerpt as the summary, and the excerpt's first 300 characters as the snippet. Exa's excerpt is its highlights; with a key, the snippet is the first highlight and the summary the page text. Tavily's and SearXNG's excerpt is the result `content`. You.com's excerpt is the result description, or its keyword snippets when it has none, and only its `web` results count. A result without a parseable URL is dropped. A caller's `maxResults` is clamped to 1 through 20; SearXNG has no count parameter, so its reply is cut to that count.

A fetch accepts only `http:` and `https:` URLs and returns the backend's extracted page text, Markdown for You.com, as a `text` body cut to `maxCharacters`. Backends report no HTTP status for the page, so a returned page reports status 200. The result is marked truncated when the text was cut or, for Exa, reached `maxCharacters`.

### Failures

Failures throw `WebError`: `WEB_INVALID_URL` for a non-HTTP fetch URL, `WEB_ABORTED` on caller cancellation, `WEB_PROVIDER_TIMEOUT` after `timeoutMs`, and `WEB_PROVIDER_ERROR` for missing keys and for transport, redirect, HTTP, JSON, JSON-RPC, tool, oversized-reply, empty-page, and rate-limit failures. Messages name the next step: a missing or rejected key (HTTP 401 or 403) names its credential reference, a throttled call (HTTP 429, or a keyless reply flagged rate-limited) asks for a later retry, a SearXNG reply that is not JSON points at the instance's `search.formats` setting, and a refused keyless You.com extraction (a PDF, or a spent free allowance) names `YDC_API_KEY` or another fetch provider. An empty extraction reports Tavily's or Exa's failure reason when the backend gave one.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

Each operation is one JSON POST, or one GET for SearXNG, with a deadline and the caller's signal. Replies over 4 MiB are refused and every JSON reply is validated before it is read. MCP calls are stateless `tools/call` requests whose reply is a JSON object or an SSE stream; frames without `result` or `error` are skipped. Requests to You.com also carry an `x-client-info` attribution naming this package's version and the Node.js version.

The providers port the backends of the Jan app's `tauri-plugin-websearch`; the package keeps that plugin's [Apache-2.0 license](LICENSE), unlike the rest of the repository.

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: provider registration per configured backend |
| [`src/config.ts`](src/config.ts) | Config schema and its resolution into per-backend specs |
| [`src/credentials.ts`](src/credentials.ts) | Per-operation API-key lookup |
| [`src/transport.ts`](src/transport.ts) | JSON POST and GET, error mapping, and MCP reply reading |
| [`src/shape.ts`](src/shape.ts) | Result-count clamping, snippets, and page bounds |
| [`src/exa.ts`](src/exa.ts) | Exa providers and reply normalization |
| [`src/tavily.ts`](src/tavily.ts) | Tavily providers and reply normalization |
| [`src/searxng.ts`](src/searxng.ts) | SearXNG search provider and reply normalization |
| [`src/you.ts`](src/you.ts) | You.com providers and reply normalization |

-----

<a id="further-exploration"></a>
## Further Exploration

- [Web subsystem](../../../docs/subsystems/web.md) — the search and fetch request and result vocabulary and error codes.
- [Web package map](../README.md) — the web package family and each role.
- [Credentials subsystem](../../../docs/subsystems/credentials.md) — how credential references resolve.
- [jan-tool-web](../tool-web/README.md) — the model-facing tools that render these providers' results.
- [jan-web-fetch-http](../web-fetch-http/README.md) — the anonymous fetch provider to pair with SearXNG search.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through `jan-tool-web`, which renders these providers' search sources and fetched page text under its own result wrappers.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No key or instance fields in Settings** — the **Web search and fetch** page selects providers but cannot enter `EXA_API_KEY`, `TAVILY_API_KEY`, `YDC_API_KEY`, or `searxng.url`; set keys in the credential store or the environment and the instance URL in configuration.
- **Third-party data flow** — every query and fetched URL is sent to the selected backend; a deployment that must not disclose them needs another provider.
- **No page status** — fetches always report status 200, so a missing or error page is visible only in the returned text or a no-content error.
- **No direct-read fallback** — SearXNG registers no fetch provider, and a refused keyless You.com extraction fails instead of reading the page directly; select the `http` fetch provider for direct reads.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
