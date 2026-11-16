# Loadable Harness plugin packages

This file is GENERATED from workspace manifests (`scripts/gen-plugin-packages.ts`) and verified fresh by `pnpm run verify-plugin-packages` (part of `doc-sync`); do not edit it by hand.

Every package below exports a Cordis plugin that a bundle patch can name in a Loader row. `Config` marks packages whose row accepts a `config` mapping; query `Config.listConfigs` through `cordis_inspect_query` (filter by `name`, then query the `entry` id) for the mounted schema. Packages under `experimental` are pre-stable.

## acp

| Package | Config | Description |
|---|---|---|
| `@janhq/jan-acp` | yes | Automation-only Agent Client Protocol server for driving Jan agents over JSON-RPC stdio |

## api

| Package | Config | Description |
|---|---|---|
| `@janhq/jan-api-account-controller` | no | Expose safe account operations over authenticated Remote |
| `@janhq/jan-api-gateway` | yes | Typert Remote Host dispatcher and Client API endpoint |
| `@janhq/jan-api-job-controller` | yes | Job Remote observation stream and the reference-counted client job-output service |
| `@janhq/jan-api-llama-cpp-controller` | no | Authenticated browser access to the managed local llama.cpp model |
| `@janhq/jan-api-remote-access` | no | Method-level Remote access control for non-owner Peers and the per-Peer access snapshot |
| `@janhq/jan-api-remotes` | no | Remote BFF assembly for application-selected Host capabilities |
| `@janhq/jan-api-session-controller` | yes | Session Remote commands, cold reads, and live control transport |
| `@janhq/jan-api-settings-controller` | yes | Remote owner for the configuration surfaces over the settings-domain seams |
| `@janhq/jan-api-terminal-controller` | yes | Session-owned interactive terminals with shell discovery, screen recovery and typed Remote control |
| `@janhq/jan-api-workspace-controller` | yes | Workspace Remote commands and reconnect-safe state transport |
| `@janhq/jan-api-workspace-files` | yes | Workspace file service and Client resource provider: bounded reads, directory listing, and live metadata over the workspaceFiles Remote namespace |

## attachment

| Package | Config | Description |
|---|---|---|
| `@janhq/jan-attachment-local` | yes | Private content-addressed JAN_HOME attachment storage |

## boot

| Package | Config | Description |
|---|---|---|
| `@janhq/jan-config-editor` | no | Persist plugin configuration through profile patches and Loader reconciliation |
| `@janhq/jan-hmr` | yes | Coordinated module and profile configuration hot reload |
| `@janhq/jan-plugin-manager` | yes | Current-profile plugin and bundle management shared by jan CLI, Web and agent tools |
| `@janhq/jan-plugin-market` | yes | Configured plugin market indexes for the Web Discover page and the plugin_market agent tool |

## browser-use

| Package | Config | Description |
|---|---|---|
| `@janhq/jan-browser-use` | no | Exclusive named browser-use provider registration |

## bundle

| Package | Config | Description |
|---|---|---|
| `@janhq/jan-acp-app` | no | The jan ACP profile bundle: automation-only JSON-RPC stdio and process lifecycle over jan-base |
| `@janhq/jan-headless` | yes | The jan one-shot bundle: a direct core Agent/Session runner over jan-base with no Host, HTTP, or browser layer |
| `@janhq/jan-sdk-app` | yes | The jan SDK profile bundle: stdio JSON-RPC serving and process lifecycle over jan-base |
| `@janhq/jan-web-app` | yes | The jan browser-surface bundle: the web patch layer over jan-base plus the runtime glue plugin (frontend dist serving, bash runtime variables, URL line) |

## client

