# Legacy import

Open **Settings -> Import -> Local chats and settings** to select an import, or choose **Migrate in chat** to start a draft with `/migrate`. The Settings page lists ready and already-imported items, skipped or unreadable entries, and files it checked. In chat, `/migrate` shows the same supported settings and groups chats by age. Both paths import only the reviewed selection and check selected settings again before writing. Neither changes source files.

| Source | Chats | Local MCP servers and connectors | Skills and global instructions | Other settings |
| --- | --- | --- | --- | --- |
| Earlier Jan | Yes, including Cowork history | `mcp_config.json` in the Jan data folder | None | Supported model providers and saved API keys; assistants as agent presets |
| Claude Code | Yes | `~/.claude.json` (including `projects.*.mcpServers`) and `~/.claude/settings.json` | `~/.claude/skills` and `~/.claude/CLAUDE.md` (honors `CLAUDE_CONFIG_DIR`) | None |
| Claude Desktop | No | `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS, the Claude app-data directory on Windows, or the Claude XDG config directory on Linux | None | None |
| Codex | Yes | `~/.codex/config.toml` (`mcp_servers`; honors `CODEX_HOME`) | `~/.codex/skills` and `~/.codex/AGENTS.md` | None |
| OMP | Yes, with bounded starting context for long chats | `~/.omp/agent/mcp.json` | `~/.omp/agent/skills` and `~/.omp/agent/AGENTS.md` | None |
| Cursor | No | `~/.cursor/mcp.json` | `~/.cursor/skills` | None |
| Orca (manual import only) | Claude Code, Codex, and OMP chats run in Orca workspaces | Use the source that configured the server | Use the source app | None |

Supported transports are local stdio and Streamable HTTP. Stdio imports keep executable, arguments, working directory, and explicit environment. HTTP imports keep the endpoint and configured headers. Environment references are resolved from the Jan host environment or, for Claude Code, from the source settings' `env` when present. Codex also supports locally inherited variables, bearer token variables, and environment-backed headers. Env and header values go straight to Jan's credential store; neither previews nor results expose them. Servers arrive disabled, and an existing Jan server name and its credentials are never overwritten. Distinct project definitions with the same name in a source receive distinct Jan names.

Skills are copied into `<JAN_HOME>/skills`, without `node_modules` or `.git`; a skill whose name Jan already loads, an existing `<JAN_HOME>/AGENTS.md`, and a Jan skills folder that links outside the Jan home are kept as they are. The form names the source app's plugins, commands, rules and sub-agents, which stay behind because Jan cannot run them.

App-managed OAuth sessions, cloud-only connectors, installed plugins/extensions, and unlisted settings do not transfer. Reauthorize accounts separately. Legacy SSE, URLs with credentials/query/fragment, and entries that need unresolved variables or shell credential commands are not imported; the preview explains why. Tool settings specific to the original app do not transfer. Jan chat import keeps message text, local images, reasoning, tool history, and token counts, but not audio, video, remote images, or streaming timings. Coding-agent chat import keeps text, reasoning, tool history, and token counts, but not images, sub-agent side conversations, or encrypted reasoning. The default preview shows coding-agent chats from the last 30 days; older chats can be selected separately.

## AI app export

Open **Settings -> Import -> AI app export**, or choose **Import a bot** in Bots. Use **Copy export prompt** in the source app, then paste its reply, choose one or more `.json`, `.txt`, or `.md` files, or do both. Jan accepts complete `grok-bot-export` version 1 documents, including split documents wrapped in Markdown. The preview writes nothing, rejects exports that appear to contain credentials, and can be confirmed once. Select the bots to create and review the outcomes before importing again. Existing bots are not replaced.

Bots go into the default project with their instructions, memory, and supported cron routines. Paused routines stay paused. Active routines can run while Jan is open. Slack, GitHub, and other non-schedule triggers are not imported. Skill names referenced by routines are kept as notes; automatic skill bindings do not transfer. Imported skills go into `$JAN_HOME/skills` without replacing existing skills and are user-invocable only. Valid HTTPS MCP servers can be added by opting in; Jan adds them turned off, never connects during import, and does not import credentials, sign-ins, or credential-bearing endpoints.

**Model experience.** `/migrate` uses read-only discovery followed by a separate user approval form. AI app export is a Settings action, not a model tool; its preview works without a model turn.
