---
name: dsh-prune-agent-notes
description: Use when adding, auditing, pruning, or reviewing Agent Notes in deepseek-harness; checks every new note for superseded active records, deletes small UI and purely mechanical records, classifies other implemented notes by future decision value, deletes implemented notes that no longer guide work, and deletes rejected notes that no longer prevent a tempting fallacy.
---

# Prune DeepSeek Harness Agent Notes

Reduce the Agent Note corpus without erasing rationale that can still guide work. Judge every note semantically; word count and age are discovery aids, never deletion criteria.

## Read the contracts

Read [the Agent Note rules](../../notes/README.md) and the applicable lifecycle instructions before classifying. Use current code, configuration, package docs, generated catalogs, newer Agent Notes, and inbound links to establish whether a rationale still owns or constrains anything.

## Check supersession when adding a note

Before drafting, apply the [creation criteria](../../notes/README.md#when-to-write-one). Every new Agent Note triggers a scoped audit of active notes covering the same decision, mechanism, or rejected alternative. Classify each full or partial supersession while writing the new note: delete qualifying implemented notes in the same PR, retain and cross-link partial supersessions or independently useful rationale, reject obsolete proposals, and delete rejected notes that no longer prevent a plausible mistake. Apply the Agent Note consolidation rule when the new owner absorbs every unique proposition; do not defer a known match to a later corpus audit.

## Classify by future value

Apply these lifecycle-specific outcomes:

- **Implemented — delete as mechanical:** delete notes that only describe small UI adjustments or purely mechanical changes. Local bug fixes, performance changes, new capabilities, and substantive behavior or ownership decisions do not qualify merely because they are implemented.
- **Implemented — keep:** retain a note when its rationale, alternatives, negative guarantees, durable/wire semantics, ownership boundary, security rule, or reintroduction condition is likely to guide a future change. Classify the decision, not the mechanics of its implementation: a mechanical rename or type extraction can still record lasting naming, compatibility, or ownership rules. Length does not matter.
- **Implemented — delete as complete:** delete a substantive decision when it is complete and unlikely to guide future work. Git history remains the only copy, so keep the note when in doubt.
- **Proposed — never delete directly:** keep a live proposal; if it is no longer worth pursuing, reject it with an honest reason and satisfy the rejected lifecycle format.
- **Rejected — keep only as a guardrail:** retain a rejection only when the losing proposal remains a tempting, meaningful mistake and the note explains why it loses.
- **Rejected — delete:** delete the note when the rejected idea is obsolete, superseded, no longer plausible, or unlikely to prevent re-litigation.

Do not delete toward a quota. Inspect every note in scope, classify analogous groups under one principle, use best judgment for close cases, and record genuinely borderline decisions for the handoff.

## Calibrated examples

These examples set the bar; the word counts demonstrate that size is not the test.

Delete implemented notes such as:

- collapsed sidebar control rail — 533 words: closed, minor UI behavior;
- issue-policy module ownership — completed function relocation and import rewiring with unchanged behavior.

Keep implemented notes such as:

- event-sourced sessions — 248 words: foundational authority and durability boundary;
- single Harness-home resolver — 596 words: cross-product ownership rule;
- project session directories — 628 words: durable storage and identity policy;
- parallel pre-push gates — 400 words: borderline, but still guides gate scheduling and resource tuning;
- dropped image content block — 334 words: keep until multimodal support lands, because it states the coordinated reintroduction condition.

For rejected notes:

- keep folding the compaction package split — 426 words: the temptation to merge the packages remains meaningful;
- delete streaming workflow progress through tool calls — 972 words: its ACP/UI premise is obsolete;
- delete dropping ACP terminal metadata — 362 words: the later automation-only ACP decision resolved the question.

## Delete one note

1. Delete `foo.md`.
2. Search for inbound links from the repository. Redirect each to current authority when one exists; otherwise delete the citation, or the sentence or list item when it exists only to cite the deleted note. Do not invent replacement rationale.

## Validate and report

Run `pnpm run doc-sync`, `pnpm run lint`, and `git diff --check`; select any additional evidence through [dsh-pre-push-checks](../dsh-pre-push-checks/SKILL.md).

Report implemented notes kept and deleted, rejected notes kept and deleted, proposed notes rejected if any, and every genuinely borderline case with its word count and chosen outcome.
