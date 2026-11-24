---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-11-24-skill-catalog-search

## Summary

A `skill-catalog` message source gains an optional `search: true` marker. `jan-tool-skill` writes it when its `catalogMode` is `search`: the catalog lists pinned skills with descriptions and the rest by name, and the model finds the others through `skill_search`. Catalogs written in `full` mode omit the marker, as every earlier record does.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-11-24-skill-catalog-search
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-11-22-session-reference-pointer"
    after: "49db4ed6efc91e5793e149f39bcd7f72689eb8122b962b69196139758e1811d4"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-11-22-session-reference-pointer"
    after: "7402101a137bb16208c4c523ebdd723189e2388f602212385f8bd8e26f006f90"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-11-22-session-reference-pointer"
    after: "5a99e2b421266eeeaa3cbd3eef7929151f24b6ed252b16afa7555b15dea31c2a"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-11-22-session-reference-pointer"
    after: "fa466f16258fdbe86bda01e67e87f1622d0dae85aefc74aaacc9ea59591e252f"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Same version. The property is optional and only added, so every existing session log still parses and replays unchanged; a reader that predates the marker ignores it and treats the catalog as a complete list, which is the `full` mode meaning.

<a id="verification"></a>
## Verification

`pnpm exec vitest run packages/skill/tool-skill/tests` covers both catalog modes and the marker; `pnpm run verify-persistence-changes` matches the current schema to this record.

<a id="dev-note"></a>
## Dev Note

None.
