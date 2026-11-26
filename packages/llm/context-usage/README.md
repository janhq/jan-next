---
description: "The /context command: one chat's context window broken down by prompt section, instruction file, skill, tool, message kind and injected context."
kind: "package-reference"
---

# @janhq/jan-context-usage

## Summary

Type `/context` in an open chat to see what fills its context window. A panel above the composer shows how much of the window is used, how much room is left before automatic compaction, a cell grid of the window, and a list of categories: system prompt, instruction files, skills, Jan tools, MCP tools, injected context, user messages, compaction summary, assistant messages, assistant thinking, tool calls and tool output. Each category expands to named entries such as prompt sections, `AGENTS.md` files, tools, MCP servers and loaded skills. Reading the breakdown adds nothing to the chat.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

The web bundle mounts this package with no configuration. Type `/context` and press Enter, or pick it from the slash menu. Refresh the panel after the chat changes; close it with Dismiss or Escape.

<a id="understand-the-implementation"></a>
## Understand the implementation

The owner-only `contextUsage/breakdown` Remote takes a chat session identity; its Host counterpart is `ctx.contextUsage.breakdown(agent, signal)`.

- **Occupancy.** Used tokens come from `ctx.tokenMeter.measure(session)`: the last provider-reported prompt size plus the estimated change since, the same figure the composer meter shows. Before any provider report the figure is the sum of the estimates and is marked as estimated.
- **Attribution.** Every surviving surface node is priced by the meter (route prices for images). Within a node the price is split over its parts by the meter's fixed-density estimate; the extra route price of images goes to the images. Messages are classified by role and `source.kind`: `agent-instructions` per quoted file, `skill-catalog` and `skill-invocation` plus results of the `skill` and `skill_search` tools as skills, `compact-checkpoint` as the compaction summary, runtime-context snapshots per contributing section, other producer kinds by kind. Tool results take the name of the call that produced them.
- **System prompt.** The logged prompt is split by the sections a fresh, unlogged assembly renders; text no current section accounts for is reported as `other`.
- **Tools.** The latest request envelope's tool schemas are priced one by one; tools with an MCP origin are grouped by server.
- **Scaling.** Category totals are the heuristic shares scaled to the used figure with largest-remainder rounding, so they sum to it exactly. Entries are scaled by the same factor and may not add up to their category.
- **Capacity and threshold.** The window comes from the `contextPressure` projection or the route's model info. The compaction threshold comes from `ctx.compaction.autoCompactThreshold(agent, signal)`; `@janhq/jan-compaction-basic` answers with the threshold its pressure policy uses for the routed request, and undefined when automatic compaction is off.

<a id="further-exploration"></a>
## Further Exploration

- [Token meter](../token-meter/README.md) for the measurement and the fixed-density estimate.
- [Composer commands](../../client/ui-commands/README.md) for the command contract.

<a id="model-experience"></a>
## Model Experience

None, as the breakdown is read on demand for the user and never enters a request.

#### KV Cache effect

No effect; prompt assembly for section names is not logged or sent.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Shares inside the provider total come from a 4-characters-per-token estimate, which underprices CJK text and JSON.
- Prompt sections are named by matching a fresh assembly; a section whose text changed since the prompt was logged is counted as `other`.

-----

<a id="dev-note"></a>
### Dev Note

None.