| Package | Config | Description |
|---|---|---|
| `@janhq/jan-client-connection` | yes | Authenticated RPC transport and generation lifecycle |
| `@janhq/jan-client-file-upload` | no | Agent-scoped browser file upload, streaming intake, and staged receipt service |
| `@janhq/jan-client-hmr` | yes | Web client graph synchronization and rebuilt-bundle reload transport |
| `@janhq/jan-client-locale` | no | Locale plugin: Host-backed preference, extensible language catalog, browser fallback, and typed built-in dictionaries |
| `@janhq/jan-client-modules` | no | Client module system, dual-face: node half composes the __JAN_BOOT__ entry graph (incremental jan.client scan, bundle route, index tap, webPlugins service); browser half is the lazy-CJS module table the vendored cordis Loader consumes as its internal seam |
| `@janhq/jan-client-product-analytics` | yes | Desktop product event collection and authenticated Host reporting |
| `@janhq/jan-client-resources` | no | Unified client resource model: protocol-registered providers turn URL addresses into live values, consumed through the useResource global standard hook |
| `@janhq/jan-client-shortcuts` | yes | Application keyboard command registry and physical-key routing |
| `@janhq/jan-client-ui-agent-preset` | no | Agent-preset surfaces: the default for later sessions, this session's seat, and the composition editor |
| `@janhq/jan-client-ui-agent-team` | no | Web shared task board for a subagent tree |
| `@janhq/jan-client-ui-approval` | no | Approval composer takeover over the scoped Remote Event waterfall |
| `@janhq/jan-client-ui-attachment` | no | Dynamic attachment presentation plugin for conversation input, message-image, and trajectory image slots |
| `@janhq/jan-client-ui-brand-official` | no | Jan brand artwork for the sidebar and home hero |
| `@janhq/jan-client-ui-chat` | no | Chat Conversation target, node definitions, renderers, and details surface |
| `@janhq/jan-client-ui-commands` | no | Client command surface: global directory cache, '/' source, three command UI kinds, popupSelect registry |
| `@janhq/jan-client-ui-context-menu` | no | Typed, plugin-extensible context menus with captured targets and shared Web presentation |
| `@janhq/jan-client-ui-conversation` | no | Target-neutral Conversation assembly, shell, composer, queue, and view navigation |
| `@janhq/jan-client-ui-deliverables` | no | Changed-files card with per-file comparison tabs, delivery cards, and clickable final-response file references for Web |
| `@janhq/jan-client-ui-directory-picker-browse` | no | In-app directory browsing surface: the workspace directory-flow owner rendering the host's listing and creation primitives |
| `@janhq/jan-client-ui-directory-picker-native` | no | Native directory-picker surface: the renderless workspace directory-flow occupant driving the local Desktop or Host OS chooser |
| `@janhq/jan-client-ui-entry-customization` | no | Customize plugin entries in the left sidebar, conversation views, and right sidebar, and quickly create new plugins. |
| `@janhq/jan-client-ui-file-actions` | no | Original-file saving and image clipboard actions for Web and Desktop |
| `@janhq/jan-client-ui-file-drag` | no | Application-owned file drag transfers and localized failure feedback |
| `@janhq/jan-client-ui-goal` | no | Session goal surface: GoalBar docked above the composer, read from the goal session projection |
| `@janhq/jan-client-ui-input-trigger` | no | Input trigger pipeline: '/' and '@' detection, candidate menu, pick routing to registered sources |
| `@janhq/jan-client-ui-jobs` | no | Session-header background-job list with on-demand streaming record panels |
| `@janhq/jan-client-ui-layout` | no | Shell plugin: three-column AppFrame with drag handles, ctx.layout viewing-state service (navigation + panels) |
| `@janhq/jan-client-ui-message-feedback` | no | The Web feedback surface: per-message Like/Dislike in the assistant-message action strip and the feedback dialog behind both ratings and /feedback, backed by the messageFeedback and sessionFeedback Host Remotes |
| `@janhq/jan-client-ui-model-selection` | no | Model selection over the shared model catalog, Session projection, and session.selectModel |
| `@janhq/jan-client-ui-open-in-app` | no | Session application submenus and native opening controls for directories and previewed files |
| `@janhq/jan-client-ui-permission-presets` | no | Permission surfaces: a new-session default in General settings and a current-session /permission popup over the permissions projection |
| `@janhq/jan-client-ui-plan` | no | Plan mode controls, persistent transcript plan cards, and sidebar Markdown previews |
| `@janhq/jan-client-ui-plugin-manager` | yes | Plugin management for the jan web client: the sidebar Plugins panel installs, enables, disables, retries, and composes installed plugin packages |
| `@janhq/jan-client-ui-plugin-market` | no | Discover tab of the jan web Plugins page: browse configured plugin market indexes and install their bundles |
| `@janhq/jan-client-ui-reference` | no | Unified Web @file and @session reference source |
| `@janhq/jan-client-ui-renderer` | no | Browser UI renderer: React slot bindings, ctx.uiRenderer, and the assembled application root |
| `@janhq/jan-client-ui-schedule` | no | Host task management page and Session reminder catalog |
| `@janhq/jan-client-ui-secret-mask` | no | Web display masking for recognized credentials in sent user text |
| `@janhq/jan-client-ui-session` | no | Session Controller adapter for React and session-scoped slots |
| `@janhq/jan-client-ui-settings` | no | Settings domain base plugin: shared configuration forms and the canonical settings slot-type contract |
| `@janhq/jan-client-ui-settings-account` | yes | Manage DeepSeek login and open Platform billing pages |
| `@janhq/jan-client-ui-settings-agent-loop` | no | Settings page of the agent loop on the jan web client's Plugins page: the parallel tool-call cap of the agent-loop namespace |
| `@janhq/jan-client-ui-settings-general` | no | Settings ownerless-copy and product onboarding plugin: the General section, shell trigger/header chrome content, settings dictionaries, and the versioned welcome notice |
| `@janhq/jan-client-ui-settings-local-model` | no | Download, start and stop the managed local llama.cpp model from Settings and first-run setup |
| `@janhq/jan-client-ui-settings-models` | yes | Models settings and shared product-onboarding dialogs over existing settings and credential joins |
| `@janhq/jan-client-ui-settings-plugin-inventory` | no | Read-only Cordis Loader inventory tab in Web Plugins settings |
| `@janhq/jan-client-ui-settings-plugins` | no | Built-in plugins settings section for the jan web client: the Settings navigation entry and the tab chrome feature-owned tabs register into |
| `@janhq/jan-client-ui-settings-shell` | no | Settings page of the shell executor on the jan web client's Plugins page: the command timeout and the per-stream output cap of the shell namespace |
| `@janhq/jan-client-ui-settings-subagent` | no | Settings page of Subagent delegation on the jan web client's Plugins page: recursion depth, parallel capacity, and the models agents may choose for subagents |
| `@janhq/jan-client-ui-settings-web-search` | no | Settings page for web search and fetch on the jan web client's Plugins page: the Search and Fetch provider menus |
| `@janhq/jan-client-ui-shortcuts` | no | Keyboard shortcut reference, recording, and local preference editing |
| `@janhq/jan-client-ui-sidebar` | no | Sidebar plugin: session multi-level tree, search, grouping, state dots |
| `@janhq/jan-client-ui-sidebar-browser` | no | Sandboxed Web browser tabs for the right Sidebar |
| `@janhq/jan-client-ui-sidebar-documentpreview` | yes | Extensible Sidebar previews for Office documents, spreadsheets, Markdown, code, images, PDF, HTML, and plain text |
| `@janhq/jan-client-ui-sidebar-files` | no | The workspace files page and one workspace directory tree per pane beside docked and floating file previews, listed lazily over the workspaceFiles Remote namespace |
| `@janhq/jan-client-ui-sidebar-right` | no | Right Sidebar: the docking surface's session-bound state, its panel and header expand control, and the navigation service over it |
| `@janhq/jan-client-ui-sidebar-terminal` | no | Interactive shell tabs for the right Sidebar |
| `@janhq/jan-client-ui-skill` | no | Web skill references and the dedicated skill tool row |
| `@janhq/jan-client-ui-subagent` | no | Subagent conversation catalog, continuation routing UI, and '@' reference source |
| `@janhq/jan-client-ui-theme` | yes | Theme plugin: Host bootstrap for the pre-plugin palette; ThemeRuntime for light/dark/system state and icon replacements; --dsw-* token styles and Appearance settings row |
| `@janhq/jan-client-ui-tool` | no | Client Tool call-tree renderer and keyed per-tool presentation slot |
| `@janhq/jan-client-ui-trajectory` | yes | Trajectory event ledger and timing overview with live tool-result inspection |
| `@janhq/jan-client-ui-user-questions` | no | Web ask_user_question composer takeover and plan-review presentation UI |
| `@janhq/jan-client-ui-workflow-run` | no | Durable workflow-run Conversation Node and nested member disclosure for jan web |
| `@janhq/jan-client-ui-workspace` | no | Workspace picker plugin: one WorkspacePicker registered into the sidebar and empty-state workspace slots |

