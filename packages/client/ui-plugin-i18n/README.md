---
description: "Browser-side plugin translation: generated locale tables, proactive detection and translation offers, tool titles, and Plugins settings."
kind: "package-reference"
---

# @janhq/jan-client-ui-plugin-i18n

## Summary

This package loads stored [Host plugin translations](../../host/plugin-i18n/README.md) into the locale runtime and provides `ctx.pluginI18n`. Jan detects foreign-language plugin text locally and offers to translate it in place. Plugins settings lets the person pick the translation model, translate or restore a plugin manually, and enable translation of tool titles.

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

`ctx.pluginI18n.assess({ pkg, meta })` returns an install offer when a package lacks the active locale in its registered dictionaries, title, or description. It returns null for a dismissed or consented package, or if the Host has stored a translation for that locale. The install dialog names the target language and model; accepting runs `translate`, which records consent for the package.

### Generated tables

A stored table registers through `ctx.locale.registerGenerated`, below every registered dictionary. A plugin's own string always wins, and a translation retires itself when the plugin changes the source text it translated. A package consented earlier is translated again in the background when its client activates with a namespace lacking the locale or changed text.

### Tool titles

`ctx.pluginI18n.titles` is an observable of `{ display, request }`. `display` returns the cached translation of an exact title or the title itself; `request` queues titles written in a script the UI locale does not use, debounced and batched, once per title and locale. New title requests require global consent; cached translations can still be displayed with package consent. The tool card receives the view through its injected `titles` hook.

### On-screen text

The `MutationObserver` in `screen.ts` watches the slot renderer's `data-plugin-owner` marker and the Plugins page's `data-plugin-package`, `data-plugin-detail`, and `data-plugin-row-detail` markers. It samples visible text nodes and `title`, `placeholder`, and `aria-label` attributes locally, skipping input values, editable or code regions, and anything marked `translate="no"`. `ctx.pluginI18n.suggestions` publishes one suggested source language per package. Installed package metadata and attributed dictionary locales can also supply evidence.

The shell offers one plugin at a time. **Not now** hides the offer for this app start; **Never for this plugin** saves the choice in this browser. Neither choice prevents manual translation. The Host receives screen text only with that package's own consent; the global tool-title switch does not cover it. Translations replace text in place, and **Show original** clears the translation and restores the plugin's own text. Clearing consent or changing the UI language also restores the originals.

### Settings

The Translations tab opens with a model picker: `Default model (provider/model)` is preselected, the models of every provider follow with local ones first, and a pick is saved by the Host until the person chooses the default again. A note names the model in use when it is not the one the picker shows. Each installed third-party plugin lists its stored model and counts, the number of on-screen strings translated with the list itself, Translate or Run again, Clear, and the global switch.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Namespace attribution

The locale runtime does not record which plugin registered a namespace. `NamespaceOwnership` follows the root fibers of Loader entries: namespaces that appear between a package fiber's start and activation belong to it. Concurrent loads can lend a package a neighbor's namespaces, which only widens a request, because requests carry only namespaces lacking the locale. Fibers that activated before this plugin started are not attributed.

### Language detection

`script.ts` uses Unicode script cues for short labels such as `特征树` without loading a model. The first Latin phrase that passes the prose gate loads the ELD ExtraSmall browser chunk. It scores phrases locally, and length, reliability, and confidence-margin checks filter out ambiguous copy. Code identifiers, file names, and short measurements are not useful language evidence. Tool title translation continues to use the existing script-only heuristic.

### Source map

| File | Role |
|---|---|
| [`src/client/service.ts`](src/client/service.ts) | `PluginI18nClient`: state, tables, offers, jobs, title cache |
| [`src/client/ownership.ts`](src/client/ownership.ts) | Package names and namespace attribution |
| [`src/client/sources.ts`](src/client/sources.ts) | Source selection and locale checks |
| [`src/client/script.ts`](src/client/script.ts) | Unicode script checks and statistical language detection |
| [`src/client/screen.ts`](src/client/screen.ts) | Batched screen detection and consent-gated translation |
| [`src/client/PluginTranslationPrompt.tsx`](src/client/PluginTranslationPrompt.tsx) | Shell offer, progress, retry, and restore |
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
- **Right sidebar fallback title**: registered tab bodies and custom titles carry the slot renderer's owner marker. The captured tab title shown when a plugin does not register a custom title slot has no owner marker.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
