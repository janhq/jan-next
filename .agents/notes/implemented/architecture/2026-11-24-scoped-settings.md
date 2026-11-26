# Agent Note: Resolve model, mode and tools by chat and project

Status: implemented

## Problem

Personal defaults are useful across chats, but a project can need a different model, mode, or set of tools. A chat still needs to choose its own model and mode without changing the project or other chats. Project settings must not modify the checkout.

## Decision

Model and mode resolve from a chat's selection, then the project default, then Jan's global default. The Session controller uses the project model, including its reasoning effort, when a chat has not selected its own. It treats an available project mode as an explicit preset choice when starting a chat, so a later model change does not switch the preset. The existing model selection and preset mechanisms keep those chat choices in the Session log, with no second source for replay or resume.

Tool restrictions combine rather than override: the [scoped settings service](../../../../docs/subsystems/settings.md#scoped-settings) takes the union of disabled tool and MCP server entries for the global, project, and chat scopes. A narrower scope can add restrictions but cannot undo a wider one. The service applies them to each live agent's tool registry and resolves MCP server entries to tool names as registrations change.

Project defaults and the three scopes' tool switches live in `$JAN_HOME/settings/scoped.json`. Host-wide plugins, such as themes and sidebar contributions, remain global because they are mounted once for the Host, not separately for each chat.

## Alternatives considered

**Mount separate plugins for each chat.** The [preset registry](../../../../packages/preset/agent-preset-registry/src/index.ts) shares composition generations across chats using a preset. Per-agent tool restrictions preserve that sharing and leave Host-wide plugin lifecycle unchanged.

**Write project settings into the repository.** These are personal defaults, not project configuration to commit or share. Keeping them in Jan's home also works when the checkout is read-only.

## Consequences

Changing the project mode affects how chats start, not the modes of chats already underway. Removing a tool restriction only re-enables the tool where no other scope still disables it.