## compaction

| Package | Config | Description |
|---|---|---|
| `@janhq/jan-command-compact` | no | Human-facing slash command for explicit session compaction |
| `@janhq/jan-compaction-basic` | yes | Token-meter-driven compaction policy and LLM summarization backend for Jan |
| `@janhq/jan-compaction-image-offload` | no | Durable image offload for image-capable routes: replace over-budget request images with placeholders and retry |
| `@janhq/jan-compaction-tool-result-pruner` | yes | Replay-safe model-free head/middle/tail pruning for tool-result surface nodes |

## computer-use

| Package | Config | Description |
|---|---|---|
| `@janhq/jan-computer-use` | no | Exclusive named computer-use provider registration |

## context

| Package | Config | Description |
|---|---|---|
| `@janhq/jan-agent-instructions` | yes | Workspace context loader for AGENTS.md/CLAUDE.md instruction files |
| `@janhq/jan-file-reference-local` | yes | Local-filesystem ctx.fileReferences provider with bounded fuzzy indexes |
| `@janhq/jan-harness-dev-context` | no | Model context naming the Jan checkout and Web GUI URL without letting either change the system prompt |
| `@janhq/jan-session-reference` | yes | Cross-session snapshot references and durable untrusted model context (ctx.sessionReferenceResolver) |
| `@janhq/jan-time-context` | yes | Durable per-step context with the current time and elapsed time |
| `@janhq/jan-tmux-context` | yes | Opt-in durable per-step context with this agent's tmux pane and window location |

## core

| Package | Config | Description |
|---|---|---|
| `@janhq/jan-agent` | no | Agent interface, registry, initiator scope, and event vocabulary for Jan |
| `@janhq/jan-agent-default-model` | yes | Default model selection shared by Agent entry points |
| `@janhq/jan-agent-loop` | yes | The concrete agent loop plugin for Jan |
| `@janhq/jan-agent-tool-presentation` | yes | Deprecated tool presentation selector; use jan-tool-executor-native or jan-tool-executor-ptc directly |
| `@janhq/jan-session` | no | Event-sourced session store for Jan |
| `@janhq/jan-system-prompt` | yes | System prompt assembly registry for Jan |
| `@janhq/jan-tool-executor-native` | no | Native tool execution plugin |
| `@janhq/jan-tool-executor-ptc` | yes | PTC program execution, tool bindings, and generated SDK prompts |
| `@janhq/jan-tools` | no | Tool registry and execution pipeline for Jan |

