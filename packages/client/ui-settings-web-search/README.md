---
description: "The web search and fetch settings page on the jan web client's Plugins page: the Search and Fetch provider menus."
kind: "package-reference"
---

# @janhq/jan-client-ui-settings-web-search

## Summary

Open **Plugins** in the sidebar and select **Web search and fetch** in the Official group to choose the providers web search and web fetch use. The page writes only on save. The page exists while the Host serves the `web` namespace.

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

The **Web search and fetch** card in the Official group opens the page. It has a **Web search provider** section and a **Web fetch provider** section, each with a provider menu directly under its title. A menu lists every provider the Host registers, including providers that plugins register, so a newly installed provider needs no change to this page; [Add another provider](../../web/web/README.md#adding-a-provider) shows how to mount one in a profile. The Fetch menu lists **Direct fetch** (`http`) first while it is registered; every other provider follows in registration order and shows its registered title or id. The shipped composition selects Exa (`exa`) for Search and Direct fetch for Fetch, and a selection stored in settings or composed by the deployment still applies; opening the page writes nothing. Each menu has no label of its own; its accessible name is its section title followed by the selected provider, such as **Web search provider Exa**. A selected id the Host does not register appears as an extra **(not loaded)** entry and stays selected. While the deployment composes no provider for a capability, its menu starts with **Automatic**, which clears the stored selection so the Host chooses again. Selecting the deployment's composed provider clears the stored selection instead of writing a copy. When the provider list cannot be read, each section says its menu may be incomplete and offers **Retry**; the menus keep the last list read, or only the selected ids before any list arrives. Under each menu, the section shows the `description` the selected provider registered, in the active language, as plain text; a provider that registers none, or a selected id the Host does not register, shows no description. A plugin provider's section adds, after its description, that it is configured in that plugin's own settings.

The provider menus are disabled while a failed save is staged. Nothing is written until **Save**; leaving the page drops the drafts.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Host half is an empty `apply`, present only so the package holds a Loader row the client module system serves the browser half for. The browser half binds the `web` namespace through `ctx.configForms.get` and keeps one shared `SettingsFormModel` of `ui-primitives` in `WebSearchCardController`. The menus stage `searchProvider` and `fetchProvider` in `web`; a target equal to the composed value stages a reset instead, and so does the **Automatic** entry, which the menu offers while the composed `base` has no single provider id for that field: no value, or a preference list such as `[tokamak, exa]`. A menu shows a composed preference list as **Automatic**, and the menus never write a list. The provider list comes from `remote.web.listProviders`, which keeps registration order; the controller moves a registered `http` fetch provider to the front and keeps the rest in Host order. The list is read at construction, on each `web/providers-changed` event, on `connection/reset`, and when the `web` namespace becomes served; only the latest read publishes, a failed read keeps the previous list and sets the snapshot's `providersFailed` until a later read succeeds, and before the first successful answer a menu holds only the selected id. The face's `retryProviders` re-reads through the same sequence and disposal checks; disposal suppresses late answers. `WebSearchCard` renders the provider menus with one local menu button over the `Menu` primitive. The page registers `WebSearchCard` into the Plugins page's `plugins.item` slot through `ctx.configForms.whileServed([web])`.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [ui-plugin-manager](../ui-plugin-manager/README.md) — the Plugins page and the `plugins.item` slot the page registers into.
- [ui-settings](../ui-settings/README.md) — the settings scope and the served-namespace watch the page rides.
- [ui-primitives](../ui-primitives/README.md) — the settings form model and fields the page renders.
- [web](../../web/web/README.md) — the provider selection and provider list the menus use.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side settings surface that registers no model surface.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Automatic selection reads only the deployment composition** — a menu offers it when the composition layer sets no single provider for that capability. While the composition sets a preference list, **Automatic** runs its first registered and available provider, and the page does not show which one that is. While automatic selection applies, the Host's `JAN_WEB_SEARCH_PROVIDER` or `JAN_WEB_FETCH_PROVIDER` environment variable picks the provider instead, and the page does not show that choice. Without either, automatic selection with more than one usable registered provider makes each operation fail with `WEB_PROVIDER_AMBIGUOUS`.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
