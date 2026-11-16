# Repository Guidelines

## Project Overview

open-waifu is a personal fork of [Jan](https://github.com/janhq/jan) for hobby and learning: a local-first AI chat app (future waifu chat) on Tauri 2, macOS and Windows desktop only. The desktop window runs DeepSeek Harness (DSH) with Jan styling supplied by a DSH UI plugin. A small React bootstrap initializes settings and starts the host. Legacy Jan routes and the stdio transport remain in source for migration, but the desktop entry never loads those routes.

- **Removed from upstream; do not reintroduce:**
  - Build and platforms: CI, the docs site, Linux and mobile targets, MLX, the ADKs, the headless `jan` CLI/TUI and `protocol/`, the e2e/WebDriver hooks, the auto-updater, PostHog/GA telemetry.
  - Jan's agent stack: the Rust agent loop (`core/agent/`), the webview tool loop (`CustomChatTransport`), `tauri-plugin-agent-tools`, Jan's MCP client (`core/mcp/`), Jan's memory and skills. Tools, MCP, approvals and plan mode exist again, but only through DSH.
  - Jan's extension system: `extensions/*-extension`, `packages/extension-*`, the worker host `web-app/src/lib/extensions/`, `tauri-plugin-extensions`, Settings → Extensions.
  - RAG, vector DB, document attachments, sqlite-vec, built-in web search, the Claude Code integration, and named remote providers (OpenAI, Anthropic, Gemini, …).
- **Names stay `jan`:** identifiers, crate names, `@janhq/*` packages, the `Jan` data folder and the bundle id `jan.ai.app` (it sets the user-data path; changing it orphans data).

## Architecture & Data Flow

```text
Desktop bootstrap (main-desktop.tsx) → ServiceHub → dsh_web_start
  → Rust supervises dsh web → main window navigates to its loopback origin
  → DSH client plugins compose chat, sessions, settings and plugin management
  → open-waifu-shell supplies Jan styling, branding and native window controls

Legacy web routes → DshChatTransport → stdio DSH runtime
Rust retains llama.cpp, hardware, settings, downloads, speech and local API code.
```

- **Legacy Jan chat path, not the desktop shell** (`web-app/src/lib/dsh-chat-transport.ts`):
  1. `resolveEndpoint` picks the model endpoint: for `llamacpp` it starts the model and uses `127.0.0.1:<port>/v1`; for a custom provider its `base_url` and first key.
  2. `DshConnection.ensure` calls `dsh_start` (restarts the one shared process when the launch config changed) and sends `initialize`.
  3. `session/prompt` carries content blocks (text, `image-data`), `instructions`, `history` (only when seeding a new session), `cwd`, `editPolicy`, `plan` and `options.maxTokens`. DSH takes no temperature/top_p.
  4. `session.event` notifications stream parts; `session.status: idle` ends the turn and saves `usage` in message metadata.
- **One DSH process serves every chat.** A launch change (model, root) restarts it and fails other chats' in-flight turns. Stop sends `session/cancel` for one session only.
- **Session link:** `thread.metadata.dshSession = { id, messageIds }`. It is reused only when the UI's prior message ids match; otherwise a new session is seeded from visible history. Stop clears `messageIds` to force a reseed.
- **Server plugin:** `extensions/dsh-openwaifu-server/index.js` (plain ESM, no build) subclasses DSH's JSON-RPC server. Methods: `initialize`, `session/prompt`, `session/cancel`, `session/plan`, `session/policy`, `interaction/answer`, `plugins/list`, `shutdown`. Notifications: `session.event`, `session.status`, `session.policy`, `interaction.request`, `interaction.withdrawn`. Rust embeds it with `include_str!` and writes it to `<data>/dsh/plugins/`, so editing it needs a cargo rebuild.
- **Plugin config** (`src-tauri/src/core/dsh/plugins.rs`): on every start it writes `<data>/dsh/cordis.yml` from the embedded base `core/dsh/cordis.yml`, the user layer `<data>/dsh/plugins.yml`, and one `mcp-client` row per server in `<data>/mcp_config.json` (inactive ones as `disabled: true`). npm installs go to `<data>/dsh/user_modules`. A loader `name` that is an absolute path must be a `file:///` URL, or Node rejects `C:/…` as a URL scheme; base rows use the `{{DSH_PACKAGES}}` token for DSH packages missing from `examples/node_modules` (e.g. `dsh-pwsh-sandbox`).
- **Base composition** mirrors DSH's `packages/bundle/base`: the shell is `pwsh` on Windows and `bash` on macOS, both through `dsh-sandbox-local` + `dsh-sandbox-policy` (writes limited to the thread workspace, a denial reaches the model as the tool result); file tools go through `dsh-fs-sandbox`. Also mounted: skills, background jobs, goals, workspace instructions (AGENTS.md), time context, subagent spawn/fork/control/report, workflow and Ralph, spill/timeout/pruner/repeat-reminder policies.
- **DSH commands:** `dsh_start|send|stop|status|restart|check_root`, `dsh_plugins_list`, `dsh_plugin_set_enabled|set_config|install|remove`, `dsh_thread_workspace`, `dsh_read_workspace_file`, `dsh_web_start` (DSH's own web host; it stops with the app, see `docs/plans/2026-11-13-dsh-host-shell.md`).
- **DSH shell is the only desktop UI.** Vite selects `web-app/src/main-desktop.tsx` and scans that entry for dependencies. `ServiceHubProvider` hydrates settings, calls `dsh_web_start`, and shows the real startup error with Retry on failure. No shell selector, `?shell=jan` escape, or return-to-Jan action exists. `core/dsh/web.rs` writes `<data>/dsh/web.patch.yml`: the bundled `dsh/open-waifu-shell` plugin, theme, active endpoints as `openai-completions` routes (keys via `OW_PROVIDER_KEY_<i>` from the keyring, never in the file), and the selected model. `DSH_HOME` is `<data>/dsh/web-home`. The host uses global `@deepseek-ai/dsh` (`OW_DSH_CLI` overrides its entry). Capability `dsh-shell` grants loopback pages window controls only. Navigate from Rust: the launch cookie is SameSite=Strict.
- **Current migration blocker:** desktop `shellSetup` excludes llama.cpp, and `main-desktop.tsx` does not mount the legacy engine bootstrap. Local-only chat is not working in the DSH desktop path yet. Restore engine startup and handoff before calling the migration complete.
- **Legacy local models** have no extension layer: `services/models/default.ts` → `LlamacppEngine` (`web-app/src/lib/llamacpp/engine.ts`) → `@janhq/tauri-plugin-llamacpp-api` → Rust spawns `jan-llama-worker`. Engine settings schema: `lib/llamacpp/settings.json`. Downloads: `lib/llamacpp/download-service.ts` → `lib/native/download.ts` → Rust `download_files`. Devices are filtered to those the running engine reported before load.
- **ServiceHub** (`web-app/src/services/index.ts`): defaults are field initializers; on Tauri `initialize()` swaps in `tauri.ts` variants for theme, window, events, hardware, app, mcp, providers, dialog, opener, path, core, deeplink, speech and dsh. Threads, messages, models, assistants, projects and uploads stay default-only and reach Rust through `APIs` in `lib/service.ts` (several routes there have no Rust command and fail at runtime; check `lib.rs` before using one).
- **Rust commands:** one `generate_handler!` list in `invoke_commands_with_extras!` in `src-tauri/src/lib.rs`. A command missing from it fails only at runtime. Plugins and `AppState` are registered in `run()`.
- **Plugins:** `src-tauri/plugins/tauri-plugin-{llamacpp,hardware}/`, each with a `guest-js/` wrapper (`@janhq/tauri-plugin-<name>-api`) and a `COMMANDS` list in `build.rs` generating `permissions/autogenerated/`. App permissions: `src-tauri/capabilities/{default,desktop,dsh-shell}.json`.
- **Model providers:** exactly two kinds, `llamacpp` and user-added OpenAI-compatible endpoints. No vendor SDKs or per-vendor converters.
- **Storage:** threads are `thread.json` + `messages.jsonl` per thread under the Jan data folder with per-thread async locks (`core/threads/`). DSH keeps sessions in `<data>/dsh/sessions` and per-thread workspaces in `<data>/dsh/workspace/threads/<id>`.
- **Local API server** (`src-tauri/src/core/server/proxy.rs`, hyper 1.x): routes `/chat/completions`, `/completions`, `/embeddings`, `/models`, `/openapi.json`; it only proxies to the engine. Auth is `Authorization: Bearer` or `x-api-key`; spec `src-tauri/static/openapi.json`.
- **Engine:** llama.cpp built from source into `jan-llama-worker` (`plugins/tauri-plugin-llamacpp/src/engine/`, `src/bin/jan-llama-worker.rs`), pinned by `LLAMA_CPP_COMMIT` in that plugin's `build.rs`, source cloned to `vendor/llama.cpp`.

## Key Directories

| Path | Purpose |
|---|---|
| `web-app/src/routes/` | TanStack file routes (`threads/$threadId.tsx`, `settings/plugins.tsx`, `settings/dsh.tsx`) |
| `web-app/src/containers/`, `components/` | Feature components vs reusable UI (`components/ui/`); `containers/work/` is the work panel, approval/question cards and plan/policy controls |
| `web-app/src/services/<name>/` | ServiceHub implementations (`default.ts`, `tauri.ts`, `types.ts`) |
| `web-app/src/lib/` | `dsh-chat-transport.ts`, `dsh-protocol.ts` (zod schemas), `llamacpp/` (engine, settings, downloads), `native/` (core, download, events, fs, logger, settings) |
| `web-app/src/stores/`, `hooks/` | zustand stores (`dsh-interaction-store`, `work-panel-store`, `useThreads`, `useModelProvider`, `useDshSettings`) |
| `web-app/src/locales/<lang>/<ns>.json` | i18n, 17 locales |
| `core/` | `@janhq/core`: shared types and enums only (threads, messages, models, assistants) |
| `extensions/dsh-openwaifu-server/` | The DSH JSON-RPC server plugin, embedded by Rust |
| `src-tauri/src/core/` | `dsh/`, `server/`, `threads/`, `downloads/`, `speech/`, `filesystem/`, `system/`, `app/`, `mcp_config.rs` |
| `src-tauri/plugins/` | Tauri plugins `llamacpp`, `hardware`; a separate Yarn root |
| `src-tauri/utils/` | `jan-utils` crate (CORS, paths, system) |
| `src-tauri/build-utils/` | `download-bin.mjs` (bun, uv → `resources/bin`), `stub-tauri-resources.mjs`, `build-windows-icon.mjs`, engine scripts (`fetch-engine-source.sh`, `check-engine-toolchain.sh`, `stage-engine.sh`) |
| `docs/plans/` | Design notes for the DSH migration, the Cowork-style work panel and the planned DSH web-host shell |

## Development Commands

```bash
make dev        # yarn install → plugin guest-js → build:core → download:bin → engine build (if toolchain) → tauri dev
make dev-web    # UI only in a browser (http://localhost:1420)
make build      # release engine + tauri build (nsis/msi on Windows, universal on macOS)
make test       # lint + yarn test + Rust tests
make lint       # yarn lint (web-app eslint only)
make clean
make build-engine-dev JAN_ENGINE_VARIANT=cuda13   # cpu|vulkan|metal|cuda12|cuda13|hip, join with '-' (default vulkan)
cd web-app && yarn tsc -b                          # type check (no standalone script)
cargo check --manifest-path src-tauri/Cargo.toml   # add --no-default-features --features test-tauri --tests for tests
```

- **Build order:** `yarn build:tauri:plugin:api` → `yarn build:core` → web → tauri. Rebuild `core/` or a plugin `guest-js/` after editing it (the web-app imports their builds; vitest aliases the guest-js sources).
- **DSH is not built here.** Desktop startup needs Node 22+ and global `@deepseek-ai/dsh`, or `OW_DSH_CLI` pointing to a built CLI entry. The separate `deepseek-harness` checkout and its `packages/examples/jsonrpc-demo/lib/bin.js` entry are needed only by the legacy stdio transport.
- **Engine knobs:** `JAN_ENGINE_CUDA_ARCHS`, `JAN_ENGINE_HIP_TARGETS`, `JAN_ENGINE_JOBS`, `JAN_ENGINE_VULKAN_FALLBACK` (default 1), `JAN_ENGINE_PROFILE`; log at `src-tauri/target/engine-build.log`.
- **Windows:** run make from Git Bash (engine/stage scripts are `sh`). Engine builds need VS 2022 Build Tools, LLVM (`clang-cl`), Ninja, CMake, `glslc` for Vulkan, and the CUDA Toolkit for CUDA.

## Code Conventions & Common Patterns

- **TS style:** no semicolons, single quotes, `trailingComma: es5` (`.prettierrc`; Prettier is not run, match by hand). ESLint flat config `web-app/eslint.config.js`. Imports use `@/` = `web-app/src`.
- **Calling Rust:** new code goes through `getServiceHub()` / `useServiceHub()`; legacy direct `invoke` imports exist. Tauri command names are snake_case and must match the TS `invoke('…')` string; plugin commands (`plugin:<name>|cmd`) only through guest-js.
- **DSH protocol changes** touch three places together: `extensions/dsh-openwaifu-server/index.js`, the zod schemas in `lib/dsh-protocol.ts`, and the transport.
- **State:** zustand everywhere; persistence is the backend's (`lib/backendStorage.ts` / `fileStorage` → Rust `settings_get`/`settings_set`), not localStorage. Per-thread plan/policy lives in thread metadata.
- **DI:** service locator (`getServiceHub`) plus module singletons (`getConnection()`, `getLlamacppEngine()`); Rust uses `tauri::manage` + `State<'_, AppState>`.
- **Errors:** Tauri commands are `async fn … -> Result<T, String>`; server internals use `Box<dyn Error + Send + Sync>`. Turn failures become `{ type: 'error' }` stream chunks; show the engine's real reason, never `[object Object]`.
- **Async (Rust):** tokio (`spawn`, `sync::Mutex`, `Notify`) and `tauri::async_runtime`.
- **Cargo features:** `default` includes `desktop` = `deep-link` + `hardware` + `tauri-app` (gates the Tauri runtime; `build.rs` runs `tauri_build` only under it). `test-tauri` adds `tauri/test`. The llamacpp plugin's `engine` / `engine-{cuda,vulkan,hip,metal}` features are off for the app; `make build-engine` builds the worker. No `linux`/`android`/`ios` cfgs.
- **i18n:** add keys to `web-app/src/locales/en/<ns>.json`; `locales/__tests__/localeKeys.test.ts` checks the others. `useTranslation` comes from `web-app/src/i18n/react-i18next-compat.ts`.
- **Comments** explain why, not what. **Commits:** Conventional Commits with a scope, e.g. `fix(dsh): …`, `feat(llamacpp): …`, `fix(web-app): …`.

## Important Files

- **Entry points:** `web-app/src/main-desktop.tsx` (desktop bootstrap, DSH only), `web-app/src/main.tsx` (legacy web routes), `web-app/src/providers/ServiceHubProvider.tsx` (settings hydration and shell startup), `src-tauri/src/lib.rs` (`run()`, command list). `BootProvider.tsx` belongs to the legacy route tree and is not mounted by the desktop entry.
- **DSH:** `web-app/src/lib/dsh-chat-transport.ts`, `lib/dsh-protocol.ts`, `src-tauri/src/core/dsh/{mod,commands,plugins,web}.rs`, `src-tauri/src/core/dsh/cordis.yml`, `extensions/dsh-openwaifu-server/index.js`.
- **Config:** root `package.json` (workspaces `core`, `web-app`), `Makefile`, `src-tauri/Cargo.toml`, `src-tauri/tauri{,.macos,.windows}.conf.json`, `web-app/vite.config.ts` (`IS_TAURI`, `PLATFORM`, `VERSION` defines), `vitest.config.ts`.
- **Do not hand-edit:** `web-app/src/routeTree.gen.ts`, `src-tauri/plugins/*/permissions/autogenerated/`, generated icons in `src-tauri/icons/` (only `icon.png` sources are tracked), `src-tauri/resources/`, `src-tauri/gen/`, `vendor/llama.cpp`.
- **Version mismatch:** `web-app/package.json` is `0.7.6`, Tauri and Cargo are `0.8.8`; the Vite `VERSION` define reads the web-app value.

## Runtime/Tooling Preferences

- **Node** 22+ (DSH needs it; the app itself builds on 20). **Yarn 4.5.3** via corepack (`corepack yarn …`); never npm or bun for the repo. `nodeLinker: node-modules`, hoisting limited to workspaces. DSH's own checkout uses pnpm.
- **Plugin workspace:** `src-tauri/plugins/` is its own Yarn root.
- **Rust** pinned in `rust-toolchain.toml` (1.98.0, clippy, rustfmt). Only `src-tauri/Cargo.lock` is tracked and only the main crate builds `--locked`; after removing a dependency run `cargo update --workspace --manifest-path src-tauri/Cargo.toml`.
- **No git hooks.** Run `yarn lint` yourself before committing web-app changes.

## Testing & QA

- **JS:** Vitest projects `@janhq/core` and `@janhq/web-app` (root `vitest.config.ts`).
  - `yarn test` (core + web), `yarn test:all`, `yarn test:coverage` (v8, no thresholds).
  - One file: `corepack yarn vitest run --project @janhq/web-app src/hooks/__tests__/useTokensCount.test.ts`.
- **Placement:** `__tests__/` next to the source, `*.test.ts(x)`; web tests run in jsdom. `core` only picks up `src/**/*.test.ts`. `extensions/dsh-openwaifu-server` has no tests.
- **Setup:** `web-app/src/test/setup.ts` mocks `@/hooks/useServiceHub` with a `vi.fn()`-per-service `mockServiceHub` (real `speech` and `dsh` default services), stubs `matchMedia`/`ResizeObserver`, and still defines legacy `globalThis.core`/`fs` mocks.
- **Mocking Tauri:** `vi.mock('@tauri-apps/api/core', () => ({ invoke }))` with `vi.hoisted`; plugin APIs the same way (`@janhq/tauri-plugin-llamacpp-api`). `web-app/vitest.config.ts` aliases plugin APIs to their `guest-js/index.ts` and `@tauri-apps/api/core` to one module instance so mocks apply.
- **Rust:** `make test-rust` runs `stub-tauri-resources.mjs`, then the main crate (`cargo test --locked --no-default-features --features test-tauri -- --test-threads=1`), the hardware and llamacpp plugins, and `utils`.
  - One test: `cargo test --manifest-path src-tauri/Cargo.toml --no-default-features --features test-tauri <name> -- --test-threads=1`.
  - Inline `#[cfg(test)] mod tests` or sibling `tests.rs`; integration tests in `src-tauri/tests/upgrade_compat.rs` (fixtures `tests/fixtures/upgrade/<version>/`) and plugin `tests/`.
  - llamacpp `engine_smoke`, `worker_http`, `worker_supervision`, `diag_backend_ops` need `--features engine` and `JAN_TEST_GGUF=<small.gguf>`; `make test` never runs them.
  - Test data goes to the OS temp dir (`get_jan_data_folder_path` under `cfg!(test)`).
- **Known state:** some web tests still assert pre-migration behaviour (e.g. `services/models` `startModel` call args). Rerun a failing file alone and compare with `HEAD` before investigating.
- **UI changes:** verify the real flow in the running app; unit tests alone do not cover it.
