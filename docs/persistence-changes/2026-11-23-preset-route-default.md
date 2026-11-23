---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-11-23-preset-route-default

## Summary

`agent-preset/selected` records gain an optional `source: 'route-default'` marker. The registry writes it when a blank Session adopts the preset its model route defaults to, so a later route change can follow the new default; a record without the marker is an explicit pick and stays pinned.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-11-23-preset-route-default
baseline: false
changes:
  - root: "event:agent-preset/selected"
    previous: "2026-09-11-initial"
    after: "fb337485cb5d29c811f5104371cbeb271b66469f5987ce90713747c6075f4c0c"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Same version. Older records have no marker and are read as explicit picks, which is the conservative reading. Older readers ignore the unknown optional field and resolve the same preset ID from new records.

<a id="verification"></a>
## Verification

`pnpm exec vitest run packages/preset/agent-preset-registry/tests/registry.spec.ts packages/api/session-controller/tests/session-presets.host.spec.ts` covers marked and unmarked records, route-default following, and explicit same-ID picks staying pinned.

<a id="dev-note"></a>
## Dev Note

None.
