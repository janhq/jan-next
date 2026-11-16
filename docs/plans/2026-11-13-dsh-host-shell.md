# DSH desktop migration plan

## Owner direction: DSH layout, Jan identity

The owner dropped 1:1 Jan layout parity (2026-11-16). The chat area, composer and transcript stay DSH's own. Jan supplies identity and familiar places: palette, fonts, wordmark, the hand activity mark, Tabler line icons on plugin cards, and Jan's navigation positions sketched below. Do not re-impose Jan's composer or transcript geometry.

```text
[ Jan             collapse ] [ provider / model pill ]       [ window buttons ]
[ New Chat          Ctrl N ]
[ New project       Ctrl P ]
[ Search            Ctrl K ]
[ Chats               ... ]          DSH chat area and composer
[ plain chat title rows    ]
[ Model Hub               ]
[ Plugin manager          ]
[ Settings                ]
```

## Goal

Keep one DSH desktop UI and convert every retained Jan builtin responsibility into real DSH plugins. Preserve native Rust backends and existing user data. Naming: npm `@open-waifu/dsh-<feature>`, loader/export id `ow-<feature>`, service key `ow<Feature>`. Existing native Jan package/crate identifiers stay unchanged.

## Local-first priority

Local models are the owner's first priority, matching Jan. Prioritize local model discovery, import/download, load/unload, model selection, inference and restored selection over remote-provider polish. Keep user-added remote endpoints optional. Never silently fall back to a remote model. Verify the local path in the real desktop before claiming parity complete.

## Transcript

The transcript is DSH's own (dropped from Jan parity with the layout). The one Jan element kept is the original upstream Jan hand logo beside "Deep diving…", replacing DSH's dolphin; the owner rejected the hand-with-rose image for it. Done and verified (`hand-route-fixed-annotated.png`).

## Current evidence and resume point

- DSH-only desktop entry, remote chat persistence, selected local-model startup and plugin installation were exercised in the native app. Evidence is stored in `C:/Users/thinhlpg/.co/asset-work/open-waifu-dsh-shell/notes.md`.
- Full sidebar/header/composer parity remains unfinished. Isolated matching DSH checkout: `C:/Users/thinhlpg/orca/workspaces/deepseek-harness/open-waifu-layout`. Dependencies installed. Node 24.11.1 installed for its >=24.9 floor. Use `OW_DSH_CLI` for its built CLI; preserve the older unrelated checkout.
- Owner interruption: annotated screenshots are now explicitly required in `00-self-improve`, including numbered finding ids, read-back inspection and annotated before/after fix evidence. Structure lint passed.
- Retained assistant and llama.cpp sources now live in `dsh/assistant` and `dsh/llamacpp/src`; legacy callers import the shared sources. Downloads, assistant management and local models have DSH host/client packages. RAG/vector storage implementations were previously removed; no replacement stubs or resurrection is in scope. Hardware and speech remain native services. Server and shell plugin ids are normalized.
- Integration check: Rust desktop compilation, web TypeScript and `build:dsh` passed. The real desktop opened all three management panels. Runtime checks found a provider ESM export-resolution failure and an assistant save/read-back inconsistency; both were corrected and re-exercised: a fresh Minimal-mode local session answered, and a saved assistant applied to a session.
- Import walkthrough on the real desktop: catalog lookup returned the repository files, catalog rendering now keeps only rows with a downloadable GGUF (197 of 283), Engine settings rendered the full native schema, and starting an import exposed a native task-id validation mismatch (`provider/model` rejected). The corrected boundary needs a rebuild and another desktop pass.
- Compaction: shipped `BasicCompactionEngine` freezes exact model policies at construction and exposes no registration hook, so a scoped public registration API is being added to the matching DSH checkout instead of mutating private config.
- Native download-ID correction compiled successfully. `openwaifu-native-plugin-check4` displayed startup failure before printing a host URL; no successful corrected-import claim. Task browser closed after capturing `migration-startup-failure.png`. The new compaction API requires the matching runtime, so the next launch must use `OW_DSH_CLI` and Node 24.11.1.
- Matching layout leaves and disposable exact-model compaction policy registration are built in the isolated checkout. The serial artifact build passed all 8 steps in 752.57 seconds. Native launch through `OW_DSH_CLI` displayed the new sidebar actions, hero, suggestions, composer placeholder and header model selector. A real remote turn returned `matching-runtime-ok`, persisted after reload, and the saved verification assistant returned `OW-ASSISTANT-VERIFIED` after application.
- Local provider activation now reaches preset-specific compaction engines through `agentPresets.serviceFor`, with explicit incompatible-runtime errors. The real desktop showed native engine/device state and completed a 1.1 MiB GGUF URL import; scratch model removed afterward. Reopened Minimal-mode local session returned `local-priority-ok` in 53 seconds. Model ordering and unselected bootstrap now prioritize the local engine; bootstrap TypeScript passed.
- Original upstream waving-hand logo is saved as `dsh/open-waifu-shell/assets/jan-original.png` and allowlisted by the shell host. Main added a focused `data-chat-running-mark` hook in matching DSH and shell styling; real activity verification awaits client rebuild/relaunch.
- Client rebuild found stale test-fixture contracts introduced by the focused layout seams: `pickSuggestion`, `renderLabel`, `addWorkspaceButtonRef`. Existing shell worker owns only those fixture migrations. Transcript worker owns transcript-specific shell CSS; main owns runtime integration. Do not run tests. Current app service is `openwaifu-matching-provider`; task browser `ow-plugin-migration`.
- New worker tasks use `9router/deepseek-flash:max`, per the owner's session instruction.
- Latest integration: client TypeScript, client bundles and web Vite build passed. Search now stops its opening click before the document dismissor; visible focused input and stacked footer rows verified in `search-fixed-annotated.png`.
- Added `UiWorkspace.setSessionGrouping` in the matching checkout, delegating to the existing persisted viewing store. Its scoped TypeScript and bundle build passed. Shell selects `flat`; real desktop shows saved chats directly (`flat-transcript-annotated.png`). Bubble computed styles are 8px padding/radius and 20px line height. Remaining composer/header and transcript structural parity stays open.
- Local Minimal-mode reply `local-hand-verified` completed in 1 second and survived reload and native relaunch. A longer local stream rendered the original yellow hand beside Deep diving (`hand-route-fixed-annotated.png`, inspected). The first image request returned 404 because the host predated the asset allowlist; task-owned app restart loaded it, then the exact resource returned 200 image/png. Current app service `openwaifu-hand-route`, host port 54124, CDP page AFC5121A62406C32200517EC9D308E2F. Browser `ow-plugin-migration` remains attached while verification continues.