## credentials

| Package | Config | Description |
|---|---|---|
| `@janhq/jan-authorization` | no | Authorization seam (ctx.authorization): plugin-owned flows that obtain a credential through a conversation with the human |
| `@janhq/jan-credentials-local` | yes | File-backed credentials provider ($JAN_HOME/.env under the live process environment) for Jan |
| `@janhq/jan-tokamak-account` | yes | Authorize Tokamak accounts through the CLI device sign-in and store the minted API key |

## deliverables

| Package | Config | Description |
|---|---|---|
| `@janhq/jan-deliverable-file-references` | no | Shared model guidance for file links and deliverables across Jan hosts |
| `@janhq/jan-tool-present` | yes | Explicit workspace file delivery declarations for Jan |
| `@janhq/jan-workspace-changes` | yes | Per-turn workspace file changes recorded from git working-tree snapshots and whole-file captures, with per-file comparisons, for Jan |

## document

| Package | Config | Description |
|---|---|---|
| `@janhq/jan-office-to-pdf` | yes | Shared Office-to-PDF conversion with bounded queues and caching |

## experimental

| Package | Config | Description |
|---|---|---|
| `@janhq/jan-action-cards` | yes | Optional action cards below answers: one shared proposal tool, card state, user actions and status notices |
| `@janhq/jan-client-ui-action-cards` | no | Action cards below completed answers: the shared card frame, kind bodies and the compact tool row |
| `@janhq/jan-client-ui-creation-recommendations` | no | Body of the personalized page card: location choice, creation progress, Undo and Restore |
| `@janhq/jan-client-ui-plugin-recommendations` | no | Official plugin card body with catalog text and enabling |
| `@janhq/jan-creation-recommendations` | no | Create persistent removable interface plugins from explicit conversation needs |
| `@janhq/jan-cua` | no | Shared Computer Use application objects, authorization, and logged tool execution |
| `@janhq/jan-experimental-api-speech-to-text` | yes | Authenticated experimental speech transcription for browser clients |
| `@janhq/jan-experimental-auto-review` | no | Per-tool LLM authorization review for the Jan Auto permission preset |
| `@janhq/jan-experimental-browser-use-chrome-devtools-mcp` | yes | Experimental per-Session Chromium browser tools through chrome-devtools-mcp |
| `@janhq/jan-experimental-browser-use-playwright-mcp` | yes | Experimental per-Session Chromium browser tools through @playwright/mcp |
| `@janhq/jan-experimental-browser-use-stagehand-native` | yes | Experimental Stagehand browser tools with separately configured native models |
| `@janhq/jan-experimental-claude-code-mods` | yes | Experimental bridge: load Claude Code mods (hooks modules) and run their hook chains on Jan extension points |
| `@janhq/jan-experimental-client-ui-claude-code-mods` | no | Web band above the prompt for Claude Code mods: draws each session's mod tree and sends button presses back to the bridge |
| `@janhq/jan-experimental-client-ui-cot-translation` | yes | Optional machine translation of expanded reasoning, preserving original Session text |
| `@janhq/jan-experimental-client-ui-forge` | yes | Sidebar panel for a Session's change requests, with a worktree option for new Sessions and its Host Remote |
| `@janhq/jan-experimental-client-ui-stats` | no | Per-turn and per-step context, timing, cache, and tool-cost table contributed as an experimental conversation View |
| `@janhq/jan-experimental-client-ui-voice-input` | no | Record speech and insert editable text into the conversation draft |
| `@janhq/jan-experimental-computer-use-cua-driver-mcp` | yes | Experimental computer use through an installed Cua Driver MCP executable |
| `@janhq/jan-experimental-computer-use-cua-driver-native` | no | Experimental computer-use provider embedding the Cua Driver native npm SDK |
| `@janhq/jan-experimental-cua-macos` | yes | macOS native provider for shared Computer Use application and window objects |
| `@janhq/jan-experimental-forge` | yes | Provider-neutral change request registry with shared status polling |
| `@janhq/jan-experimental-forge-github` | yes | GitHub provider for the experimental forge registry, read through the GitHub CLI on the host |
| `@janhq/jan-experimental-forge-session` | yes | Binds change requests to the Session that created, pushed, or tracked them |
| `@janhq/jan-experimental-inspector` | yes | Experimental cross-realm CDP hub for Host debugging and Client Runtime inspection |
| `@janhq/jan-experimental-ptc-runtime-python` | yes | CPython subprocess implementation of the Jan PTC execution seam |
| `@janhq/jan-experimental-session-inspector` | no | Experimental virtualized Session log and live Chat group/node inspectors |
| `@janhq/jan-experimental-speech-to-text` | yes | Experimental speech recognition with independently selectable providers |
| `@janhq/jan-experimental-speech-to-text-sensevoice` | yes | Local SenseVoice ONNX transcription with a managed sherpa-onnx process |
| `@janhq/jan-experimental-subagent-oar` | yes | Experimental one-shot subagents through OAR runtimes |
| `@janhq/jan-experimental-tool-subagent-oar` | yes | Delegate standalone tasks to configured external subagent providers |
| `@janhq/jan-experimental-tool-worktree` | no | Model tool that creates and enters a new Git worktree |
| `@janhq/jan-experimental-translator` | yes | Machine translation with reusable Session results |
| `@janhq/jan-experimental-worktree` | yes | Creates a named Git worktree and changes the calling Session working directory |
| `@janhq/jan-hooks-claude-code` | yes | Bridge plugin: run a Claude Code hooks.json / settings hook config on the Jan interception seams |
| `@janhq/jan-hooks-codex` | yes | Bridge plugin: run a Codex hooks.json hook config on the Jan interception seams |
| `@janhq/jan-plugin-recommendations` | no | Official plugin suggestions with explicit user activation and persistent conversation decisions |
| `@janhq/jan-session-title-all-prompts-llm` | yes | All-user-messages LLM provider plugin for Jan session titles |
| `@janhq/jan-skill-badge` | no | Bundled jan badge skill provider for Jan |
| `@janhq/jan-tool-ralph` | yes | Model-facing fresh-agent Ralph loop over the workflow and subagent seams |
| `@janhq/jan-tool-session-query` | yes | Workspace-authorized model-facing session history search, trace, and event read tools |
| `@janhq/jan-tool-terminal` | yes | Six model-facing persistent PTY tools with owner isolation and generic background-job integration |
| `@janhq/jan-webhook` | no | Fire-and-forget webhook rule runtime that creates Workspace-backed Jan Sessions |
| `@janhq/jan-webhook-github` | yes | Signed GitHub HTTP webhook adapter for the Jan webhook runtime |

