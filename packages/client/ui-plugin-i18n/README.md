---
description: "Browser half of plugin translation: stored translations registered as a generated layer of the locale runtime, the ctx.pluginI18n service behind the install offer, translated tool titles and descriptions, and on-screen translation of plugin text, and the Translations tab of Plugins settings with its model picker."
kind: "package-reference"
---

# @janhq/jan-client-ui-plugin-i18n

## Summary

The package reads the Host's [plugin translation](../../host/plugin-i18n/README.md) store, registers each stored table in the locale runtime's generated layer, and provides `ctx.pluginI18n`. The plugin manager's install dialog asks the service whether to offer translation after an install, the tool card shows cached translations of titles and provider descriptions written in another script, and a consented plugin's own panels and its card in the Plugins page are translated on screen. The Translations tab in Plugins settings lets the person pick the translation model, translate, run again, or clear one plugin, and switch tool-title translation on for every plugin.

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

The service is composed beside the `pluginI18n` Remote and active only while the current Peer may use it.

### The install offer

`ctx.pluginI18n.assess({ pkg, meta })` returns an offer to translate the package into the active locale, or null. It returns null when the Host already stores that locale for the package. Otherwise it offers when a namespace the package registered lacks the locale, or when its title or description lacks it: a translation map without the locale's language, a plain string in a script the UI does not use, or a plain string in a UI that is not English and not in the locale's own script. The install dialog shows the offer with the language and model named; accepting runs `translate`, which also records consent for the package.

### Generated tables

A stored table registers through `ctx.locale.registerGenerated`, below every registered dictionary. A plugin's own string always wins, and a translation retires itself when the plugin changes the source text it translated. A package consented earlier is translated again in the background when its client activates with a namespace lacking the locale or changed text.

### Tool titles

`ctx.pluginI18n.titles` is an observable of `{ display, request }`. `display` returns the cached translation of an exact title or the title itself; `request` queues titles written in a script the UI locale does not use, debounced and batched, once per title and locale. New title requests require global consent; cached translations can still be displayed with package consent. The tool card receives the view through its injected `titles` hook.

### On-screen text

Text a plugin draws itself, and the name, description, and settings the Plugins page shows about it, reach the person through a `MutationObserver` in `screen.ts`. It watches three kinds of region: the `data-plugin-owner` marker the slot renderer puts around every entry a third-party plugin registers, the Plugins page's `data-plugin-package` card and `data-plugin-detail` page, and a part's `data-plugin-row-detail` page. Inside a region whose package the person consented to, text nodes and the `title`, `placeholder`, and `aria-label` attributes written in a script the UI does not use are asked for through `translateStrings` under that package, batched, once per text and locale, and replaced in place when the answer arrives. The original comes back when the plugin is cleared, when it loses consent, and when the language changes. The observer never touches input or textarea values, `contenteditable` regions, `code`, `pre`, `canvas`, `script`, or `style`, and it sends nothing for a package without its own consent; the global switch does not cover it.

### Settings

The Translations tab opens with a model picker: `Default model (provider/model)` is preselected, the models of every provider follow with local ones first, and a pick is saved by the Host until the person chooses the default again. A note names the model in use when it is not the one the picker shows. Each installed third-party plugin lists its stored model and counts, the number of on-screen strings translated with the list itself, Translate or Run again, Clear, and the global switch.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Namespace attribution

The locale runtime does not record which plugin registered a namespace. `NamespaceOwnership` follows the root fibers of Loader entries: namespaces that appear between a package fiber's start and activation belong to it. Concurrent loads can lend a package a neighbor's namespaces, which only widens a request, because requests carry only namespaces lacking the locale. Fibers that activated before this plugin started are not attributed.

### Script heuristic

`script.ts` finds Han, Kana, Hangul, Cyrillic, Arabic, Hebrew, Thai, Devanagari, and Greek letters. Latin suits every locale; a title mismatches when it holds a non-Latin script the locale does not write in.

### Source map

| File | Role |
|---|---|
| [`src/client/service.ts`](src/client/service.ts) | `PluginI18nClient`: state, tables, offers, jobs, title cache |
| [`src/client/ownership.ts`](src/client/ownership.ts) | Package names and namespace attribution |
| [`src/client/sources.ts`](src/client/sources.ts) | Source selection and locale checks |
| [`src/client/script.ts`](src/client/script.ts) | The script heuristic |
| [`src/client/screen.ts`](src/client/screen.ts) | The on-screen translator and its package regions |
| [`src/client/PluginTranslationsTab.tsx`](src/client/PluginTranslationsTab.tsx) | The settings tab |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Plugin translation host](../../host/plugin-i18n/README.md) — the Remote, cache, and validation.
- [Locale runtime](../locale/README.md) — the generated layer.

-----

<a id="model-experience"></a>
## Model Experience

None, as the browser half sends no model request; the Host translates.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No tool owner** — a tool card does not know which plugin registered the tool, so new title translations require global consent.
- **Boot-time attribution** — namespaces of plugins that activated before this plugin started are not attributed, so only their titles and later activations are covered.
- **One source locale per request** — namespaces whose source locale differs from the request's are left out.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
