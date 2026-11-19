---
description: "Register optional guided tours and remember whether local guidance has been seen"
kind: "package-reference"
---

# @janhq/jan-client-ui-guidance

## Summary

This [Client plugin](../../../docs/subsystems/web-client.md) supplies the injected `uiGuidance` service in Web and Jan Desktop. It does not start tours on load. Register tours from a plugin effect and call `start` from an explicit user action so the tour can be replayed.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

- Inject `uiGuidance` and declare `@janhq/jan-client-ui-guidance` as a Client plugin dependency. Import `GuidanceService`, `GuidanceTour`, or `GuidanceStep` from the `/client` entry with `import type`.
- Use `ctx.effect(() => ctx.uiGuidance.register({ id, steps }))`. Use stable domain-first, lowercase dotted values such as `data-guide="sidebar.account-menu"`. Supply each step's localized plain-text `title` and `body` as functions (e.g. `() => t('tour.title')`); they are read when each card renders, so a language switch needs no re-registration. Optionally set `advanceOn: 'click'` to require activation of its target instead of showing a Next button.
- `start(id)` returns false without replacing an active tour when the id is unknown or none of its targets are available. Missing steps are skipped; action steps can advance into newly mounted targets. Escape, Close, clicking away, or completing the last step dismisses the tour and marks it seen. Unloading the contribution dismisses it without changing seen state.
- For contextual guidance, call `hasSeen(id)` and then `markSeen(id)` after the user acts on or dismisses it. `resetSeen()` clears acknowledgements for both coachmarks and tours. Seen state is local to this app profile and does not sync.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package only renders guidance for the user and records local acknowledgements.

#### KV Cache effect

None; the plugin does not assemble or send a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Driver.js 1.9 exposes `advanceOnClick`, `skipMissingElement`, and `waitForElement`, not `advanceOn`, `popover.instruction`, or `allowedElements`.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers - click to expand</summary>

None.

</details>
