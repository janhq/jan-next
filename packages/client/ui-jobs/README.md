---
description: "Background jobs in the composer dock, with running and finished sections and expandable streaming output."
kind: "package-reference"
---

# @janhq/jan-client-ui-jobs

## Summary

Check a chat's background jobs from the composer dock. The list shows each job's state, elapsed time, progress, and final status. Open a live job or a finished job with retained output to read its output; closing the panel stops the stream. Finished jobs without retained output stay static.

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

Load the plugin through the web-app manifest; it renders nothing until the session can see at least one job, so an ordinary conversation never grows a control for a capability it is not using.

The pill appears after the activity and usage pills in the composer dock. It shows a spinner and the running count while jobs are running or stopping. When only finished jobs remain, it shows the layers icon and the number of visible jobs.

Click the pill to open or pin the list above it. Hover with a non-touch pointer for a preview that closes when the pointer leaves both the pill and the list. Click a pinned pill again, click outside, or press Escape to dismiss. Press ArrowDown to open the list and focus its first control, or Tab from the open pill into the list. Interacting with the list pins it.

### One row per job

The `job.list` stream `ctx.jobs` mirrors is the single roster: each `JobView` row carries lifecycle, duration, the live `progress` line or the terminal `detail`, and its retained byte count — a live job, or a settled one with retained output, is what makes a row expandable. There is no second roster to join.

Running job rows also carry a two-press stop control: the first press arms it, the confirming press within three seconds calls `ctx.jobs.kill`, and the row converges through the roster stream (`stopping`, then the settled section, whose detail carries `cancelled by the user`). The kill claims nothing in the model's notice ledger, so the owning agent still receives the standard completion notice — the model is told the user stopped its task rather than left to infer it ([reference](../../jobs/tool-jobs/README.md)). The settled section folds behind its count while live work exists and can be cleared client-side.

### The expanded panel

Expanding an observable row opens that job's output observation stream from `ctx.jobs` (installed by `jan-api-job-controller`) into an embedded terminal panel. The panel copies the command (not the output), wraps commands and output lines in full, scrolls its output inside a fixed height instead of folding, and draws no run-state dot of its own — the row above carries the state. Retention gaps and stream interruptions render as notices above the panel.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The `conversation.composer.dock` entry opens a body-mounted `MenuSurface`, so the composer and sidebar cannot clip it. CSS anchors place it above the pill when space allows, with scrolling and fallbacks within the layout viewport. Pinch zoom can put part of the list outside the visual viewport. The session's roster stream stays open for the entry's lifetime; output observation runs only while its row is expanded and the list is visible.

| File | Role |
|---|---|
| [`src/client/JobListAction.tsx`](src/client/JobListAction.tsx) | The job list: sections, durations, panels |
| [`src/client/index.ts`](src/client/index.ts) | Slot registration and the dictionaries |
| [`src/client/locales.ts`](src/client/locales.ts) | The `job` namespace copy (zh source of truth) |

Background-job rows follow the [standard menu edge geometry](../../../docs/ui-radius.md#nested-hover); controls inside a filled running row retain compact corners.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [`jan-api-job-controller`](../../api/job-controller/README.md) — the `job.list` and `job.follow` streams, the `job.kill` Remote, and the `ctx.jobs` service behind the rows, the panel, and the stop control.
- [`jan-jobs`](../../jobs/jobs/README.md) — the registry contract that owns the ring and projection semantics.
- [`jan-client-ui-primitives`](../ui-primitives/README.md) — the `TerminalBlock` surface the panel configures.

-----

<a id="model-experience"></a>
## Model Experience

None, as this package renders host-observed state and live output for a human and touches no prompt, message, schema, stream, or tool result. The model's own view of the same work stays with [`jan-tool-jobs`](../../jobs/tool-jobs/README.md).

#### KV Cache effect

None; the package never assembles or sends provider requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define current package constraints, not a task backlog.

- **Channel labels are not rendered** — stdout and stderr chunks concatenate into one stream; per-channel tinting is a presentation follow-up.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
