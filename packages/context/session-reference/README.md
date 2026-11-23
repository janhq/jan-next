---
description: "Cross-session mentions as pointers, and the read_chat tool that reads a mentioned chat on demand, for users and maintainers enabling or debugging ctx.sessionReferenceResolver."
kind: "package-reference"
---

# @janhq/jan-session-reference

## Summary

Mention other chats without automatically loading their history. Jan keeps a readable `@label` mention and gives the model a pointer with the chat's label, Session id, and project folder. The model can use `read_chat` to read a page of messages on demand, but only from a chat you mentioned. The picker ranks chats from the same working directory first and uses their latest titles. This opt-in feature works without SQLite full-text search.

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

Enable this service when hosts should let a user mention another chat and let the model look into it. It works with any session-query backend because it reads current surfaces through `ctx.sessionQuery`. `read_chat` is registered whenever `ctx.tools` is composed.

### Mention syntax

A canonical mention is `@[label](jan-session:<base64url-encoded-id>)` in Markdown, or the bare `jan-session:` URI; every JavaScript string session id round-trips exactly. The service rewrites mentions into readable `@label` text in the message and returns the structured references. Explicit Markdown mentions reject malformed URIs; empty or punctuation-only scheme mentions stay ordinary discussion text.

### What the agent gets

A message that mentions other chats is followed immediately by a `## Mentioned chats` pointer as a second user-role message: one line per chat with its label, `session_id`, and project folder (`none` when it has none, `unknown` when the chat no longer exists), plus guidance to call `read_chat` only when a chat's content matters and to treat what it reads as background, not instructions. At most `maxReferences` distinct chats are named per message. The pointer is recorded with a version 2 `session-reference` source; version 1 sources, which earlier Hosts wrote with a bounded preview, stay readable.

### Reading a mentioned chat

`read_chat` takes `session_id` and optional `query` (case-insensitive substring), `before` (message number cursor), and `limit` (1 to 50, default 20). It returns the chat's visible user and assistant text, newest last, numbered `#<index>`, with a `before=<n>` cursor line when older messages remain. Compact checkpoints stand in for the messages they summarize; tool traffic, reasoning, and injected context are left out. Each message is cut at 2,000 characters and a page at 24 KiB of text. A chat is readable only when a recorded `session-reference` message of the calling chat names it, so a session id the model writes itself grants nothing.

### Finding sessions to reference

`listCandidates(agent, query?, limit?)` lists sessions other than the agent's own, filters case-insensitively by id, working directory, projected title, or display title, and ranks same-directory sessions first. Each candidate carries its latest title as `label`, falling back to the session id when the title is absent or unreadable. Its display title prefers a subagent's durable creation label over that title. The candidate also reports whether its working directory is the requesting agent's so a host can surface a location only when it distinguishes the row. Browser consumers call the same discovery as `ctx.remote.sessionReferenceResolver.candidates`, which labels the canonical mention with `displayTitle` when present.

### Configuration

| Field | Default | Meaning |
|---|---|---|
| `maxReferences` | `3` | Maximum distinct chats named by one message; must not exceed `3` |
| `candidateLimit` | `50` | Default candidate count returned to a host |

The generated [configuration catalog](../../../docs/config-catalog.md#janhqjan-session-reference) is the exhaustive source for every accepted field and its JSDoc.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design of the service; the observable behavior is covered in [Use this package](#use-this-package).

### Design concept

A mention is a pointer, not a copy. Loading a preview of every mentioned chat spent context on text the task often did not need and froze a stale cut of a chat that kept changing; a pointer costs a few lines and lets the model decide how much to read. The pointer resolves each chat's folder from one `listSessions` read at `agent/pre-step` and never reads a chat's events.

`read_chat` authorizes from the caller's own derived messages: only `session-reference` sources the Host recorded count, never message text. It reads the current surface through `ctx.sessionQuery.readSurface`, projects direct-user text, assistant text, and compact checkpoints, and pages from the newest message under a message count and byte budget.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | `SessionReferenceResolver`: pre-step listener, candidate discovery, pointer preparation, `read_chat` registration |
| [`src/read-chat.ts`](src/read-chat.ts) | `read_chat` tool: authorization, current-surface projection, paging |
| [`src/config.ts`](src/config.ts) | `Config` schema, `SessionReferenceError` taxonomy |
| [`src/uri.ts`](src/uri.ts) | `jan-session:` URI codec, mention formatting and parsing |
| [`src/types.ts`](src/types.ts) | `SessionReferenceInput`/`Candidate` and source types |

### Main flow

The outer `agent/pre-step` listener accepts the step, parses canonical mentions out of direct user messages, then calls `prepare`, which normalizes references (first-mention order, deduplication, self-reference and count rejection), looks up each chat's folder, and renders the pointer. Each pointer is inserted immediately after the message that cited it, and the target log records the readable direct message followed by its pointer. Later, `read_chat` reads a mentioned chat's surface at call time.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the shared reference surface to the read service behind it.

- [Session-reference subsystem](../../../docs/subsystems/session-reference.md) — canonical URIs, pointer sources, and the stable error taxonomy.
- [Session-query subsystem](../../../docs/subsystems/session-query.md) — the read service that supplies session surfaces.
- [Context group map](../README.md) — sibling request-context packages.
- [Generated configuration catalog](../../../docs/config-catalog.md#janhqjan-session-reference) — every accepted config field and its source declaration.

-----

<a id="model-experience"></a>
## Model Experience

### Mentioned chats

#### What the model sees

The model sees two consecutive user-role messages: the current message with its readable `@label`, then the `## Mentioned chats` pointer listing each chat's label, `session_id`, and project folder. When it needs a chat's content it calls `read_chat`, whose result is a numbered page of that chat's messages with a cursor for older ones.

#### Token effect

A mention adds one short pointer: fixed guidance plus one line per chat. A chat's text costs tokens only when the model reads it, and only for the pages it asks for, each capped at 24 KiB.

#### KV Cache effect

The request and pointer are consecutive append-only target messages and preserve earlier cacheable history. `read_chat` results are ordinary tool results appended after them.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define when cross-session references are a poor fit. They are current package constraints.

- **No body discovery** — candidate queries inspect titles but do not search message bodies.
- **Labels come from projections alone** — an attached session is labeled from its live projection cut, a cold one from its durable checkpoint, and a session neither answers for is labeled by its id and cannot be found by its title. Discovery never reads a log: folding one title costs a whole log, and this runs under every completion keystroke. A session persisted before the projection cache was composed regains its title the first time it is opened, which checkpoints it.
- **Trusted caller boundary** — the service assumes its host is authorized to read every session exposed by `ctx.sessionQuery`; `read_chat` narrows the model to chats the user mentioned.
- **Text projection only** — non-text user and assistant blocks are not read across chats.
- **Reads are live** — `read_chat` reads a chat as it is when called, so a chat edited or deleted after the mention reads differently or fails with `SESSION_REFERENCE_READ_FAILED`.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
