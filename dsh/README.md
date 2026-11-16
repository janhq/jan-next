# DSH plugins in open-waifu

The desktop window is DeepSeek Harness's web host. Every screen comes from a DSH plugin, so a new feature is a plugin folder.

## Folders here

| Folder | Plugin id | What it does |
|---|---|---|
| `open-waifu-shell/` | `ow-shell` | Jan look: palette, wordmark, sidebar rows, footer, model pill, plugin card icons, window buttons |
| `native/` | `ow-native` | Host-only bridge to the Rust side (authenticated loopback, fixed operation list) |
| `log-bridge/` | `ow-log-bridge` | Writes DSH runtime warnings, errors and session activation failures to the app log (adapted from dataelement/dsh-desktop, MIT) |
| `llamacpp/` | `ow-llamacpp` | Local model engine, Local models panel, model selection |
| `download/` | `ow-download` | Model downloads and the Downloads panel |
| `assistant/` | `ow-assistant` | Custom Agent preset instruction editor in Settings; imports legacy Jan assistants into the DSH profile |
| `image-generation/` | `ow-image-generation` | OpenAI-compatible and Seedream image tool, settings and inline previews; API key stays in the OS keyring |
| `jan-import/` | `ow-jan-import` | Read-only upstream Jan chat import into native DSH sessions, in Settings > Plugins > Import from Jan |
| `onboarding/` | `ow-onboarding` | First-run welcome on `settings.onboarding`: open Model Hub, connect a provider, or start chatting; shown once per copy version |
| `server/` | none | Legacy stdio JSON-RPC server, not used by the desktop window |
| `templates/ui-plugin/` | `open-waifu-plugin-hello` | Starting point for a new plugin |

Rust (`src-tauri/src/core/dsh/web.rs`) mounts built-in plugins through the generated `@open-waifu/dsh-bundle`. The initial theme is a bundle default, so Settings > General can save an overriding appearance preference in the DSH profile. The app-owned provider and shell values remain in `<data>/dsh/web.patch.yml`. Their files load from this folder in development, so a client or host edit only needs an app restart. `assistant/index.mjs` and `llamacpp/runtime.mjs` are generated: run `corepack yarn build:dsh` after editing their TypeScript sources.

## Interface preferences

Settings > Appearance adapts the original Jan accent swatches and colored-user-bubble switch. Changes save automatically in the shell plugin's DSH profile configuration. Theme and typography remain in General. Reset restores Jan's gray accent and colored bubbles. The shell reads live preferences on every navigation so reload preserves the selected palette.

## Microphone consent

Voice input leaves the microphone off until an explicit test or recording. On Windows, the native Jan permission dialog explains the requested access, distinguishes the input-level test from recognition, and offers Allow microphone and Don't allow. Only the running DSH host origin in the main window can receive this grant. The decision is not stored in the browser profile. Stop microphone test releases the preview capture. macOS retains its platform permission prompt.

## MCP servers and skills

Settings > MCP Servers supports local stdio commands and remote Streamable HTTP endpoints. Add or edit a connection, inspect its available tools, reconnect, disable or remove it. New connections start disabled. JSON import accepts the `mcpServers` object used by Jan and Claude Desktop, previews names and credential field names, rejects unsupported fields and duplicate names, and imports the whole set disabled. Codex TOML, plugin manifests, environment interpolation and legacy SSE require explicit conversion.

Connection settings live in the shell's DSH profile namespace. Environment values and HTTP headers are stored separately in DSH credentials and are never returned to the browser after saving. Editing a connection preserves those values unless replacement is selected. Removing a connection also deletes its stored credential record.

Settings > Skills discovers the standard DSH skill roots and allows linking additional absolute folders. Search the discovered instructions or edit a filesystem skill after acknowledging that saving changes its original file for every agent sharing that folder. Saves reject files changed elsewhere and preserve the skill's name and description frontmatter. Removing a linked folder leaves its files untouched. Compatible Claude or Codex skill instructions may be reused; hooks, manifests, permissions and unavailable tools are not imported. Unsaved drafts survive section navigation but not page reload.

## Agent preset customization

Settings > Agent presets ends with the custom instruction editor: pick a preset, then edit its name, description and instructions directly. Legacy Jan assistants are read only during a one-time import into the `ow-assistant` profile configuration. Imported names, descriptions, instructions, avatars and the whole source record are retained (`presets[].legacy`). Each Jan conversation's applied assistant instructions (`threads/<id>/thread.json`, `assistants[0]`) become separate saved snapshot presets assigned to that imported `jan-<threadId>` session, so editing the original assistant cannot change what a historical conversation was answered with, and those snapshots are read-only in the editor. Source files remain untouched.

New presets use Standard mode tools with a literal persona prefix (`interpolate: false`), so braces a user wrote are not re-read as prompt variables. The session header names the preset the conversation runs and opens the switch menu: a preset may change at any turn boundary (no reply in progress), the selection is appended to the native DSH session log, every message stays, and the next turn runs under the new composition. Presets still referenced by saved conversations cannot be deleted until those conversations select another preset, and a preset cannot be deleted while it is the new-task default.

The editor's writes go through `configEditor`; that reconciliation restarts `ow-assistant`, which re-registers every preset with the DSH registry. Presets are registered with `registry.definitionFor('standard')`, a Host API added in the matching `open-waifu-layout` checkout.

## Image generation

