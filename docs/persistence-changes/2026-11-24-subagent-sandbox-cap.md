---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-11-24-subagent-sandbox-cap

## Summary

Records a capped child's effective sandbox ceiling in the version-3 child descriptor and parent catalog entry.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-11-24-subagent-sandbox-cap
baseline: false
changes:
  - root: "event:subagent/catalog"
    previous: "2026-11-24-subagent-profile-identity"
    after: "d92018194b620d0958842e27d130e6b748474e0a910066dbfa62ecfcadace791"
    decision: same-version
  - root: "event:subagent/descriptor"
    previous: "2026-11-24-subagent-profile-identity"
    after: "6aa2a0586a93b99fa99b69d06130f3191355d8ac5db708bc8246cfd9e15b7bf4"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Current readers accept earlier descriptors and catalog facts without altering their behavior. A missing mode keeps the existing delegation policy and shows no permission chip. The catalog projection stays at state version 6 and reuses historical checkpoints; a capped suffix produces the same result as full replay. The child identity projection stays at state version 2 because it does not store the ceiling. Older strict catalog readers reject a capped fact, and older descriptor readers reject the new field before cold continuation can run without its guard. The Session log decoder retains the complete event rows, so neither rejection loses history. No Session header change or adjacent migration is needed.

<a id="verification"></a>
## Verification

`./node_modules/.bin/vitest run packages/subagent packages/client/ui-subagent`: 1,163 tests passed, including descriptor validation, cold continuation with a widened standing policy, version-6 catalog checkpoint reuse with a capped suffix, and permission chip rendering.

<a id="dev-note"></a>
## Dev Note

None.
