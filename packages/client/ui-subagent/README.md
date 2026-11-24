---
description: "Subagent conversation catalog, continuation routing UI, and '@' reference source for the jan web client."
kind: "package-reference"
---

# @janhq/jan-client-ui-subagent

## Summary

Browse local subagent conversations and external tasks from the parent header. Local conversations show activity, token usage, and duration; continuable children accept follow-up prompts and support Stop. External tasks appear as non-navigable leaves without an execution status. Historical one-shot conversations open as read-only records. The ordinary sidebar omits subagent conversations, and the separate `@` source inserts a running child's label without granting continuation authority.

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

A root conversation lists its subagents in one drop-down above the composer. The collapsed header shows the direct count, a running dot while any child runs, and the direct progress in completed, in progress, not running, and external order; zero counts are omitted. Clicking the header opens the roster in place, inside the composer's column, with no floating menu. Each row shows a status dot, a status word, the creation description (or Session title, else agent name), total provider tokens, and elapsed active time; below 480px of column width the status word is visually hidden and the dot carries the state. Clicking a row expands it: the agent name, last requested model, and an Open chat action, then its six most recent observations, each hanging off a corner connector with its time, then that child's own subagents as nested rows. The trailing panel button opens a child in the right Sidebar. External tasks show as plain rows with no expansion, navigation, or execution status. A roster that hides (no children, no shared tasks, no load error) starts closed when it returns.

The composer drop-down shows only while a child or the root conversation runs, shared tasks or a task-board failure keep it reachable, or the catalog read failed. Once the turn closes and no child runs, the subagents move to that turn's header line through `conversation.chat.turn-process.trailing`: `Completed in 8s` is followed by `2 subagents · 2 completed`, and clicking it opens the same rows below the line. A turn claims the direct children created between its start and end; a turn that spawned none shows nothing.

This package registers the `jan-resource://subagentchat/session/<child>?parent=<parent>&mode=<mode>` resource and builtin Sidebar tab type. The resource retains the child `SessionReference` directly from its address without refreshing the parent catalog, and releases the reference when the tab record closes. The tab renders the shared `conversation.content` Factory through `sidebar.chat.conversation`, fixes the local View to Chat, and omits the main Conversation header and width controls.

Shared tasks render under the roster's rows through `conversation.session.header.actions.subagent.footer`. The roster stays visible with zero children only while Team mode is enabled, at least one nondeleted shared task exists (or the task board reports a failure), and the footer contribution is available; “No subagents” appears only beside shared tasks. A failed catalog read shows its message and a Retry action.

Child and ancestor lineage catalogs stay in the Conversation header as floating menus, 360px wide with 6px outer padding and constrained to fit the layout viewport. They show navigation only, without section headers. In WebKit-compatible browsers, the native 5px scrollbar sits in the right 6px inset with inset track ends and a stable gutter.

### Browsing the tree

Count, owner, and sidebar-action tooltips appear after 500ms of hover. Hovering a text-visible trigger opens its catalog after 150ms; leaving both trigger and catalog closes it after 120ms. Clicking the descendant-count trigger opens and pins its catalog, or closes an already pinned catalog. The icon-only count trigger does not open on hover, including when a pending hover crosses into the narrow layout. Clicking toggles its pinned menu; ArrowDown opens and pins the menu and focuses its first row. Outside click or Escape dismisses a pinned menu. Clicking moves focus into the panel, where ArrowDown/Home enters the first tree row and ArrowUp/End enters the last; Escape returns focus when it was inside. Breadcrumb-title clicks navigate to the corresponding conversation.

Rows show the creation description, or an available Session title, above the agent name, which is unique among its siblings. Entries recorded without a name show the Session id in its place. Without either description, the row shows only the name or Session id. Navigation, row identity, and Sidebar addresses always use the Session id. Local rows use compact 4px vertical padding; their clickable content uses 6px horizontal padding and 7px gaps, aligned with shared-task rows while retaining the tree's left offset. A decorative trailing check marks the current conversation and is not an action; other local rows retain the sidebar arrow. Primary titles use 13px text and secondary names use 12px. All rows wrap descriptions and names in full, including on touch screens. Running uses the shared ongoing loader, an inactive child whose latest closed turn completed normally uses the shared success dot, and other inactive children use the shared idle dot. Every row reserves the same 14px status column, centering smaller dots so titles align with the loader state. The text-visible header trigger vertically centers its activity glyph and count with a 4px gap. The trailing column stacks total durable provider usage above active-turn duration. Keyboard navigation works with ArrowRight/ArrowLeft to expand and collapse branches and ArrowUp/ArrowDown, Home, End, and Escape to navigate or close the tree. An unlabeled one-shot row falls back to its session id. A row is a known leaf only after its own catalog loads empty.

### Continuing a conversation

A continuable child keeps the ordinary input and independent Stop action regardless of creator availability. Prompts route through `subagents/prompt`, whose runtime validates the creation address and live Team root; failures use ordinary prompt feedback. Stop routes through `subagents/interruptByUser`.

### The `@` reference source

