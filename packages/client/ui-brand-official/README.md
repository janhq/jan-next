---
description: "Jan brand artwork for the sidebar and the home hero."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-brand-official

English | [中文](README.zh.md)

## Summary

This package supplies the Jan brand in tokamak-harness: the Jan waving-hand logo in the sidebar mark and the conversation hero mark in every build profile, and the name "Jan" beside the sidebar mark in an `official` build. The shipped Web and Desktop compositions load it by default. It adds no model requests.

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

The shipped Web and Desktop compositions already mount this plugin; it needs no installation or enablement and takes no configuration.

### Choosing the profile

`DSH_CLIENT_BUILD_PROFILE` gates only the sidebar name. An `official` build shows "Jan" from this package. Any other value leaves the sidebar's local-build label, the localized `brand.localBuild` text ("Jan" in English) followed by the build version, which copies the version when clicked. Both marks show the Jan logo in every profile.

### Replacing the brand

A deployment with its own identity leaves this package out and composes another package that occupies `sidebar.brand.mark`, `sidebar.brand.name` and `conversation.hero.brand.mark`. Occupying a slot is the only composition route; the artwork identity is not configurable.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Each occupant installs through `ctx.slots.inject()`, which waits for its slot declaration, so the registrations work whether this row activates before or after the declarer, withdraw when the declaration collapses, and leave no partial brand during HMR. One component, `OfficialBrandMark`, renders the decorative logo image at the size each host requests, and keeps the host class the hero passes for its geometry. The logo is [`src/client/assets/jan-logo.png`](src/client/assets/jan-logo.png), Jan's own app logo from [janhq/jan](https://github.com/janhq/jan); `apps/web/scripts/render-app-icons.ts` renders the Web favicons and install icons from the same file. The browser half is [`src/client/index.ts`](src/client/index.ts); the node half is an empty Loader seat. The browser title is a build-environment concern (`DSH_CLIENT_TITLE`), outside the slot system.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the brand surface is not enough. They move from the slots this package occupies to the shell that renders them.

- [ui-sidebar](../ui-sidebar/README.md) — declares `sidebar.brand.mark` and `sidebar.brand.name` and renders their fallbacks.
- [ui-conversation](../ui-conversation/README.md) — declares `conversation.hero.brand.mark` in the hero.
- [Web client architecture](../../../docs/subsystems/web-client.md) — how browser plugin rows load and register slots.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package contributes browser presentation only; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define how brand presentation is supplied. They are current package constraints, not a brand-design comparison or a task backlog.

- **One occupant set** — alternative presentation belongs in another Cordis package occupying the same slots.
- **The sidebar mark does not copy the build version** — in non-official builds only the local-build label copies it.
- **The browser title is independent** — `DSH_CLIENT_TITLE` selects title text at build time rather than through a UI slot.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
