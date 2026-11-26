# AGENTS.md - Jan product plugins

These rules supplement the [root rules](../AGENTS.md) and the [package rules](../packages/AGENTS.md). They decide where a Jan feature lives and what it is called, so every team member puts the same plugin in the same place.

Every Jan feature lives in this monorepo, including code ported from another repository (an upstream DSH plugin, an extension of the earlier Jan desktop app). A Jan plugin never gets its own repository, a git submodule, or a dependency on an outside repository. Outside authors' plugins reach users only through the plugin market.

## Where a plugin goes

| The plugin is | Home | Examples |
|---|---|---|
| Desktop product behaviour written as plain JavaScript and shipped as source: a page, a sidebar row, a settings row, branding, an import | `plugins/<name>/` | `model-hub`, `downloads`, `jan-theme`, `legacy-import`, `preset-square` |
| A capability with TypeScript sources, a build or its own Vitest project, or one that another bundle could mount | `packages/<group>/<name>/` in the [group](../packages/README.md#package-groups) of its role; its browser half is `packages/client/ui-<name>/` | `packages/web/web-search`, `packages/llm/llama-cpp`, `packages/client/ui-settings-local-model` |
| Under evaluation without a product commitment | `packages/experimental/<name>/` ([rules](../packages/experimental/AGENTS.md)); the desktop default composition cannot mount it | |

Choose the first row that fits. A plain JavaScript plugin that grows a build or a TypeScript API moves to `packages/`. Helpers shared by the plain JavaScript plugins live in `plugins/plugin-api`.

## Names

| Item | Form | Example |
|---|---|---|
| Directory | short kebab-case `<name>` naming the feature | `plugins/model-hub` |
| npm name | `@janhq/jan-<name>`; a browser-only package under `packages/client/` is `@janhq/jan-client-ui-<name>` | `@janhq/jan-model-hub` |
| Desktop bundle row `id` | `jan-<name>` | `jan-model-hub` |
| Slots it declares | `<domain>.<entry>.<hole>` ([rule](../packages/client/AGENTS.md)) | `sidebar.toggle.actions` |
| Environment variables | `JAN_<NAME>_*` | `JAN_MODEL_HUB_*` for `model-hub` |
| Commit scope | `<name>` | `feat(model-hub): ...` |

Never use `@deepseek-ai/*`, a `dsh-` prefix, or a new `@janhq/jan-experimental-*` name.

## Shipping it in the desktop app

One change carries all four:

1. `package.json`: `private: true` for a `plugins/` package, `exports` for `.`, `./client` and `./package.json`, and `jan.client.platform: "web"` when it has a browser half.
2. A row in `plugins/desktop-app/cordis.patch.yml` with a comment saying what it adds, and the dependency in `plugins/desktop-app/package.json`.
3. The directory in `PRIVATE_RUNTIME_PACKAGES` in `apps/desktop/scripts/package-target.ts`, and in the list `apps/desktop/tests/package-target-stages.spec.ts` asserts.
4. `pnpm install`.

A `packages/` capability that desktop ships also takes steps 2 to 4.

## Browser half

A plugin's `client*.js` is Jan UI like any `packages/client/` package: follow [jan-client-ui-ux](../.agents/skills/jan-client-ui-ux/SKILL.md) and the [Jan design contract](jan-theme/design/DESIGN.md), reuse `ui-primitives` through the module loader where they fit, route copy through `client.locale.js` in all eight locales, and write colors, radii and motion as theme tokens (`var(--ds-...)`, `var(--dsw-...)`) in CSS template strings too. The ui-theme style gates scan these strings.

## Porting from another repository

Copy the sources into the home the table chooses; do not depend on the outside package. Rename `@deepseek-ai/dsh-<pkg>` to `@janhq/jan-<pkg>`, `@deepseek-ai/cordis` and `@deepseek-ai/schemastery` to `@janhq/cordis` and `@janhq/schemastery`, the `dsh` CLI to `jan`, `DSH_*` variables to `JAN_*`, and `dsh-<name>` ids to the names above. The package README names the source repository, commit and license under "Origin", and the source's license file stays in the package when it is not MIT. Later upstream fixes are ported by hand against that commit.
