---
name: create-connector
description: Use when the user wants Jan to connect to an outside app or service, add an MCP server (a URL or a command), or build a new agent tool, and when a connector fails to start or its tools are missing.
---

# Connectors: MCP servers and agent tools

A connector gives every chat in this profile new `mcp__<server>__<tool>` tools. Jan connects an MCP server through a configuration-only bundle that mounts the shipped `@janhq/jan-mcp-client`, installed with `plugin_manager` `action: install_bundle`. The installed connector survives restart and appears in Customize > Plugins, where the user can turn it off. Servers a person adds by hand in Customize > Connectors are stored separately; do not edit that list.

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

Call one newly available `mcp__<serverName>__<tool>` tool with a harmless request, such as a list or a ping, and show the user the result. On failure, read the install warnings, fix the same bundle and reinstall it; never create a second bundle for the same server. Finish with the bundle path, the server name, the tools it added, and where to turn it off.