## extensions

| Package | Config | Description |
|---|---|---|
| `@janhq/jan-client-ui-cordis` | no | Cordis dynamic-plugin definition card: the keyed cordis_define tool row with its run/stop switch |
| `@janhq/jan-cordis-client-runner` | no | Browser half of dynamic dual-half plugin packages: event subscription, closure evaluation, guard facade, and loader entries |
| `@janhq/jan-cordis-host-runner` | yes | Dynamic package definition registry, host-half sandbox lifecycle, and invoke handler table for model-mounted dual-half packages |
| `@janhq/jan-tool-cordis` | no | Read-only runtime API inspection for Harness plugin development |

## feedback

| Package | Config | Description |
|---|---|---|
| `@janhq/jan-command-feedback` | no | Log-only session feedback: the record event, the sessionFeedback Host Remote, and the human-facing slash command |
| `@janhq/jan-message-feedback` | yes | Canonical Session-log ratings and notes for finalized assistant messages |

## fs

| Package | Config | Description |
|---|---|---|
| `@janhq/jan-fs-local` | yes | Local-filesystem implementation of the Jan filesystem seam (ctx.fs) |
| `@janhq/jan-fs-observation-policy` | no | File-context policy plugin for the Jan — observed-state, read-before-edit, and version-guarded write/edit added over the ctx.fs provider seam through the fs/* event gate (no service API) |
| `@janhq/jan-fs-sandbox` | yes | Sandbox-enforcing implementation of the Jan filesystem seam: fences write/edit by the per-call sandbox mode (read-only denies mutation, workspace-write contains it to the workspace + temp roots) while reads pass through |
| `@janhq/jan-tool-fs` | yes | Model-facing filesystem tools (read, write, edit) over the Jan filesystem seam (ctx.fs) |
| `@janhq/jan-tool-fs-search` | yes | Model-facing filesystem discovery tools (glob, grep) backed by the packaged ripgrep binary (@vscode/ripgrep) |
| `@janhq/jan-tool-str-replace-editor` | yes | Model-facing view, create, literal replace, and line insert tool over the Harness filesystem service |

## goal

| Package | Config | Description |
|---|---|---|
| `@janhq/jan-command-goal` | no | Human-facing slash command for persisted same-session goals |
| `@janhq/jan-goal` | yes | Event-sourced same-session goal state and lifecycle service for Jan |
| `@janhq/jan-goal-round-driver` | no | Race-fenced same-session goal-round driver |
| `@janhq/jan-tool-goal` | yes | Model-facing same-session goal tools with execution-time authority checks |

## guard

| Package | Config | Description |
|---|---|---|
| `@janhq/jan-repeat-tool-reminder` | yes | Repeat-tool-call guard plugin: advisory reminders when an agent loops on identical tool calls |
| `@janhq/jan-tool-call-timeout-policy` | no | Tool-call timeout policy: a tools/execute wrapper that arms a per-tool deadline on exec.signal and returns TOOL_TIMEOUT when it wins |

## host

| Package | Config | Description |
|---|---|---|
| `@janhq/jan-host-directory-picker-auto` | no | Adaptive chooser of the directory-picker seam: resolves the host situation at boot and mounts the native or browse backend for the Jan web GUI host |
| `@janhq/jan-host-directory-picker-browse` | yes | In-app browsing backend of the directory-picker seam (listing/creation primitives over the host filesystem) |
| `@janhq/jan-host-directory-picker-native` | no | Native-OS-chooser backend of the directory-picker seam for the Jan web GUI host |
| `@janhq/jan-host-frontend-static` | yes | SPA dist server for the Web shell: owns the webserver fallback seat, serving explicit index entries and static assets with traversal rejection and 404 misses |
| `@janhq/jan-host-open-in-app` | yes | Host half of open-in-app: resolved application catalog, icons, and the launch endpoint as three webServer routes |
| `@janhq/jan-host-plugin-inventory` | no | Read-only Remote projection of current Cordis Loader plugin state |
| `@janhq/jan-host-product-telemetry-otel` | yes | Explicit product usage events exported through OpenTelemetry HTTP logs |
| `@janhq/jan-host-webserver` | yes | Web route-registration plugin: HTTP and upgrade routes, per-Peer index transform taps, and static dist fallback |

## interaction

| Package | Config | Description |
|---|---|---|
| `@janhq/jan-commands` | no | Plugin-owned human command registry for Jan UIs |
| `@janhq/jan-permission-presets` | yes | User-facing permission presets (ctx.permissionPresets) for the Jan: one product-level Permissions select bundling the sandbox-mode and approval-policy knobs, written through to their own session events |
| `@janhq/jan-tool-ask-user` | yes | Model-facing ask_user_question tool over the ctx.userQuestions seam |
| `@janhq/jan-user-approval` | yes | User-approval seam (ctx.approval) for the Jan: one-shot permission decisions dispatched to composed answerers over the approval/request waterfall, fail-closed by default |
| `@janhq/jan-user-questions` | no | Abstract user-questions seam (ctx.userQuestions) for asking the human during agent runs |

## jobs

| Package | Config | Description |
|---|---|---|
| `@janhq/jan-jobs-local` | yes | Process-local implementation of the Jan background job registry seam |
| `@janhq/jan-tool-jobs` | yes | Model-facing background job control tools (job_output, job_list, job_kill) over the ctx.jobs registry |

## llm

| Package | Config | Description |
|---|---|---|
| `@janhq/jan-llama-cpp` | yes | Download and verify GGUF models and supervise the bundled jan-llama-worker that serves them |
| `@janhq/jan-llm` | no | Provider-neutral LLM service interface for Jan |
| `@janhq/jan-llm-pi-ai` | yes | pi-ai-backed multi-provider adapter for the Jan LLM seam |
| `@janhq/jan-llm-retry` | yes | Provider-routed LLM request retry policy for Jan |
| `@janhq/jan-token-meter` | yes | Replay-aware token measurement service (ctx.tokenMeter) for Jan |

## lsp

| Package | Config | Description |
|---|---|---|
| `@janhq/jan-lsp` | no | Abstract LSP capability seam (ctx.lsp) for the Jan — language-server provider registry keyed by branded id and extension mapping, order-independent per-query selection, normalized definition/references/implementation/hover requests and results, and the LspError taxonomy |
| `@janhq/jan-lsp-stdio` | yes | Generic stdio language-server provider for the Jan LSP capability seam (ctx.lsp) — spawns configured servers, translates JSON-RPC, and serves transient-open goToDefinition/findReferences/goToImplementation/hover queries in the host filesystem namespace |
| `@janhq/jan-tool-lsp` | yes | Model-facing lsp tool over the Jan LSP capability seam (ctx.lsp) — one read-only tool with goToDefinition/findReferences/goToImplementation/hover operations, one-based UTF-16 cursor coordinates, bounded location rendering, and hover normalization |

## mcp

| Package | Config | Description |
|---|---|---|
| `@janhq/jan-mcp-client` | yes | MCP client bridge: connects to MCP servers and registers their tools on ctx.tools |
| `@janhq/jan-mcp-manager` | yes | MCP server manager: a settings-driven fleet of mcp-client instances with runtime status, restart, and probe |
| `@janhq/jan-mcp-resources` | no | Scoped MCP resource discovery and reading through shared model tools |

## plan

| Package | Config | Description |
|---|---|---|
| `@janhq/jan-plan-mode` | yes | Logged per-agent plan mode with deployment guidance, a direct slash command, and a user-reviewed exit |

## preset

| Package | Config | Description |
|---|---|---|
| `@janhq/jan-agent-preset` | yes | Declare an Agent capability composition in Cordis YAML |
| `@janhq/jan-agent-preset-registry` | yes | Declarative Agent preset registry and profile-backed editing |
| `@janhq/jan-persona` | yes | Composition-authored deployment persona section for Jan |

## ptc-runtime

| Package | Config | Description |
|---|---|---|
| `@janhq/jan-ptc-runtime-node` | yes | Node PTC execution with async function, REPL and VM Script evaluators and optional retained state |

## sandbox

| Package | Config | Description |
|---|---|---|
| `@janhq/jan-sandbox-local` | yes | Local process-sandbox backends for the Jan sandbox seam: bwrap, the npm-distributed landlock-run launcher, macOS Seatbelt, or the Windows ACL restricted-token runner — functionally probed, fail-closed |
| `@janhq/jan-sandbox-policy` | yes | Per-call sandbox policy resolver and current model context: deployment fallbacks plus each session's mode and workspace root, shared by every enforcing capability family |

## schedule

| Package | Config | Description |
|---|---|---|
| `@janhq/jan-schedule` | yes | Host-wide durable reminders with shared management and delivery to existing or new Sessions |
| `@janhq/jan-tool-schedule` | no | Model-facing scheduled task tools (schedule_create, schedule_list, schedule_view, schedule_edit) over the Host ctx.schedule service |

## sdk

| Package | Config | Description |
|---|---|---|
| `@janhq/jan-sdk-jsonrpc-server` | yes | Stdio JSON-RPC server plugin for out-of-process Jan SDK clients |

## session

| Package | Config | Description |
|---|---|---|
| `@janhq/jan-message-quotes` | no | Selected-text quotation and Markdown blockquote presentation |
| `@janhq/jan-session-checkpoint-policy` | no | Semantic session durability checkpoints before model requests and tool side effects |
| `@janhq/jan-session-persistence-jsonl` | yes | JSONL durable session persistence backend for Jan |
| `@janhq/jan-session-projection` | no | Session-projection seam: the merge-extensible projection type table, the provider contract, and the ctx.sessionProjections registry serving whole current values of log-derived per-session state |
| `@janhq/jan-session-projection-cache` | yes | Persisted projection cache (ctx.sessionProjectionCache): durable per-session checkpoint records on the session_projcache storage domain (per-record layout), throttled write-behind, and the cached listing read |
| `@janhq/jan-session-stats` | no | Whole-log conversation counts and wall times projection (sessionStats) for Jan |
| `@janhq/jan-session-telemetry-otel` | yes | Feedback-authorized Session logs over byte-bounded OpenTelemetry HTTP requests |
| `@janhq/jan-session-title` | yes | Log-backed session title service and provider registry for Jan |
| `@janhq/jan-session-title-first-prompt-llm` | yes | First-message LLM provider plugin for Jan session titles |
| `@janhq/jan-session-turn-outline` | no | Whole-log turn outline projection (turnOutline) for Jan |
| `@janhq/jan-tool-working-directory` | no | Read and change the active Session working directory |
| `@janhq/jan-working-directory` | yes | Session working directories with durable changes and model context |

## session-query

| Package | Config | Description |
|---|---|---|
| `@janhq/jan-session-log-export` | yes | Web Session-log ZIP export and Session Markdown copy |
| `@janhq/jan-session-query-sqlite` | yes | Concrete ctx.sessionQuery backend with SQLite FTS5 search |

## settings

| Package | Config | Description |
|---|---|---|
| `@janhq/jan-settings` | no | Abstract user-settings seam (ctx.settings) for Jan |

## shell

| Package | Config | Description |
|---|---|---|
| `@janhq/jan-bash-local` | yes | Local-subprocess implementation of the Jan bash executor seam |
| `@janhq/jan-bash-sandbox` | yes | Sandbox-consuming implementation of the Jan bash executor seam (confines every command via ctx.sandbox, reports denial/enforcement result facts) |
| `@janhq/jan-pwsh-local` | yes | Local PowerShell implementation of the Jan bash executor seam |
| `@janhq/jan-pwsh-sandbox` | yes | Sandbox-consuming implementation of the Jan PowerShell executor seam (confines every command via ctx.sandbox, reports denial/enforcement result facts) |
| `@janhq/jan-shell-env` | yes | Tool-independent managed JAN_* shell environment registry |
| `@janhq/jan-tool-bash` | yes | Model-facing bash tool with optional generic background-job and sandbox-escalation support |
| `@janhq/jan-tool-bash-persistent` | yes | Model-facing owner-scoped persistent Bash tool backed by the Harness PTY service |
| `@janhq/jan-tool-pwsh` | yes | Model-facing pwsh tool over the bash executor seam |
| `@janhq/jan-tool-pwsh-persistent` | yes | Model-facing owner-scoped persistent PowerShell tool backed by the Harness PTY service |

## skill

| Package | Config | Description |
|---|---|---|
| `@janhq/jan-skill` | yes | Agent skill provider registry for Jan |
| `@janhq/jan-skill-filesystem` | yes | Local filesystem skill provider for Jan |
| `@janhq/jan-skill-office` | yes | Bundled Word, PowerPoint, and Excel workflows and LibreOffice Kit operations |
| `@janhq/jan-tool-skill` | yes | Model-facing skill loading tool for Jan |
| `@janhq/jan-tool-workspace-dependencies` | yes | The load_workspace_dependencies tool: absolute paths into a bundled Python, Node.js, and pnpm payload |

## spill

| Package | Config | Description |
|---|---|---|
| `@janhq/jan-spill-local` | yes | Local-filesystem implementation of the Jan spill storage seam (private session-scoped files) |
| `@janhq/jan-spill-policy` | yes | Token-budgeted tool-result retention with recoverable text and image paths |

## ssh

| Package | Config | Description |
|---|---|---|
| `@janhq/jan-fs-ssh` | no | Filesystem provider over the shared POSIX SSH helper |
| `@janhq/jan-sandbox-ssh` | no | Remote POSIX sandbox argv provider over the shared SSH helper |
| `@janhq/jan-ssh` | yes | Shared OpenSSH connection and versioned POSIX remote helper |
| `@janhq/jan-subprocess-ssh` | no | Subprocess and terminal provider over the shared POSIX SSH helper |

## storage

| Package | Config | Description |
|---|---|---|
| `@janhq/jan-storage` | no | Storage hub (ctx.storage): named backend registry plus mounted data-form facilities for Jan |
| `@janhq/jan-storage-domain` | yes | Domain data form (ctx.storage.domain): schema-validated, event-emitting KV domains over storage backends for Jan |
| `@janhq/jan-storage-json` | yes | JSON file KV storage backend for the Jan storage hub |
| `@janhq/jan-storage-sqlite` | yes | SQLite storage backend (kv facet) for the Jan storage hub |

## subagent

| Package | Config | Description |
|---|---|---|
| `@janhq/jan-subagent` | yes | Abstract subagent seam (ctx.subagents): named-provider registry for delegating to child agents |
| `@janhq/jan-subagent-acp` | yes | Out-of-process ACP subagent backend: drives a child agent in a spawned subprocess over the Agent Client Protocol |
| `@janhq/jan-subagent-claude-code` | yes | One-shot Claude Code subagent provider over the official Agent SDK |
| `@janhq/jan-subagent-codex` | yes | One-shot Codex subagent provider over the official app-server protocol |
| `@janhq/jan-subagent-fork-in-process` | yes | In-process fork subagent backend: runs a child agent seeded with a prefix of the parent's log |
| `@janhq/jan-subagent-jan-sdk` | yes | Out-of-process SDK subagent backend: drives a child Jan runtime subprocess over stdio JSON-RPC through the TypeScript SDK client |
| `@janhq/jan-subagent-spawn-in-process` | yes | In-process spawn subagent backend: runs a fresh child agent on ctx.agents |
| `@janhq/jan-tool-subagent` | yes | Model-facing subagent delegation tool over the ctx.subagents seam |
| `@janhq/jan-tool-subagent-control` | yes | Shared messaging, interruption, and child discovery tools for subagents |

## subprocess

| Package | Config | Description |
|---|---|---|
| `@janhq/jan-subprocess-local` | no | Local-subprocess implementation of the Jan subprocess seam |

## team

| Package | Config | Description |
|---|---|---|
| `@janhq/jan-agent-team` | yes | Shared task DAG and change waits for subagent trees |
| `@janhq/jan-tool-agent-team` | yes | Scoped model-facing Agent Teams tools over ctx.agentTeams |

## telemetry

| Package | Config | Description |
|---|---|---|
| `@janhq/jan-otel` | no | Cordis service for independent ordinary-event and byte-bounded Session-log OTLP channels |

## terminal

| Package | Config | Description |
|---|---|---|
| `@janhq/jan-terminal` | no | Persistent PTY session seam for the Jan — owner-scoped ids, backend registry, interactive sends, reads, signals, and awaited cleanup |
| `@janhq/jan-terminal-bash` | yes | Persistent shell PTY backend over the Jan subprocess terminal primitive |

## test-support

| Package | Config | Description |
|---|---|---|
| `@janhq/jan-llm-replay` | yes | Replay LLM plugin: short-circuits llm/stream with model chunks reconstructed from a recorded session JSONL (keyless snapshot tests) |

## todo

| Package | Config | Description |
|---|---|---|
| `@janhq/jan-tool-todo` | yes | Model-facing todo_write tool over the Jan event-sourced session log |

## typert

| Package | Config | Description |
|---|---|---|
| `@janhq/jan-typert-loader` | yes | Loader integration for generated Typert package contributions |

## web

| Package | Config | Description |
|---|---|---|
| `@janhq/jan-tool-web` | yes | Model-facing web tools (web_search, web_fetch) over the Jan web capability seam (ctx.web) |
| `@janhq/jan-web` | yes | Abstract web access capability seam (ctx.web) for the Jan — search/fetch provider registry, registration-order-independent selection, request/result vocabulary, and the WebError taxonomy |
| `@janhq/jan-web-fetch-http` | yes | Anonymous HTTP(S) fetch provider for the Jan web capability seam (ctx.web) |
| `@janhq/jan-web-search-exa` | yes | Keyless web search and fetch for the ctx.web capability seam through Exa's hosted MCP endpoint |

## workflow

| Package | Config | Description |
|---|---|---|
| `@janhq/jan-tool-workflow` | yes | Model-facing workflow tool: run a JavaScript orchestration script over ctx.workflowEngine |
| `@janhq/jan-workflow-ptc` | yes | Workflow orchestration in the shared sandboxed Node PTC runtime |

## workspace

| Package | Config | Description |
|---|---|---|
| `@janhq/jan-workspace` | no | Workspace entity registry (ctx.workspaceRegistry): durable workspace records with validated session attachment over the domain data form for Jan |