## Architecture

Rust serves a loopback-only, per-launch bearer-authenticated API for a fixed native-operation allowlist. Only the Node host receives its URL/token through environment variables. No arbitrary invoke, generic command execution or browser exposure of the bearer. DSH host plugins own retained assistant, download and llama.cpp business logic. Browser plugins use same-origin host endpoints guarded by DSH authentication and origin checks, never direct native engine IPC.

- `@open-waifu/dsh-native` / `ow-native`: host-only native request and event transport.
- `@open-waifu/dsh-assistant` / `ow-assistant`: existing assistant JSON store, migrations, CRUD and selection-to-session persona.
- `@open-waifu/dsh-download` / `ow-download`: existing native download orchestration, progress, pause/cancel/resume.
- `@open-waifu/dsh-llamacpp` / `ow-llamacpp`: existing engine lifecycle, model data/migrations, preset generation, imports, embeddings and settings. Engine remains the native `jan-llama-worker`.
- `@open-waifu/dsh-shell` / `ow-shell`: existing shell and native window chrome.
- `@open-waifu/dsh-server` / `ow-server`: retained stdio protocol until its remaining legacy callers are removed.

## Execution

- [x] Inventory current implementations and actual registered native commands.
- [x] Establish package/id/service naming.
- [x] Implement scoped native bridge and host transport with progress/event delivery.
- [x] Move retained business logic into host plugin packages; legacy callers consume those modules rather than duplicate it.
- [x] Register host plugins on desktop startup, remove local-engine bootstrap from the abandoned renderer once host startup owns it.
- [x] Add DSH client management surfaces using existing slots, primitives, status/error feedback and keyboard-accessible forms.
- [x] Verify real native flow: `scripts/e2e-desktop.mjs` launches the debug build on a temporary data root and passes shell, Settings, Plugins, local plugin install (`dsh/templates/ui-plugin`) and a real reply (2026-11-16).
- [ ] Complete remaining layout work and full mission re-walk; report exact coverage and limitations.

## Plugin management layout

```text
DSH sidebar                  Feature panel
  Model Hub                  Installed models | Catalog | Import
  Assistants                 Assistant list | editable instructions | Save
  Downloads                  Task | transferred/total | Pause / Resume / Cancel
Settings > Plugins           llama.cpp configuration and runtime state
Chat composer                Existing DSH model picker, local provider included
```

## Acceptance

Retained methods must have real implementations. DSH panels must display native errors and progress. User data stays under the existing Jan data folder. Local models must be manageable and selectable without the old Jan route tree. Assistants must persist and apply to a DSH session. Downloads must retain pause/resume/hash verification behavior. Completion claims require an actual desktop walkthrough and inspected annotated evidence for the relevant flow. No tests unless explicitly requested; no commits, publishing or deployment without owner authorization.
