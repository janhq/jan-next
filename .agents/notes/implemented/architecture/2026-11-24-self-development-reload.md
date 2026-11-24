# Agent Note: Hold development Host reloads while chats run

Status: implemented

## Problem

Jan can work on its own checkout. A browser plugin swap leaves running chats alone, but replacing the Host plugins an agent uses can stop its current step. A development loop needs to apply edits without stopping the work that produced them.

## Decision

`pnpm run dev:desktop:watch` runs the [rebuild watchers](../../../../scripts/dev-web.ts) for Client and Host packages. TypeScript and tsdown rebuild the package `lib` outputs; plain JavaScript plugins are served from their source files. [Client HMR](../../../../packages/client/hmr/README.md) swaps browser plugins in place. The Desktop Host reads a development patch from `JAN_DESKTOP_DEV_PATCH` that configures [jan-hmr](../../../../packages/boot/hmr/README.md#reload-gate) to watch the built package files and plugin directories. The patch also mounts [dev-reload](../../../../plugins/dev-reload/README.md), a Desktop development dependency that is not part of the shipped profile.

Jan HMR owns the queue of changed Host modules. The dev-reload plugin installs the gate that holds replacements while an agent is running and applies them automatically once all agents are idle. **Reload now and continue** applies the held changes immediately, then queues a message asking affected chats to check what finished and continue.

Host modules that cannot be replaced live and changes to watched Desktop build outputs produce a **Restart** notice. Its action saves the running chat IDs in `$JAN_HOME/dev-reload/continue.json` before calling the Electron restart IPC. In watch mode, Electron shuts down with code 75 (`JAN_DESKTOP_RESTART_EXIT_CODE`), so the launcher starts it again with the same environment and keeps its watchers. Outside watch mode the IPC uses `app.relaunch()`. At Host readiness, dev-reload consumes the record and queues the continuation messages if it is no more than 15 minutes old.

## Alternatives considered

**Replace Host plugins immediately.** This can stop active steps even when nobody asked to interrupt them. Deferring is the default; the notice provides an explicit override.

**Restart the app automatically.** A full restart can interrupt chats and disrupt the developer's window. A notice lets the developer choose when to restart.

**Put the chat policy in jan-hmr.** That would make a base-bundle reload service depend on the agent registry and Session controller. The optional gate keeps HMR independent of both.

## Consequences

Waiting preserves active steps. Choosing to interrupt starts a new queued prompt from the saved conversation; it does not resume an in-flight tool or model request at the point where it stopped. See [the development guide](../../../../docs/development.md#developing-jan-from-inside-jan) for which changes need a manual build or restart.
