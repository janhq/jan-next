---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-11-24-agent-profile-selection

## Summary

Records chat profile selections with the required `agent-profile/selected` event. The `agentProfile` projection stores the latest selected id or `null`.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-11-24-agent-profile-selection
baseline: false
changes:
  - root: "event:agent-profile/selected"
    previous: null
    after: "776de1b95df5e96176c53d045a96d576a0936d81b7ec50266ed4a23dcbc0b3db"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Existing Session logs remain readable: without a selection event the projection starts at `null`, so the chat has no selected profile. Selection and clearing can appear with existing events without changing their interpretation. Older readers without the event in their installed vocabulary refuse the unknown required record before resuming or mutating the Session; native JSONL reads and appends do not treat it as a recoverable tail. No existing payload or Session header version changes.

<a id="verification"></a>
## Verification

Ran `pnpm exec vitest run packages/preset/agent-profiles/tests/agent-profiles.host.spec.ts packages/session/session-format-v3-to-v4/tests/open-vocabulary.spec.ts packages/session/session-persistence-jsonl/tests/current-event-admission.spec.ts`: 13 tests passed. The tests cover selection and clearing, refusal of unknown required records, and unchanged file bytes and identity on a refused JSONL read or append.

<a id="dev-note"></a>
## Dev Note

None.
