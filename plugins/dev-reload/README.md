# Development reload

Keeps chats running while Jan rebuilds itself. `pnpm run dev:desktop:watch` mounts this plugin through its development overlay; no shipped profile selects it.

## What happens to a change

| Change | While no chat runs | While a chat runs |
| --- | --- | --- |
| Browser plugin code (`lib/client.js`, `plugins/*/client.js`) | Client HMR swaps it; chats keep streaming | Same |
| Host plugin or package code | [jan-hmr](../../packages/boot/hmr/README.md#reload-gate) replaces the changed plugins at once | Held. A notice says how many chats it waits for; the change applies on its own when they all finish |
| Rebuilt Desktop main, application preload, or Desktop Host entry, or a module the Host process loaded at start | A **Restart** notice | Same; chats that were running continue after the restart |

**Reload now and continue** applies held changes at once. Replacing a running chat's agent ends its step, so each chat that was running, or whose subagent was running, then receives a queued message asking it to check what finished and continue.

**Restart** records the running chats in `$JAN_HOME/dev-reload/continue.json`, then calls `janDesktop.restartApplication()`. Electron exits with code 75 in watch mode, so the launcher relaunches it without stopping the watchers. When the new Host is ready, the plugin removes the record and queues the same message if the record is no more than 15 minutes old. Without the Desktop restart IPC, the notice asks you to restart the process yourself and does not record chats for continuation.

Closing a notice hides it until the held file count, the running chat count, or the restart reason changes.

## Configuration

| Field | Default | Meaning |
| --- | --- | --- |
| `restartWatch` | `[]` | Files whose change needs a restart, polled every second. |
| `continueText` | A short "check what finished, then continue" message | Text queued to interrupted chats. |

## Implementation

The Host half installs the HMR reload gate: it holds while any agent runs. On `hmr/held` one waiter waits for every running agent to become idle, rechecking each second, and calls `ctx.hmr.applyHeld()`. `hmr/restart-required` and `restartWatch` set the restart state. The client polls `POST /jan-api/dev-reload` (`state`, `reloadNow`, `prepareRestart`) every two seconds and shows one notice in `shell.overlay`.
