# `@janhq/jan`

The `jan` command is the sole supported Node application launcher: profiles are ordered stacks of plugin-bundle patch layers under the user's own overrides. SDK and ACP are profiles, not separate public bins. The Python runtime wheel packages this same command; the SDK defaults to `sdk`, and the minimal example selects `sdk-minimal`. [`src/args.ts`](src/args.ts) owns the command grammar, and [`src/bin.ts`](src/bin.ts) loads only the selected runner. Invalid commands, options from another mode, and fatal configuration or boot failures exit nonzero.

## Entry modes

| Command | Purpose |
|---|---|
| `jan <name>` / `jan --profile <name>` | Boot the named profile under `$JAN_HOME/profiles/<name>`. |
| `jan --profile <name> --from-default-profile <template>` | Replace a custom profile with a fresh copy of a shipped template, then boot it. |
| `jan --profile acp` | Serve automation clients over ACP stdio until disconnect. |
| `jan --profile headless "job"` | Run one fresh persisted session, print the final answer, and exit. |
| `jan --profile sdk` | Serve SDK clients over JSON-RPC stdio until shutdown or disconnect. |
| `jan --profile sdk-minimal` | Serve SDK clients with the standalone minimal agent tree. |
| `jan web` | Boot the Web profile. |
| `jan plugin --profile <name> <pnpm args>` | Manage a profile's plugins by forwarding to pnpm in the profile directory. |

The invoking directory is the default workspace root. The `web`, `headless`, `sdk`, `sdk-minimal`, and `acp` profiles auto-initialize on first use from shipped templates. Create or reset another profile at a non-shipped name with `--from-default-profile`, or initialize a base-backed profile through `jan plugin`. The `desktop` name is reserved for the Electron-owned profile, so the CLI rejects boot and config-dump requests for it. The npm CLI also rejects its plugin-management requests; the [Desktop-installed command](../desktop/README.md#bundled-command-runtime) can manage the initialized Desktop profile using that installation’s runtime.

## App arguments

The launcher parses only its own flags and hands everything after them to the booted profile, where any injected app plugin may parse the shared immutable snapshot ([`jan-cmdline`](../../packages/boot/cmdline/README.md)). The first token the launcher does not recognize starts the app's arguments:

```sh
jan --profile web --port 8080       # --port belongs to the web app
jan --profile tui --resume <id>     # example, assuming the tui profile is installed; --resume belongs to the terminal app
jan --profile headless "run the tests"
jan --profile web --help            # the web app's flags, not the launcher's
jan --help                          # the launcher's own help
```

<a id="profiles"></a>
## Profiles

A profile directory holds a `package.json` (out-of-tree plugin dependencies plus the profile manifest `jan.profile` with its ordered `bundles` list) and a `cordis.patch.yml` (the user's own patch layer). `jan-hmr`, when enabled in YAML, watches the profile manifest and both profile and home patch files, then recomposes all layers through one serialized reload. Without HMR, changes apply on restart. Edits arriving during watcher registration use the same nonfatal reload reporting as later edits. [Plugin Manager](../../packages/boot/plugin-manager/README.md) shares package operations and the profile write lock with `jan plugin`; package updates retain disabled bundle selections. CLI package commands inherit authentication variables and terminal descriptors, including interactive build approval; service calls retain their scrubbed environment and captured diagnostics.

Run `jan plugin --profile <name> add <package>`, `list`, or `remove <package>` to manage profile dependencies. An existing bare local directory or tarball passed to `add` resolves from the invoking directory. Append `--json` to write one result to stdout, with pnpm diagnostics on stderr. The result includes `command`, `ok`, `exitCode`, `packages`, and `bundles`; each package has a `name` and, when known, a `version`.

For a trusted plugin, append `--yes-builds` to `add` to approve dependency build scripts reported by that install. The approval persists in the profile's `pnpm-workspace.yaml`. Review [how build approvals work](../../packages/boot/plugin-manager/README.md) before using this flag in automation.

Installation and profile startup enforce the declared `engines.jan` range, or Jan peer ranges when it is absent, against the same runtime version shown by `jan --version`. Incompatible plugins require an explicitly acknowledged exact-version exemption. The [plugin manager's compatibility reference](../../packages/boot/plugin-manager/README.md#version-compatibility-and-exemptions) documents `version-exemptions`, `allow-version`, `revoke-version`, persistence, and risks.

The tree composes over an empty root:
- each bundle's patch in `jan.profile.bundles` order
- then the profile's `cordis.patch.yml`, then the home-level `$JAN_HOME/cordis.patch.yml`
- then `--patch` overlays

Bundles named in `jan.profile.bundles` resolve from the jan installation first (`@janhq/jan-base`, `@janhq/jan-web-app`, `@janhq/jan-headless`, `@janhq/jan-sdk-app`, `@janhq/jan-sdk-minimal`, `@janhq/jan-acp-app`), then from the profile's own `node_modules`, where pnpm installs out-of-tree plugins.

Use `--dump-default-config` and `--dump-config` to inspect the composed tree without booting it. `--dump-config-schema` imports the composed tree's declared plugin schemas and prints JSON Schema for entries and patches instead of configuration values; read the [schema-dump safety and scope](reference/README.md#config-schema-dump) before inspecting untrusted plugins.

The [CLI behavior reference](reference/README.md) owns exact layer precedence, flags, shutdown behavior, deployment defaults, and source execution. The [startup and reload failure table](../../packages/boot/app-boot/README.md#startup-and-reload-failures) compares optional and required plugin failures with configuration HMR.

## Optional overlays

`config/examples/` ships opt-in overlays for GitHub review webhooks, memory MCP servers, and runtime Cordis tools. They are never part of a default profile; the [user guides](../../docs/user/guide/index.md) and [developer practice guides](../../docs/user/develop/practice/index.md) own setup and safety instructions.

## Development

Production runs require built package and frontend artifacts. From the repository root, run `pnpm run build` separately, then use `pnpm jan <args...>` to run the TypeScript entry and forward every argument; the [source-execution reference](reference/README.md#source-execution) owns the module-resolution contract.

The `@janhq/jan/profile-boot` export provides the shared profile lifecycle to the Desktop host. A resolved application profile supplies its own installation anchor for runtime package resolution while retaining the Harness home patch, proxy environment, telemetry switch, patch reload, and bounded shutdown.

Packaged installations call the same `runCli()` entry with their package-manager executable. The Desktop carrier also enables plugin operations for its initialized profile; npm launches omit these options. Installation-owned package environments apply only to plugin package operations; the invoking directory, ordinary profile selection, and agent-shell PATH retain their CLI meanings.

The [Web failure matrix](tests/profiles/web/tests/web-failure-matrix.expected.e2e.ts) runs the built CLI through startup failures and native configuration HMR with `awaitWriteFinish` enabled in `test:expected`. It verifies authenticated HTTP responses, diagnostics, recovery, process exits, and disposal without model API calls; the [startup acceptance](tests/profiles/web/tests/web-best-effort-startup.expected.e2e.ts) also covers the shipped required Web dependencies and port conflicts.
