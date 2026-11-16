# Plan: the app window is DSH's web host; Jan's screens become DSH UI plugins

Status: desktop shell cutover implemented (2026-11-16). Jan visual parity remains under verification. The owner requires one DSH UI with Jan's layout; Plugins and Automation may remain as additional features.

## Desktop cutover verification

- Vite selects `web-app/src/main-desktop.tsx` for Tauri and scans that entry for dependencies. It initializes settings and starts DSH without loading Jan's legacy route tree.
- `ServiceHubProvider` starts DSH unconditionally on desktop. The shell selector, `?shell=jan` escape, setup return URL and return-to-Jan footer were removed. A startup failure shows its reason and Retry.
- Three measured reloads displayed a working composer in 3.9, 3.1 and 3.0 seconds (median 3.1 seconds). Earlier baseline was 21.4 seconds. These are dev-build reloads with the DSH host already running, not cold installation timings.
- Actual UI proof: send a message and receive a reply, reopen the saved chat after reload, install a separate local UI plugin, enable it, observe its footer and accent contribution after reload, disable and uninstall it. Screenshots and limitations are recorded in `C:/Users/thinhlpg/.co/asset-work/open-waifu-dsh-shell/notes.md`.
- The shell plugin registers a separate locale namespace and uses slot registrations and theme tokens. Its branding seats use priority -1, so user plugins can replace them at -2 or lower. Settings and Plugin manager footer actions use DSH services.
- P1 migration blocker: `shellSetup` filters out llama.cpp and the desktop bootstrap does not start the engine. A selected local-only model therefore cannot chat through the DSH desktop path yet. The verified flow uses 9router. This checkpoint is experimental, not a behavior-preserving release.
- Remaining: local model startup and provider handoff, full Jan sidebar/composer/model-picker parity, plugin-manager first-open loading feedback, and migration of native Model Hub/engine/voice controls. The legacy routes still exist in source; their removal is not complete.
- Checkpoint checks: TypeScript passed; both shell JavaScript files passed `node --check`; the native desktop launched and displayed the saved chat and Settings. `yarn lint` reported 33 errors in untouched llama.cpp, native filesystem, legacy service and model-service files. No test suite was run.
- The owner's 2026-11-16 commit/push checkpoint pauses further UI edits. Unregistered wrapper experiments were removed from the package and saved outside the repository for later work.

## Runtime configuration

- The host currently uses global `@deepseek-ai/dsh` 0.2.2; `OW_DSH_CLI` selects another built CLI entry. A checkout is needed only for the legacy stdio transport.
- Rust writes `<data>/dsh/web.patch.yml` on startup with the shell plugin, theme, active provider routes and selected model. Provider keys come from the OS keyring through `OW_PROVIDER_KEY_<i>` environment variables and are never written to the patch.
- Host state is stored in `<data>/dsh/web-home`, separate from `~/.dsh`.
- Rust starts navigation to the launch URL so DSH's SameSite=Strict authentication cookie survives the redirect. The `dsh-shell` capability grants only native window controls to loopback pages in the main window.
- A fresh profile previously took about 100 seconds to install. Cold startup has not been remeasured for this checkpoint.

## Goal

open-waifu's UI works the way DSH's does: everything on screen is a DSH UI plugin, composed in slots. Jan's current screens (chat skin, Model Hub, llama.cpp and audio.cpp engines, voice, settings) become a set of DSH client plugins among the others. DSH's own modes come for free:

- **Creator mode**: DSH's shipped `cordis` preset (standard tools plus `tool-cordis`, runtime inspection, plugin experiments and preset authoring).
- **Super agent**: DeepSeek's `dsh-superagent` bundle (GitHub/Feishu sources, a policy, tickets, one DSH session per ticket, and its own "Superagent" panel in the sidebar).

## What DSH gives us (checked 2026-11-13)

