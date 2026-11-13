# Plan: DSH as the only core, Jan kept as the UI

Status: done (2026-11-13), except the follow-ups listed under phase 4.
- Phase 1 done: `DshChatTransport` is the only transport, with images (`image-data` blocks), per-session `instructions`, `maxTokens` and `session/cancel` (Stop ends one thread's turn, not the runtime). DSH takes no `temperature`/`top_p`: its `AgentOptions` has only provider, model and maxTokens.
- Phase 2 done: `extensions/dsh-openwaifu-server/index.js` subclasses DSH's JSON-RPC server (adds `session/cancel`, `plugins/list`, resume, history seeding, instructions, image blocks). Rust `core/dsh/plugins.rs` merges the base `cordis.yml`, the user layer `<data>/dsh/plugins.yml` and MCP servers from `mcp_config.json`; Settings → Plugins manages them.
- Phase 5 done: the DSH session id is kept in thread metadata, so a restart resumes it; a lost session is reseeded from the visible history.
- Phase 3 done: `services/models/default.ts` drives `web-app/src/lib/llamacpp/` (engine, settings, readiness, downloads through `lib/native/download.ts`) straight against the llamacpp plugin. No extension host is involved.
- Phase 4 done: `extensions/*-extension`, `packages/`, `web-app/src/lib/extensions/`, `tauri-plugin-{extensions,agent-tools,rag,vector-db,websearch}`, `core/mcp/` and `core/src/browser/` are deleted; `@janhq/core` is types only. `extensions/` now holds only `dsh-openwaifu-server`.
- Phase 4 follow-ups: `lib/service.ts` still lists routes with no Rust command; the sandbox that `tauri-plugin-agent-tools` provided is not yet replaced by a DSH sandbox plugin in the base `cordis.yml`; some web tests still assert pre-migration call shapes.

## Goal

open-waifu keeps Jan's UI and UX (Tauri shell, React web-app, threads, settings, hub) and runs everything behind it on DeepSeek Harness (DSH). Jan's extension system goes away completely: no worker extension host, no `@janhq/core` engine layer, no `.tgz` extension installs. "Plugin manager" in the sidebar manages DSH plugins.

## What exists today (measured 2026-11-13)

|Legacy piece|Files|Lines (ts/tsx/rs)|
|---|---|---|
|`extensions/` (assistant, download, llamacpp, rag, vector-db)|59|13,142|
|`core/` (`@janhq/core`)|93|4,368|
|`packages/` (extension-api, extension-runtime)|49|5,687|
|`web-app/src/lib/extensions/` (host, worker runtime, loaders)|47|8,817|
|`web-app/src/containers/extensions/` (Settings → Extensions UI)|23|3,033|
|`src-tauri/plugins/tauri-plugin-extensions/` (install, catalog, signatures)|30|8,381|

Importers in `web-app/src` (tests excluded): `@janhq/core` 62 files, `@janhq/extension-api` 34, extension host 46.

Chat has two paths, chosen once per thread in `hooks/use-chat.ts`:
- `CustomChatTransport` (default): tools, MCP, RAG, attachments, assistant parameters, context trimming, extension providers.
- `DshChatTransport` (opt-in): sends the last user text only; DSH runs its own tools. Attachments, MCP, RAG, assistant parameters and sampling settings are not wired.

DSH facts that shape the plan (checkout `C:/Users/thinhlpg/Code/deepseek-harness`):
- JSON-RPC server methods: `initialize`, `session/prompt`, `shutdown`. Nothing for listing sessions, tools or plugins, and nothing to change plugins at runtime.
- `host/plugin-inventory` lists Loader entries read-only. There is no runtime install, enable or disable and no catalog.
- Plugins exist for: LLM (`llm-deepseek` with any OpenAI-compatible base URL, `llm-pi-ai` multi-provider), tools (bash, pwsh, fs, todo, web, subagent, skill, lsp), MCP (`mcp-client`, one entry per server), sessions (JSONL, SQLite), attachments (`attachment-local`), presets/persona, skills, compaction.
- Missing in DSH: local llama.cpp, model downloads, embeddings, vector DB, RAG.
- Packaged single-file runtime builds only for linux-x64, linux-arm64 and macos-arm64. On Windows the app needs Node ≥ 22.19 and a built checkout (`pnpm install`).

## Target architecture

```text
React UI (Jan look) ── ServiceHub ── Tauri commands
   │                                   ├─ dsh: runtime process, cordis.yml writer, plugin store
   │                                   ├─ llamacpp plugin + jan-llama-worker (model server only)
   │                                   ├─ hardware, threads, settings, speech
   └─ DshChatTransport (only transport) ── JSON-RPC ── DSH runtime
                                                         ├─ llm-deepseek / llm-pi-ai → llama.cpp or remote endpoint
                                                         ├─ tools, mcp-client, skills, subagents
                                                         └─ sessions, attachments, compaction
```

- The Rust side owns the DSH process and composes `cordis.yml` from a base layer (shipped) plus a user layer (`<data>/dsh/plugins.yml`).
- llama.cpp stays as the app's local model server, not an extension. DSH reaches it as an OpenAI-compatible endpoint, as `resolveEndpoint()` already does.
- Model hub and downloads become plain app services in Rust (the download code moves out of `download-extension`), because DSH has nothing for them.

## Plugin manager (sidebar entry)

Replaces Settings → Extensions.
- Lists the user layer entries (id, package, enabled, config) and, after a restart, the runtime state from DSH stderr / a status probe.
- Toggle enables or disables an entry (`disabled: true` in the user layer), then the runtime restarts.
- Config is edited as YAML per entry. A schema form is left out: DSH exposes no schema over RPC.
- Install takes an npm package name: the app runs `pnpm add` in the data folder's `node_modules` and appends an entry. Remove reverses it.
- MCP servers set in Jan's MCP settings are written as `mcp-client` entries, so they show here too.

## Phases

1. **DSH is the only chat path.** Delete `CustomChatTransport`'s turn loop and the `useDshSettings.enabled` switch; keep its hook API in `DshChatTransport`. Map attachments to DSH content blocks (images through `attachment-local`), assistant instructions and parameters to the session system prompt / LLM config, MCP servers to `mcp-client` entries. Done when a thread with an image, an MCP tool call and a custom assistant works on DSH.
2. **Plugin manager.** User layer file, Rust commands (list, set enabled, set config, install, remove, restart), the new page behind the sidebar link. Done when installing a DSH plugin by package name adds a working tool in a chat.
3. **Model service without extensions.** Move llama.cpp model listing/start/stop and downloads from `llamacpp-extension` / `download-extension` into Rust commands behind ServiceHub. Hub, model picker and setup screen read from there. Done when a GGUF can be downloaded and chatted with, with `extensions/` unused.
4. **Delete the legacy.** Remove `extensions/`, `packages/extension-*`, `web-app/src/lib/extensions/`, `containers/extensions/`, `routes/settings/extensions/`, `tauri-plugin-extensions`, `tauri-plugin-agent-tools` (DSH runs tools), `core/mcp/` (DSH `mcp-client`), and every `@janhq/core` import that only served extensions. Keep `@janhq/core` types still used by the UI or move them into `web-app/src/types`. Update `AGENTS.md`.
5. **Threads on DSH sessions.** Today the UI writes its own `messages.jsonl` and DSH writes its own session log. Reloading a thread after a restart has no RPC to resume a DSH session. That needs a new method on the JSON-RPC server (`session/resume` or `session/list`) or a small local plugin. Until then a restart starts a fresh DSH session with the visible history replayed as context.

## Decisions (form defaults, 2026-11-13; not confirmed by the owner)

- RAG and vector DB are dropped, not ported.
- Windows keeps requiring Node and a built `deepseek-harness` checkout.
- Changes inside the `deepseek-harness` checkout are allowed (for `session/resume` and similar).

## Risks

- DSH JSON-RPC has three methods; anything richer (plugin state, session list) means changing DSH or adding a local plugin.
- Abort currently stops the whole runtime, which ends every other running chat. Phase 1 has to switch to per-session cancel or accept that.
- Loss of `tauri-plugin-agent-tools` also drops its Windows sandbox. DSH's `sandbox-windows-acl` / `pwsh-sandbox` must replace it before phase 4 removes it.
