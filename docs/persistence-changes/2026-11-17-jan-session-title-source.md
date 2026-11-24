---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-11-17-jan-session-title-source

## Summary

Renames the `dsh-session-title-llm` message source kind to `jan-session-title-llm`, following the rename of the session title plugin package.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-11-17-jan-session-title-source
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-27-retry-control-input"
    after: "c054c55ae60096883c7181672e5dfca98c321fdb02caa2774c87cf1993e022f9"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-27-retry-control-input"
    after: "e5dbea4f253774e8975cc0e6d4521bf723655ff6b67a2fe3cee67ec7ff6fca50"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-27-retry-control-input"
    after: "e6345b1a4df22f3c4ec710cc62f8f8e94b9388dd6bbd51e7041d7ddaef3bb6df"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-27-retry-control-input"
    after: "44e533301aee29f0337872fde2b9c7486068e2bfb96348dbb6012fe8bd28ae4c"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

The writer records `jan-session-title-llm` for title-request messages. A log that carries the old `dsh-session-title-llm` kind no longer matches the declared source union. No Jan release wrote the old kind.

<a id="verification"></a>
## Verification

pnpm --silent run verify-persistence-changes --json reported only the source kind union changes before recording.

<a id="dev-note"></a>
## Dev Note

None.
