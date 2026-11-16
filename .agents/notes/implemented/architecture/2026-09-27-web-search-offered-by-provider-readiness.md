# Agent Note: Offer web_search and web_fetch only while the selected provider is ready

Status: implemented

## Problem

`jan-tool-web` registers `web_search` whenever search is enabled, and the [web capability seam decision](2026-06-24-web-capability-seam.md) keeps it visible while the selected provider cannot run. Without a readiness check, a Session on an API-key route without a key is offered a tool whose every call fails with `WEB_PROVIDER_CREDENTIAL_MISSING`. Sessions in one Host can use different routes, a Session can switch routes between requests, and the Web app registers `web_search` once per agent preset, so no registration decision matches every request.

## Decision

Each role of the web capability seam owns one part of a per-step check:

- **Service Definition.** `WebSearchProvider` and `WebFetchProvider` have an optional `ready(llmProvider)` that answers whether an operation made for a model request on that chat route has a credential to send. It checks configuration only and makes no network calls. `ctx.web.searchReady(llmProvider?)` and `ctx.web.fetchReady(llmProvider?)` resolve the provider with the same rules as `search()` and `fetch()` and return its answer. A provider without `ready()` counts as ready, and a selection failure answers true because the operation reports that failure as a structured `WebError`.
- **Service Provider.** A key counts when `ctx.credentials.describe()` reports its reference configured (without that service, when the launching environment carries it); the shared credential helpers perform these presence checks. A failed account-token or credential-store read answers false, because the operation fails on that read instead of trying the next credential. The providers name no tool or prompt section.
- **Consumer.** `jan-tool-web` registers `web_search` and `web_fetch` with [step activation conditions](../../../../packages/core/tools/README.md#conditional-tools) that ask `ctx.web.searchReady()` and `ctx.web.fetchReady()` about the route of the step's model selection. The agent loop resolves conditions before it assembles the step, so the declared tools, the `tool:web_search` and `tool:web_fetch` prompt sections, PTC program bindings, and dispatch all read the same admitted set.

Only presence decides: no API key value is read and no endpoint is contacted, so a wrong key or an endpoint that does not serve the native `web_search_20250305` server tool keeps the tool admitted. A step that does not admit a web tool also refuses calls to it as `UNKNOWN_TOOL`, so a model that repeats an earlier call reaches no provider; an operation made outside a model step resolves its credential when it runs and fails with `WEB_PROVIDER_CREDENTIAL_MISSING` when there is none.

The request header records the assembled tools, so the agent loop announces each change through tool-registry updates.

## Alternatives considered

**Extend `available()`.** It is synchronous and takes no request, while this check reads an asynchronous credential store and depends on the request's route. A route-dependent `available()` would also make provider selection depend on the conversation.

**Read the route from the Session's latest `request/context` event instead of passing it.** That event records the previous request, so a new Session's first request and the first request after a model switch would be decided for the wrong route or for none.

**Register or unregister `web_search` in `jan-tool-web`.** Registration is shared by every Session of an agent preset, while credentials depend on each request's route. Unregistering would also make `toolOrder` entries and subagent `toolFilter` restrictions that name `web_search` fail.

**Remove `web_search` from the assembled request.** A `system-prompt/assemble` listener could drop the declaration and its section, but the tool would stay executable, so a model that repeats an earlier call would still run it, and PTC programs would still bind it. Prompt assembly also no longer carries tool declarations.

**Keep the tool offered and fail at execution.** The model spends a call on a search that cannot authenticate, and the failure repeats on every attempt.

**Probe the key or endpoint before offering the tool.** A network request per model request adds latency and cost; the user controls configuration, not its validity at that moment.

## Consequences

`jan-web` gains public members: the optional `ready()` of both provider interfaces, `WebRuntime.searchReady()`, and `WebRuntime.fetchReady()`. Each readiness method is the smallest query its one consumer needs; neither reports availability or selection failures. The HTTP fetch provider implements no `ready()`, so `web_fetch` stays admitted whenever HTTP fetch is selected. A step that does not admit a web tool leaves it out of PTC program bindings too. An endpoint that cannot serve the native server tool keeps the tool admitted and fails each call. Removing a tool on an unchanged route changes the declared tools and misses the prompt cache once; a model switch already invalidates it. A deployment whose official route chats through a gateway sends the gateway's key to that gateway's origin with `/v1/tools` for the Search and Fetch APIs, and to the configured Messages endpoint, the official one by default, for legacy Messages search, where each search fails unless that endpoint accepts the key.

In real compositions, the shipped headless keyless smoke test and the `web-search-unconfigured` recorded-session snapshot, whose search key references are unset, pin the withheld search tool.
