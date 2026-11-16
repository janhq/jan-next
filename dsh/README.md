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
| `assistant/` | `ow-assistant` | Jan assistants and their per-session instructions |
| `image-generation/` | `ow-image-generation` | OpenAI-compatible and Seedream image tool, settings and inline previews; API key stays in the OS keyring |
| `server/` | none | Legacy stdio JSON-RPC server, not used by the desktop window |
| `templates/ui-plugin/` | `open-waifu-plugin-hello` | Starting point for a new plugin |

Rust (`src-tauri/src/core/dsh/web.rs`) lists the built-in plugins in `<data>/dsh/web.patch.yml` on every start. Their files load from this folder in development, so a client or host edit only needs an app restart. `assistant/index.mjs` and `llamacpp/runtime.mjs` are generated: run `corepack yarn build:dsh` after editing their TypeScript sources.

## Image generation

In **Settings > Plugins > Image generation**, choose OpenAI (including compatible routers) or Seedream, enter an image model ID and API key, and set the API base URL under Advanced settings. HTTPS is supported everywhere; HTTP is allowed on loopback, RFC1918 LANs and the 100.64/10 shared-address range. Save validates the connection without generating a paid image. OpenAI-compatible routers must provide model metadata at `/models/{model}` and return PNG `b64_json` from `/images/generations`.

The active API key is stored only in the OS keyring (`open-waifu-image-generation` / `api-key`), never in YAML or browser storage. Changing provider or API origin requires entering a key again. Non-secret provider profiles and model settings use Jan's settings store. The agent gets `image_generate` and the bundled `generate-image` skill; results are workspace PNGs with authenticated inline chat previews. PNG bytes are preserved without native image codecs or thumbnail conversion.

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
