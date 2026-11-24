---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-11-25-todo-reminder-attribution

## Summary

Records unfinished-todo reminders as model-visible messages with a todo-reminder attribution kind.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-11-25-todo-reminder-attribution
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-11-24-skill-catalog-search"
    after: "56dcf37461cb27d0810ff6acace4c1fd1f6243fe76aaecd46304381941a4350d"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-11-24-skill-catalog-search"
    after: "0878fa8770f911d6295a04a6f68d428d48cab49f6590baeb5ea4ef894ca9c150"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-11-24-skill-catalog-search"
    after: "641044d0cf279f7aac4e094f904064ea3468339b4357a68e83d31a9f18489c9a"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-11-24-skill-catalog-search"
    after: "f78584d9f43fbac3c29fed31dce1b0ca1677bdc7a9449f05f1482cfc433425b4"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Same version. Existing messages and events keep their original meaning. Older V4 readers preserve unknown attribution kinds and their JSON metadata; they replay the recorded reminder text as a message without the todo producer. The attribution carries no execution or reader-side requirement.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/todo/tool-todo/tests/integration.spec.ts packages/subagent/tool-subagent-control/tests/wait-agent.spec.ts passed 30 tests. pnpm exec vitest run packages/session/session-format-v3-to-v4/tests/relationships.spec.ts passed 61 tests, including preservation of unknown attribution metadata.

<a id="dev-note"></a>
## Dev Note

None.
