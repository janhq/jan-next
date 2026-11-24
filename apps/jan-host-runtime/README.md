# `@janhq/jan-host-runtime`

The Jan that Settings → Hosts copies to another computer over SSH. That computer needs no Node, no Jan, and no internet: everything it runs arrives in one archive from the computer that connects.

This package lists dependencies only. Its closure is the `edge` profile's: [`jan-base`](../../packages/bundle/base/README.md), [`jan-web-app`](../../packages/bundle/web-app/README.md) and [`jan-edge-app`](../../plugins/edge-app/package.json), with every plugin their presets name. `pnpm run verify-runtime-closure --manifest apps/jan-host-runtime/package.json` rejects a preset plugin or workspace peer this list misses.

## Archive

`pnpm exec tsx scripts/build-host-runtime.ts --target <target> [--natives <dir>]` writes `dist-host-runtime/jan-host-runtime-<version>-<target>.tar.gz` and a `.sha256` file beside it. It runs on any host, including Windows; only the native programs (the flock addon, and on Linux the `landlock-run` sandbox launcher) must come from a machine of the target. `--natives` names a directory holding them at the target's `prebuilds.json` paths (default `native/system/packages/<target>`, filled by `pnpm --dir native/system run build:native` on such a machine). The archive holds:

| Path | Contents |
| --- | --- |
| `node/` | `bin/node` and its licence from Node `nodeVersion` in [`scripts/primary-runtime/lock.json`](../../scripts/primary-runtime/lock.json), checked against the lock's SHA-256 |
| `jan/` | `pnpm deploy --prod` of this package for the target, without type declarations, source maps or other targets' node-pty prebuilds |
| `jan/node_modules/@janhq/node-addon-system-<target>/bin/…/system.node` | The flock addon |
| `jan/node_modules/@janhq/node-addon-system-<target>/bin/landlock-run` | Linux only: the launcher the shell sandbox confines commands with; without it the remote Jan refuses every shell command |
| `executables.txt` | Every native program in the archive; the install restores their executable bit, which an archive built on Windows lacks |
| `build.json` | `{ format, version, target, node }` |

Targets: `linux-x64` and `linux-arm64` (glibc), `darwin-arm64` and `darwin-x64`. Hosts tells builds apart by `<version>+<first 12 characters of the archive SHA-256>`, so a rebuilt archive replaces the copy on the other computer. Nothing ships these archives yet: a Jan finds them only in the directory `JAN_HOST_RUNTIME_DIR` names, which `pnpm run dev:desktop` points at `dist-host-runtime/`.

## Installed layout on the other computer

Hosts installs under `~/.jan/hosts-runtime/`: `current/` holds the unpacked archive, `home/` is that Jan's own `JAN_HOME`, and `VERSION` names the complete install. A Jan someone installed there by hand keeps its own home and is never touched.