In **Settings > Plugins > Image generation**, choose OpenAI (including compatible routers) or Seedream, enter an image model ID and API key, and set the API base URL under Advanced settings. HTTPS is supported everywhere; HTTP is allowed on loopback, RFC1918 LANs and the 100.64/10 shared-address range. Save validates the connection without generating a paid image. OpenAI-compatible routers must provide model metadata at `/models/{model}` and return PNG `b64_json` from `/images/generations`.

The active API key is stored only in the OS keyring (`open-waifu-image-generation` / `api-key`), never in YAML or browser storage. Changing provider or API origin requires entering a key again. Non-secret provider profiles and model settings use Jan's settings store. The agent gets `image_generate` and the bundled `generate-image` skill; results are workspace PNGs with authenticated inline chat previews. PNG bytes are preserved without native image codecs or thumbnail conversion.

## Import from Jan

Open **Settings > Plugins > Import from Jan**, scan a Jan data folder, select chats and import. The default is the Jan data folder two levels above `DSH_HOME` (`<data>/dsh/web-home`); an upstream installation such as `%APPDATA%/Jan/data` can be entered explicitly. The importer only reads `threads/<id>/thread.json`, `messages.jsonl` and referenced local images. It never changes Jan files. Imports use native DSH persistence and the default workspace, not a parallel chat store. Session IDs are `jan-<threadId>`; existing IDs and existing `metadata.dshSession.id` links are reported as already imported.

Mapping preserves message IDs, user/assistant text, reasoning, thread creation time (Jan thread seconds converted to milliseconds), message times (already milliseconds), and titles pinned with a user-sourced `session/title` event. Embedded tools with known outputs, and calls with matching separate tool messages, become assistant tool-call blocks followed by native call/result events. Assistant segments split around tools. Turn/step brackets are structural reconstruction, not evidence of actual historical model requests; `stream` is empty because Jan does not retain original deltas. Stopped, pending and failed messages retain interrupted/error lifecycle markers. Known usage counters map to native accounting; snake-case prompt totals subtract known cache counts, while native camel-case input counts are already uncached. Unknown or inconsistent usage is omitted with a warning.

Available data-URL/local-file images are saved through DSH attachments; remote URLs are not fetched. Per-thread results report missing images, unsupported content, orphan/unpaired tool records and invalid usage. Audio/video, annotations, arbitrary metadata, non-image legacy attachments, Jan assistant instructions, retrieval/tool configuration and model parameters are not migrated. Original tool argument JSON formatting is lost when Jan stored parsed objects. Historical provider/model names are attribution only, not newly configured routes; continuation uses the current DSH composition. Native session sorting derives activity from user messages, so Jan's independent `updated` time is shown during scanning but is not forced into native activity. The original Jan files remain the archive for unmapped information.

## PPT template gallery

`ppt-runtime/` contains the matching `dsh-ppt` and `dsh-ppt-composer` 0.1.1-rc.2 package archives assembled from `dataelement/dsh-desktop/packages/ppt-runtime`. Their MIT licenses, template attribution and third-party notices are included in each archive. This runtime is separate from the unrelated npm `dsh-ppt` 0.20.x workbench.

With the app stopped, run with Node 24 and Corepack installed:

```bash
node scripts/install-ppt-runtime.mjs "<DSH_HOME>"
```

The installer backs up the web profile manifest, copies the archives into `DSH_HOME/vendor/open-waifu-ppt`, pins their paired dependency, and replaces the old PPT bundle entry with `dsh-ppt-composer`. Existing presentation files are left intact. Restart, click **PPT** above the new-chat composer, and select or preview a template. The matching `open-waifu-layout` DSH runtime must include the scoped npm subpath resolution fix and render `conversation.composer.dock` for the hero composer.

## Add a plugin

1. Copy `templates/ui-plugin/` to a new folder and rename `open-waifu-plugin-hello` in all four files.
2. In the app, open **Plugin manager**, choose the arrow next to **Add plugin**, then **Install a third-party plugin**.
3. Paste the folder's absolute path, select **Install**, then **Enable now**. The sidebar gains a **Hello** button whose panel shows a greeting from the host half.

An installed local folder is linked, so later edits apply after an app restart. Remove the plugin from its page in the Plugin manager.

A plugin has two halves:

- `index.mjs` runs in the DSH Node process. `apply(ctx)` registers routes, tools and services.
- `client.js` runs in the page. `apply(ctx)` registers React components into named slots (`main`, `sidebar.panellist`, `sidebar.footer.action`, `plugins.artwork`, `conversation.*`, …). DSH's `packages/*/src/client/contract/slots.ts` files declare every slot.

Keep the Jan look: use the theme's `--dsw-*` colour tokens and Tabler outline icons (24 grid, 1.5 stroke), as the shell does.

To make a built-in plugin, add its folder to the two lists in `web.rs` (`plugin_root` and `patch`).

## Test the desktop end to end

```bash
node scripts/e2e-desktop.mjs                           # launch, sidebar, Settings, Plugin manager
node scripts/e2e-desktop.mjs --plugin dsh/templates/ui-plugin   # also install and enable a local plugin
node scripts/e2e-desktop.mjs --prompt "Say hi"         # also send one chat turn (needs a working model)
```

The script starts the real `Jan-Desktop` build on a fresh temporary data root, drives its WebView2 through the DevTools protocol, and stops at the first failed step. It writes one screenshot per step, `steps.json` and `app.log` to `e2e-results/` (`--out` changes it). The debug build loads its bootstrap page from the Vite dev server, so that server must be running: `make dev` starts it, or run `corepack yarn cross-env IS_TAURI=true IS_DEV=true yarn dev:web` alone. Set `OW_DSH_CLI` when DSH comes from a checkout.
