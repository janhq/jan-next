# Agent Note: Web provider selection - independent menus over registered providers

Status: implemented

## Problem

The web service selects search and fetch providers through two independent fields, `web.searchProvider` and `web.fetchProvider`. A settings control that writes both at once ties fetch billing and target access policy to the search choice, and a control that offers only the choices it knows cannot select a provider that another plugin registers. A picker over registered providers needs the Host to report them, and the [web capability seam](2026-06-24-web-capability-seam.md) has no availability observation for it to reuse.

## Decision

Users choose search and fetch providers independently from the Host's registered provider lists. The shipped composition selects Tokamak for both while the Tokamak account is signed in, and otherwise Exa for search and local HTTP fetch for fetch.

### Registered providers are observable; availability is not

`WebSearchProvider` and `WebFetchProvider` carry an optional `title`, the provider's display name, and an optional localized `description` of what the provider suits and what it costs or cannot do. `ctx.web.listProviders()` returns `{ search, fetch }`, each a registration-ordered list of `{ id, title?, description? }` entries, and the `web` Remote namespace exposes it as `web/listProviders`. Every registration and disposal emits the payload-free `web/providers-changed` event after the registry changes; the web service contains listener failures, so an observer cannot veto a registry change. [jan-api-remotes](../../../../packages/api/remotes/README.md) mounts the namespace and forwards the event, and Clients re-read the list after each notification and reconnect.

The lists include providers whose `available()` answers false. A picker shows what can be pinned, including a provider whose credential the user has not configured yet, whereas availability depends on per-request facts such as the Session's model route and credential state. Availability therefore stays an execution result: `search()` and `fetch()` resolve the configured provider at call time and throw the structured `WebError`, as the seam note records. The tool layer still never enumerates providers.

### Independent selection

The Web search and fetch page writes `web.searchProvider` from its Search menu and `web.fetchProvider` from its Fetch menu. Each menu lists every registered provider for its capability by `title` (or `id` when `title` is absent), so plugin providers appear without page changes, and a selected id that the Host does not register stays visible as such. Official providers register no `title`; the page names them from its own locale dictionary and lists them first in a fixed order. Other providers follow in Host registration order. Selecting the deployment's composed provider clears the stored override instead of storing a duplicate value. The [settings page README](../../../../packages/client/ui-settings-web-search/README.md) owns the page's controls.

Every registered provider is listed; a provider has no flag that keeps it out of the menus. Independent menus must offer providers that other plugins register, and the display metadata that listing needs is only the optional `title` and `description`. The description lives on the registration rather than in the page's dictionaries so that official and plugin providers explain themselves through one field, and a new provider needs no page change to describe its trade-offs. Providers keep their own settings pages.

### Defaults and stored selections

The [base composition](../../../../packages/bundle/base/cordis.patch.yml) sets `searchProvider: [tokamak, exa]` and `fetchProvider: [tokamak, http]`. A field may hold one id or a preference list, and the web service runs the first listed provider that is registered and available. The Tokamak providers are available only while the Tokamak account is signed in, so a signed-in user's searches and fetches are billed to the account they signed in with, and a signed-out user searches through keyless Exa and fetches through local HTTP fetch. Local HTTP fetch is the signed-out default because it has no per-request API charge, applies Harness's own URL validation and resource limits, and reaches intranet and local addresses. The menus write single ids and show a composed list as **Automatic**.

A stored selection, whether in the settings document or in a deployment's own composition, wins over the shipped default, and an upgrade does not rewrite it. A preference list is read only through availability, a local check of configuration and sign-in state: a listed provider that is registered and available runs, and its failure is the operation's failure. A selection is never replaced after a failure: when the selected provider fails, the operation fails with its structured error and does not retry another search or fetch provider. A failure fallback would send the query and credential to an endpoint the user did not choose and change billing without notice; a preference list names every endpoint it may use.

## Alternatives considered

**Keep one switch for search and fetch.** It ties fetch billing and target access policy to the search choice, and it cannot express a provider that another plugin registers.

**Filter the lists by availability, or add availability to each entry.** A filtered list hides a provider while its credential is missing, right when the user needs to choose and configure it. Availability also depends on the request's model route and credential state, so a listed boolean could disagree with execution. The menus read registration only.

**Keep a fixed provider catalog in the Client.** The Client would show ids the Host does not register as normal choices and would never show a provider that a plugin registers at runtime.

**Carry the provider list in the change event.** A payload-free event leaves one read path for initial load, notifications, and reconnects, so the Client never has to order an event payload against a concurrent read.

**Keep display names in the Client or in a separate Host registry.** The registering plugin knows its provider's name; a separate map would let a provider and its label register or dispose independently.

**Fall back to another provider when the selected one fails.** A fallback hides gateway and credential misconfiguration, sends the query to a second service, and changes what the request costs without the user choosing it.

**Pin Exa and have the Tokamak provider replace it while signed in.** One id would then name two services, and the menus could not distinguish them. A preference list keeps each provider under its own id and states the order in configuration.

## Consequences

Users without a stored selection search and fetch through Tokamak while signed in; otherwise they search through Exa and fetch through local HTTP fetch.

A plugin provider, including one written in creator mode, appears in the matching menu as soon as it registers, under its `title`. The menus can offer a provider that cannot run for the current request; the failure appears when a search or fetch runs. Each registry change costs one forwarded event and one list read in each Client that observes it.

## Verification

[web.spec.ts](../../../../packages/web/web/tests/web.spec.ts) covers list contents and order, titles, events after registration and disposal, no event for a rejected duplicate, and contained listener failures. [remote-events.host.spec.ts](../../../../packages/api/remotes/tests/remote-events.host.spec.ts) covers event forwarding, and [base.spec.ts](../../../../packages/bundle/base/tests/base.spec.ts) pins the shipped defaults. The settings page's controller and card specs and the [plugin configuration browser scenario](../../../../apps/web/tests/plugin-config.e2e.ts) cover menu contents, independent Search and Fetch selection, and the settings each provider keeps.