- `dsh web` (checkout `apps/cli/lib/bin.js web --host 127.0.0.1 --port N`, with `DSH_HOME` set) boots the full host: web server, `__DSH_BOOT__` graph, `/plugins/<id>/client.js` bundles, the preset roster and the session API. Booted in about 5 s from a fresh `DSH_HOME`. The mode picker lists Standard, Code, Minimal and Creator.
- UI composition: the shell renders only `root`. Every feature registers with `ctx.slots.register({ name, children?, store?, inject? }, Component)` (`packages/client/AGENTS.md`). A package joins by declaring `dsh.client` in `package.json` and exporting `./client`.
- Profiles: `$DSH_HOME/profiles/<name>/` holds `package.json` (`dsh.profile.bundles` plus out-of-tree plugin deps) and `cordis.patch.yml`. Then `$DSH_HOME/cordis.patch.yml`, then `--patch` overlays. A bundle such as `dsh-superagent` is a dependency whose `dsh.bundle.patch` joins the stack.

## Target shape

```text
Tauri window ──webview──► http://127.0.0.1:<port>/   (DSH web shell, DSH UI plugins)
     │                                   ▲
     │ spawns + supervises               │ DSH host (node, `dsh web` profile "open-waifu")
     ▼                                   │   bundles: dsh-web-app, open-waifu, dsh-superagent
Rust core (src-tauri) ◄──HTTP (loopback, bearer)── open-waifu host plugins
  llama.cpp worker, audio.cpp, hardware, downloads   (engines, hub, voice: Node half)
```

- Rust keeps what needs native access: llama.cpp (`jan-llama-worker`), audio.cpp, hardware probes, downloads, file dialogs, window control.
- New `open-waifu` DSH bundle (pnpm package, in this repo under `dsh/`):
  - host plugins: `ow-engines` (talks to the Rust core over a loopback HTTP API with a per-launch token; exposes llama.cpp and audio.cpp as an LLM provider and speech services), `ow-hub` (model catalogue and downloads).
  - client plugins (`dsh.client`): `ow-settings-engines` (llama.cpp and audio.cpp cards in Settings → Plugins), `ow-hub` (Model Hub page), `ow-voice` (read aloud and dictation in the composer), `ow-theme` (the app's look).
- The window loads the DSH shell URL. Tauri commands stay available to the shell only through the host plugins, so a DSH client plugin never calls `invoke`.

## Phases

1. **Desktop shell cutover, implemented.** Rust starts global `dsh web` on a free loopback port (`--port 0`, URL read from the `dsh web:` line). The desktop bootstrap always opens that host. Jan branding and native window controls come from `open-waifu-shell`; full layout parity remains in progress.
2. **Engines as a provider.** `ow-engines` host plugin registers llama.cpp as an OpenAI-compatible LLM provider in DSH's model settings (it already speaks `/chat/completions` on the local server). audio.cpp shows as a speech service.
3. **Jan screens as client plugins.** Port Model Hub, engines settings and voice to `dsh.client` packages. Chat, threads, workspace, plan, approvals, questions, subagents and settings come from DSH's own plugins, so Jan's versions are deleted, not ported.
4. **Super agent.** Add `dsh-superagent` to the profile's bundles. Its setup (`SETUP.md`) needs a GitHub repo and token; Feishu is optional.
5. **Cut over.** Remove the Jan React shell, `web-app/` routes that DSH replaces, the old `jsonrpc-demo` path and `dsh-openwaifu-server`. Update `AGENTS.md`.

## Open decisions

- **Host distribution.** Development currently uses global `@deepseek-ai/dsh` 0.2.2. A packaged release still needs a pinned, app-managed runtime instead of depending on a global Node/npm installation.
- **Chat look.** DSH's chat is a coding-agent UI. The waifu chat look becomes either a theme plus a custom `conversation.chat.node` renderer, or a separate client plugin with its own route.
- **React versions.** DSH ships React 18 and the web-app uses 19. Client plugins share DSH's React, so ported screens target 18.

## Acceptance per phase

- Phase 1: the app window shows the DSH shell, a chat with the 9router model answers, and Creator mode appears in the mode picker and starts a session.
- Phase 2: a local GGUF model loaded by `jan-llama-worker` answers a DSH chat.
- Phase 4: the Superagent panel opens in the sidebar and shows its setup state.
