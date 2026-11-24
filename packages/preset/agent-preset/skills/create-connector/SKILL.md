---
name: create-connector
description: Use when adding an MCP connector to Jan from a remote URL or local command, connecting an external service, or debugging a connector that fails to start or exposes no tools. For an app-native agent tool, use create-plugin.
---

# Create a Jan connector

For an existing server that the user just wants to connect, point them to Customize > Connectors on Desktop (MCP Servers in Settings), where Jan manages named servers, enablement, and tools. For a connector packaged for reuse, author a configuration-only bundle that mounts `@janhq/jan-mcp-client`. Install it into the active profile with `plugin_manager`; it persists across restart and can be turned off in Customize > Plugins. Do not rewrite the separate server list behind Customize > Connectors.

## Choose the shape

| The user has | Build |
|---|---|
| A remote MCP endpoint, such as `https://example.com/mcp` | the template with `transport: streamable-http` and `url` |
| A local MCP command, such as `npx -y <package>` or `uvx <package>` | the template with `transport: stdio`, `command`, and optional `args`, `env`, and `cwd` |
| An `mcpServers` JSON entry from another app | the same template: `command`, `args`, and `env` become a stdio row; `url` becomes a streamable-http row |
| A job no existing server does | a small stdio MCP server script in the workspace, connected with the stdio template |
| A tool that needs Jan state (sessions, settings, the UI) | not a connector: load `create-plugin` and write a Host tool plugin |

Look for an existing, maintained MCP server for the service before writing one. For a new server, use a runtime the machine already has (check `node --version` or `python3 --version`) and that language's official MCP SDK, keep it to one file, and point `command` at the runtime and `args` at the script's absolute path. Give each tool a short name, a description of what it does and returns, and a parameter schema; load `agent-experience` for tool-definition rules.

## Build and install

The template lives in this skill's base directory, which the `skill` tool reported. Read each file with the file-read tool and write it into one new workspace directory; in Desktop the directory sits inside `app.asar`, where shell commands, glob, and search fail. Never install the template in place.

1. Copy `templates/mcp/package.json`, `templates/mcp/cordis.patch.yml`, every file in `templates/mcp/locale`, and `templates/mcp/icon.svg`.
2. Set a unique package `name` (`@local/<server>-mcp`), the patch row `id` (`<server>-mcp`), `serverName` (lowercase letters, digits, and hyphens; it becomes the tool prefix), and the endpoint or command. Keep `failOnStartupError: true`, so a server that cannot start fails the install instead of silently adding no tools.
3. Replace each locale's `meta.title` and `meta.description` with the service's name and what it lets Jan do, and replace the icon with an original or licensed glyph. Load `create-plugin` for the full display checklist.
4. Never paste a key or token into the conversation, the patch, or a file. Ambient credentials are scrubbed from the server's environment; reference an existing credential with Loader `!!js`, or ask the user where the key is stored. `Config.listConfigs` on the installed row returns the complete client schema, including `env` and `headers`.
5. Install with `plugin_manager` `action: install_bundle` and the absolute directory as `target`, then read `application` and `warnings`.

## Verify and report

Check `application` before claiming the connector is active. Verify the bundle in Jan's Plugins page, then make a harmless call to one of its `mcp__<serverName>__<tool>` tools, such as a list or ping. On failure, read the install diagnostics, fix the same bundle, and apply it again; follow `restart-required` if returned. Finish with the bundle path, the server name, the verified tools, and where to turn the bundle off.
