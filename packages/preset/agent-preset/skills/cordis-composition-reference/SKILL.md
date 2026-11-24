---
name: cordis-composition-reference
description: Use when reading or writing a Jan bundle patch or mode and looking up Cordis Loader YAML (insert, override by id, group, disabled, isolate, !!js), the live composition, or packages a Jan plugin can mount.
---

# Jan Cordis composition reference

Use this reference for Jan bundle patches and mode plugin lists. For authoring procedures, use `create-plugin`, `create-connector`, or `editing-cordis-compositions`.

## Loader patch dialect

Jan applies the selected bundles in order, then the active profile's `cordis.patch.yml`, the home patch, and invocation `--patch` overlays. A mode is a scoped plugin list within this composition; an agent profile is a separate Markdown file, not a patch. Each Loader patch is a mapping:

- `insert: [rows]` appends rows; with an `id` naming an existing `group: true` row, the rows are appended inside that group's `config` list.
- A patch with an `id` and no `insert` targets the existing row with that id. Supplied fields replace the row's fields; `config` is replaced wholesale, never deep-merged, so restate every field the row needs. A truthy `name` asserts the existing plugin name rather than renaming it.
- Non-insert patches without a nonempty `id`, and targets that match no row, are warned about and skipped.

A row has `id`, `name` (the plugin package specifier; inserted relative paths are anchored beside their patch file), optional `config`, and optional `disabled`, `inject`, `intercept`, and `isolate`.

- `group: true` with `name: cordis:group` makes `config` a nested entry list and allows patches to insert into it by id. `cordis:include` loads a literal YAML or JSON entry list from `config.path`.
- `disabled` accepts a boolean, null, or a `!!js` expression evaluated against the Loader context at every mount decision. A disabled row omits required `config` unless `group: true` forces activation.
- `!!js` scalars are Loader expressions, never `!js`. Inside `config` they are evaluated after the row's declared injections activate, against that plugin's context (`ctx.<service>`), so `!!js janHomePath('sessions')` and `!!js "!ctx.get('profileContext')"` are valid. Other row metadata stays literal.
- `isolate` maps service names to `true` or a realm label; a preset plugin that provides a service isolates the provider and all consumers together. Scope controls contributions and event visibility; `isolate` controls service instances.

`plugin_manager` `list_plugins` reports each row's `enabled` flag and `fiberPhase`; `set_plugin` and `set_bundle` answer `overridden` when a higher-priority layer wins.

## Installable plugin packages

`references/packages.md` is the generated inventory of loadable workspace packages. Read only the relevant group with the file-read tool (use line ranges for the long file); don't run a shell search on installed skill resources in Desktop's `app.asar`. Check the active installation with `cordis_inspect_query`, including `Config` for plugin fields, `Slots` for Client extension points, and `Theme` for tokens. In source, see the generated `docs/config-catalog.md`, `docs/tool-catalog.md`, and the Client inspect catalog linked from `docs/subsystems/slots.md`. `plugin_manager` `list_bundles` names installed external bundles.
