# Legacy import

Open **Settings -> Built-in plugins -> Import sessions** to select an import, or start `/migrate` in a chat. Preview shows the ready chat count, server and settings names, already-imported items, and any skipped or unreadable entries for each source. In a chat, `/migrate` shows one form per app that names the folders it read and lists every ready item ticked, with older chats unticked; only the items left ticked when the user submits are imported, and the chat reports what was actually added. Neither flow changes source files.

| Source | Chats | Local MCP servers and connectors | Skills and global instructions | Other settings |
| --- | --- | --- | --- | --- |
| Earlier Jan | Yes, including Cowork history | `mcp_config.json` in the Jan data folder | None | Supported model providers and saved API keys; assistants as agent presets |
| Claude Code | Yes | `~/.claude.json` (including `projects.*.mcpServers`) and `~/.claude/settings.json` | `~/.claude/skills` and `~/.claude/CLAUDE.md` (honors `CLAUDE_CONFIG_DIR`) | None |
| Claude Desktop | No | `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS, the Claude app-data directory on Windows, or the Claude XDG config directory on Linux | None | None |
| Codex | Yes | `~/.codex/config.toml` (`mcp_servers`; honors `CODEX_HOME`) | `~/.codex/skills` and `~/.codex/AGENTS.md` | None |
| OMP | Yes | `~/.omp/agent/mcp.json` | `~/.omp/agent/skills` and `~/.omp/agent/AGENTS.md` | None |
| Cursor | No | `~/.cursor/mcp.json` | `~/.cursor/skills` | None |
| Orca (manual import only) | Claude Code, Codex, and OMP chats run in Orca workspaces | Use the source that configured the server | Use the source app | None |

Supported transports are local stdio and Streamable HTTP. Stdio imports keep executable, arguments, working directory, and explicit environment. HTTP imports keep the endpoint and configured headers. Environment references are resolved from the Jan host environment or, for Claude Code, from the source settings' `env` when present. Codex also supports locally inherited variables, bearer token variables, and environment-backed headers. Env and header values go straight to Jan's credential store; neither previews nor results expose them. Servers arrive disabled, and an existing Jan server name and its credentials are never overwritten. Distinct project definitions with the same name in a source receive distinct Jan names.

Skills are copied into `<JAN_HOME>/skills`, without `node_modules` or `.git`; a skill whose name Jan already loads, an existing `<JAN_HOME>/AGENTS.md`, and a Jan skills folder that links outside the Jan home are kept as they are. The form names the source app's plugins, commands, rules and sub-agents, which stay behind because Jan cannot run them.

App-managed OAuth sessions, cloud-only connectors, installed plugins/extensions, and unlisted settings do not transfer. Reauthorize accounts separately. Legacy SSE, URLs with credentials/query/fragment, and entries that need unresolved variables or shell credential commands are not imported; the preview explains why. Tool settings specific to the original app do not transfer. Jan chat import keeps message text, local images, reasoning, tool history, and token counts, but not audio, video, remote images, or streaming timings. Coding-agent chat import keeps text, reasoning, tool history, and token counts, but not images, sub-agent side conversations, or encrypted reasoning. The default preview shows coding-agent chats from the last 30 days; older chats can be selected separately.
