---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-11-19-assistant-message-steered

## Summary

Adds an optional `steered: true` field to `assistant/message` data, recorded beside `interrupted` when a reply is cut so the agent can take the person's steer, so it reads apart from a reply cut by Stop.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-11-19-assistant-message-steered
baseline: false
changes:
  - root: "event:assistant/message"
    previous: "2026-09-16-session-format-v4"
    after: "d395a54e975b4530bb5ea6e794b940d7d150515b71e9be8650c7372e1b7b8f7a"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Same version. The field is optional and only written as `true`; logs written before this change omit it and read as not steered. Older readers ignore the unknown optional field, and no existing field changes meaning.

<a id="verification"></a>
## Verification

`pnpm run verify-persistence-catalog` and `pnpm run verify-persistence-changes` pass with this record. The agent-loop and session suites pass (1,077 tests), including the loop case where a steer cuts a hanging reply and the recorded assistant message carries `steered: true`.

<a id="dev-note"></a>
## Dev Note

None.
