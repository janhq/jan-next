---
name: create-plugin
description: Use when designing, reviewing, adding, enabling, installing, configuring, or debugging a Jan plugin, bundle, page, panel, decoration, widget, or agent tool. Treat visual requests with no other destination as Jan UI plugins. For an MCP connector, use create-connector; for reusable instructions, use create-skill; for a mode or named agent, use editing-cordis-compositions.
---

# Create a Jan plugin

Author a bundle in the workspace, then install it into the Jan app the user is running with `plugin_manager` (`action: install_bundle`, `target`: absolute package directory). Keep the workspace source: a local directory install links to it. The installed bundle is selected in the active profile, affects all its chats, and survives restart. The user can manage it in Desktop's Customize > Plugins (Plugins in Web).

Do not write the profile's `package.json` or `cordis.patch.yml`, create packages under `$JAN_HOME`, or run pnpm in the profile directory: `install_bundle` performs those steps, and each hand-made write outside the workspace needs its own approval. Every `plugin_manager` action, including `list_plugins` and `list_bundles`, also needs approval without Full access, so call it only when its result decides the next step.

## Design or review

Read the applicable references below and inspect the proposed or existing plugin against current APIs. Report design choices or findings instead of following the installation workflow. Do not write files, install bundles, or change profile state unless the user requests implementation.

## Enable a shipped plugin

Use `plugin_manager` with `enabled: true`: `set_plugin` targets a disabled row in an enabled bundle, and `set_bundle` targets a deselected bundle. List first if you need the exact id. If the feature needs extra rows or configuration, install a workspace bundle that inserts those rows and overrides the target by id. Check the shipped bundle patches and `apps/cli/config/examples/` in source. Shipped packages already resolve from Jan's installation. For a market plugin, use `plugin_market` when available, and pass the returned install target and registry to `plugin_manager`.

## Deliver a working plugin first

1. Confirm the result and destination. A visual request with no other destination means a plugin rendered in the current Jan UI, not a standalone image or HTML file. Choose a small working first version and install it before visual refinement.
2. Discover only the APIs needed for that version: `cordis_inspect_list`, then targeted `cordis_inspect_query` calls. For UI, query Client `Slots.listSubTree` and the selected slot's registration options and props. For anything beyond a static decoration, such as tool policy, agent context, session-derived state, or Chat rows, read `references/practices.md` before choosing the extension point; for a user action in plugin UI, also read `references/user-actions.md`. Once the chosen slot and registration API are known, write the plugin.
3. Copy the matching template into one workspace directory, or write the package, patch, and Host/Client files there. Complete the localized display metadata and icon checklist in `references/host-plugin.md`, including for Host-only and configuration-only bundles. Check JavaScript syntax and the manifest, then install. Preview the installed plugin, not a mock shell, standalone HTML file, or offscreen rendering.
4. Read the installation result: `application` and `warnings` decide whether the change is live, not logs, process lists, or the page's boot payload. Confirm new rows with approval-free `cordis_inspect_query`, not `list_plugins`. After `application: applied`, exercise the capability or inspect the live Client registration. Verify installed display metadata and the icon using `references/host-plugin.md`. Use the connected page when available; follow `references/verification.md` for page/panel design checks and unavailable browser control, and `references/user-actions.md` for user actions. Restore user state changed during testing. Report verification limits; installation and slot registration alone do not establish what the user sees.
5. Fix observed defects in the same plugin. When the requested result works, finish with its location, verification status, and the reason for any display-resource exception; never silently accept default artwork. Do not continue speculative variants, optional features, or mock previews. Close any task list.

## Knowledge sources, in order

1. Inspection: `cordis_inspect_query` answers exact Service methods and Event modes (`Service`, `Event`), a mounted plugin's Config JSON Schema (`Config.listConfigs`: filter the paged directory by `name`, then query the `entry` id), the Tools this Agent can call (`Tool`), and live Client Slots and theme tokens (`Slots`, `Theme`).
2. Package documentation: `Config.listConfigs` with `name` set to the package finds its entries; querying one `entry` returns its `packageDir`, the resolved package directory. Read `<packageDir>/README.md`. Bundled packages resolve from the jan installation and profile-installed bundles from the profile, so never guess the path from `$JAN_PROFILE_DIR`.
3. Source: installed packages ship built `lib/index.js` and `lib/types/**/*.d.ts` with JSDoc under that same `packageDir`, not `src/`; a source checkout of Jan has `packages/<group>/<name>/src`. Read them when inspection and the README leave a question open, and start source-level diagnosis from a concrete installation or runtime failure.

The shell provides `JAN_HOME` and, for profile-launched Jan, `JAN_PROFILE` (name) and `JAN_PROFILE_DIR` (active directory, normally `$JAN_HOME/profiles/<name>`, `desktop` for Desktop). The profile holds its manifest, patch, and profile-installed packages; it does not hold Jan's shipped bundles. Use `$JAN_PROFILE_DIR` in Bash or `$env:JAN_PROFILE_DIR` in PowerShell rather than guessing. For source or CLI profiles, `jan --profile <name> --dump-config` prints the composed rows; inspect the running Desktop Host directly.

## Read next

The files below live in this skill's base directory, which the `skill` tool reported, and the table is the complete list: do not enumerate that directory. In every deployment, including a source checkout, read these files with the file-read tool, write copies into the workspace with the file-write tool, and verify a copy by reading it back. In Desktop the directory sits inside `app.asar`, which only the Host process's own file reads can open; shell commands (`ls`, `cat`, `cp`, `cmp`), the glob and search tools (they run a native ripgrep process), `node`, and pnpm all fail on it. Never install or syntax-check a template in place; copy its contents into the workspace first.

| Task | File |
|---|---|
| Bundle manifest, locale resources, icons, installation, Host exports and Config | `references/host-plugin.md` |
| Jan UI: Client manifest, module loader, slots and Settings | `references/ui-plugin.md` |
| Page/panel design checks and verification without browser control | `references/verification.md` |
| UI plugin template, including display resources | `templates/decoration/package.json`, `templates/decoration/cordis.patch.yml`, `templates/decoration/index.js`, `templates/decoration/client.js`, `templates/decoration/locale`, `templates/decoration/icon.svg` |
| Loader patch dialect and the list of installable plugin packages | the `cordis-composition-reference` skill |
| Choosing extension points, contexts, and state mechanisms for upgrade stability and performance | `references/practices.md` |
| Sharing application operations between UI actions and agent tools | `references/user-actions.md` |