The `@` source remains deliberately separate and inert: candidates are zero-RPC running children from `ctx.sessions.list`, picking one inserts literal `@label ` text, and the codec projects `@label`. It has no command-adjudication hooks and does not resolve labels into continuation addresses.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The [subagent runtime](../../subagent/subagent/README.md) owns continuation and interruption; the [conversation reference](../ui-conversation/README.md) documents composer behavior.

### Catalog derivation

The header lineage renderer reads `projectionsBySession` through the standard `useSessions` hook. The renderer selects `subagentCatalog` from each Session’s shared values for membership, disclosure, and counts. Activity prefers the unified UI status and falls back to Session summaries; summaries supply titles and usage. Expanding a row reads its target's projections, including ordinary cold history. A list row with `formatStatus: migration-required` displays “Migration required” before expansion and keeps its history-opening actions without descendant expansion or changing its subagent mode; a projection read requiring migration without a catalog supplies the same notice. Opening the Session supplies its catalog through history and control projections. Otherwise, an available catalog remains usable, including an explicit empty catalog. Live projection frames update every loaded level without menu subscriptions or repeated membership queries. Other rows remain expandable while their catalogs are absent, loading, or failed, and become known leaves after ready empty catalogs. External rows are always leaves and do not load child Sessions.

Each header entry declares a footer slot below its tree. Optional UI contributes there within the same scroll container; the catalog owns opening and dismissal. CSS anchors keep the panel attached to its trigger within layout-viewport size limits. Browser zoom and panning move it with the page, so it may extend beyond the visual viewport. Internal scrolling, hover behavior, pinned opening, and focus restoration remain independent.

Opening a catalog dropdown does not request its root catalog. Child-catalog expansion and failed-read retries call `refreshProjection`; shared projection-value changes update the display automatically.

Breadcrumb addresses derive from the Provider-bound Session address, loaded parent catalogs, or already-listed subagent lineage, including never-selected ancestors.

### Duration, completion, and tokens

Each local row also shows the model identifier from the most recent recorded request when available. An unconsumed model selection does not replace that identifier, and no model is inferred for a session without a recorded request.

Each visible catalog level advances its own clock while it contains a running child; collapsing the level or closing the menu releases that clock. Token totals sum the four disjoint `tokenUsage` buckets. The `subagentTiming` projection sums completed-turn duration and supplies `latestTurnCompleted` for both the success dot and completed count; opening another turn clears that completion until its own `turn/end`. Duration advances once per second only for an open turn on a running child and freezes after the child becomes inactive; an interrupted open turn is bounded by its same-cut `active.through`, never by newer session metadata.

### Composer election

One-shot and unknown-mode children elect a read-only composer. Continuable children route prompts through `subagents/prompt`. This package never receives host context or calls a model-facing tool.

Unknown-mode catalog rows remain visible and clickable, using the child id when no label is available. Their composer is read-only until child history establishes a supported mode; a read failure is reported in the child conversation.

Lineage-menu highlights follow the [standard menu edge geometry](../../../docs/ui-radius.md#nested-hover). Each branch disclosure target covers its 28px left gutter and full row height without overlapping adjacent rows; only the 12px glyph rotates in place, and disclosure clicks do not trigger row or sidebar navigation. Disclosure hover highlights only its arrow; navigation-body hover and keyboard focus retain their background highlight. Thin level-3 border connectors align with the first-line glyph centers, cross reserved disclosure space to reach leaf status glyphs, and end the final vertical stem at its glyph center.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

These pages cover the conversation surface and the host seam.

- [ui-conversation](../ui-conversation/README.md) - the chat surface hosting the catalog and composer chain.
- [ui-input-trigger](../ui-input-trigger/README.md) — the suggestion machinery hosting the `@` source.
- [subagent](../../subagent/subagent/README.md) — the host-side capability seam behind continuable children.
- [Current-turn interrupt](../../subagent/subagent/README.md) — the independent Stop semantics.

-----

<a id="model-experience"></a>
## Model Experience

### Subagent label text in the user prompt

#### What the model sees

Only the `@` reference source affects model input: a picked candidate reaches the ordinary user message as literal `@label`, without a dedicated block or host-side resolution. Catalog browsing, child navigation, and persisted transcript viewing add no prompt section; accepted continuation content becomes a normal FIFO user message through the host subagent adapter.

#### Token effect

Conditional and append-only: the literal `@label` or a human follow-up adds tokens only to its new user message. Catalog and transcript operations add zero model tokens.

#### KV Cache effect

Append-only. This package never edits earlier request tokens.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define what the catalog can show and what `@` references mean; they are current package constraints.

- **Non-completed inactive outcomes remain grouped** — the catalog distinguishes a latest normal completion from other inactive states, but does not distinguish failure, cancellation, refusal, token exhaustion, or a child with no closed turn; the UI exposes no Activation identity, and stopping is limited to the composer's current-turn Stop for a running continuable child.
- **`@` references remain display-title text** — duplicate or renamed labels are ambiguous, so they intentionally do not acquire continuation semantics.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
