---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-11-16-remove-deepseek-events

## Summary

Removes the `session-log-deepseek/delivery-accepted` and `web/deepseek-search-llm-request` events together with the DeepSeek session-log and DeepSeek search plugins that wrote them.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-11-16-remove-deepseek-events
baseline: false
changes:
  - root: "event:session-log-deepseek/delivery-accepted"
    previous: "2026-09-11-initial"
    after: null
    decision: same-version
  - root: "event:web/deepseek-search-llm-request"
    previous: "2026-09-11-initial"
    after: null
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

No producer writes either event. The events are not marked ignorable, so this build refuses to read an existing log that contains one instead of reconstructing the Session without it. Older builds keep reading logs written by this build because both events were optional log-only records that no reader replayed. No Jan release wrote either event.

<a id="verification"></a>
## Verification

pnpm --silent run verify-persistence-changes --json reported only the two root removals before recording.

<a id="dev-note"></a>
## Dev Note

None.
