---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-11-22-session-reference-pointer

## Summary

The `session-reference` message source gains a version 2 alternative. A user mention of another chat now records a pointer (each mentioned chat's `sessionId`, `label`, project folder `cwd`, and `inputIndex`) instead of a bounded preview of the chat's messages; the model reads a mentioned chat on demand with the `read_chat` tool. The version 1 preview alternative stays in the union unchanged, so logs written before this change keep their recorded shape. The change is recorded as same-version.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-11-22-session-reference-pointer
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-11-17-jan-session-title-source"
    after: "c1cdbdd7c13951b3229fbfbacf1eccd3b01ddb477473f34c0f4c2ed611f3cd80"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-11-17-jan-session-title-source"
    after: "dfe3b953b6ae203f965d456e5559ce75132a3ec1f2be44df8eb6a8707a9b6779"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-11-17-jan-session-title-source"
    after: "aca854451c7d4e4794991ad27d8989ff4b512486d52288442d6178a21ff54a87"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-11-17-jan-session-title-source"
    after: "f8210776398c32b991614f6537d33173d79e5aaa781b0ccc68d1944d033a20df"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

New readers: version 1 sources remain a declared alternative, so existing logs keep their meaning. The Session core does not validate `session-reference` source payloads (`packages/core/session/src` has no kind-specific source validation); it replays the message content as recorded, and the preview text a version 1 message carried still reaches the model as before. `read_chat` authorizes a chat when any recorded `session-reference` message of the caller lists its `sessionId`, so chats mentioned under version 1 are readable too.

Older readers: the source discriminator `version` distinguishes the alternatives, and older readers never interpret a `session-reference` payload beyond its `references[].label` list. The browser projections (`packages/client/ui-chat/src/client/conversation-nodes/event-projection.ts` and `packages/client/ui-trajectory/src/client/trajectory-event-projection.ts`) read only that list, which version 2 keeps, so they label the recall row the same way. An older Host replaying a log with a version 2 message passes its text to the model unchanged: the text names the chats and the `read_chat` tool, which that Host does not register, so a call fails as an ordinary unknown-tool result without corrupting or truncating the log. No header version change is needed.

<a id="verification"></a>
## Verification

`pnpm exec vitest run packages/context/session-reference --coverage` passed 23 tests at 100% per-file coverage, including a real Loader composition that records the pointer at pre-step and reads the mentioned chat through `read_chat` over `jan-session-query-sqlite`. `pnpm --silent run verify-persistence-changes --json` reported only the four `session-reference` union-variant paths before this record was generated.

<a id="dev-note"></a>
## Dev Note

None.
