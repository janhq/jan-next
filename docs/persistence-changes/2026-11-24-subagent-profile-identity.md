---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-11-24-subagent-profile-identity

## Summary

Adds an optional agent profile id to the version-3 subagent descriptor and parent catalog payloads, separate from their creation labels.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-11-24-subagent-profile-identity
baseline: false
changes:
  - root: "event:subagent/catalog"
    previous: "2026-11-02-subagent-catalog-names"
    after: "fc5fb3e11a0893eda3d103559c51e7ee2bb980446a7427c06d3c1e3da70df7ab"
    decision: same-version
  - root: "event:subagent/descriptor"
    previous: "2026-09-11-initial"
    after: "4361a3d93547526a10405800027dea7d8c1b9705f120b42d3a96bbc66a3ba5a7"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Current readers accept all previous payloads with their original meaning. A missing id means that no profile was recorded; labels are never parsed or changed during replay. Projection state versions remain 2 for identity and 6 for the catalog: historical checkpoints without the field remain readable and replaying a profiled suffix matches full replay. The V4 log decoder keeps complete JSON event rows and does not treat the added field as tail damage. Older strict catalog projections reject profiled facts during projection restoration, and older descriptor readers reject the extra field before cold continuation can execute; neither projects the new field as a creation label or truncates the persisted row. No Session header change or adjacent migration is needed.

<a id="verification"></a>
## Verification

./node_modules/.bin/vitest run packages/subagent packages/client/ui-subagent: 1155 tests passed, including mixed historical and profiled catalog facts, historical identity and catalog checkpoint suffix replay, and JSONL storage, observation and cold continuation of a profiled child.

<a id="dev-note"></a>
## Dev Note

None.
