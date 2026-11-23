---
description: "Record the schedule domain v3 project binding and compatibility with v1 and v2."
---

# Schedule domain v3: project binding

## Summary

The standalone `schedule` storage domain now persists the project identity for tasks whose destination creates Sessions. This changes the domain version, not the Session format or the SQLite physical schema.

## Compatibility

The v3 decoder accepts v1 and v2 unit stamps. Old tasks with an explicit saved cwd keep its original runtime meaning. A Session-creating target with neither an ID nor a saved cwd resolves the default project the next time it creates a Session, and saves the binding before creation. A retry already holding a Session uses that Session unchanged. The old Host working directory was not a user choice. Opening or reading the store does not rewrite it. A successful mutation stamps the unit v3, leaving untouched rows readable without conversion. Older binaries reject a v3 unit instead of executing a task without honoring its binding.

New destination declarations persist an optional `create.workspaceId` and canonical directory. `new_once` retains the identity on its resulting `session` target. A missing registered project pauses the task and saves `deliveryFailure: { code: "project-removed", failedAt }` without recording an inbox acknowledgement. Re-registering the same directory does not change the original task's identity.

See the [schedule storage reference](../../../packages/schedule/schedule/README.md#storage-format) for the active schema and backend behavior.

## Verification

The schedule package tests cover v1 and v2 reads, upgrade on write, canonical path and ID binding, legacy cwd delivery, lazy default resolution after opening an old store, project-aware delivery, and pausing instead of delivering to a removed project.
