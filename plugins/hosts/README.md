# Hosts

Hosts lists the other computers that run Jan and the devices that use this one. Open **Settings → Hosts**.

- **Other computers** saves a Jan by its address or over SSH. Test signs in with Jan's own login and opens its live connection, so a different web server on that port does not pass. Open opens that Jan's own page; its chats, files and tools stay on that computer. An address entry stores its login token in Jan's credential store, never in `hosts/connections.json`. Import from SSH config lists the concrete `Host` aliases in `~/.ssh/config` and the files it includes (patterns and `Match` blocks are skipped) and saves each chosen one by its alias with no port, so ssh still applies that alias's HostName, User, Port, keys and proxies.
- **Devices that reach this Jan** starts switched off. Turning it on opens a second listener on this computer's network address. Make code shows a QR code and a link that pairs exactly one device; each device gets a separate token, and Remove signs it out at once, including open chats. The devices file keeps only a hash of each device token. The owner's own login never leaves this computer.

A computer with no screen prints `jan hosts: pair a device at <link>` beside its `jan web:` line, once, when device access is on and no device is paired yet.

## Connect over SSH

An SSH entry is only its destination: an ssh config alias, `user@host` or `user@host:port`. Left unnamed, it is called by that destination; a row for a config alias shows the `User@HostName:Port` the config gives it. The SSH key must already work in `BatchMode`, because there is no terminal to type a password into. One Connect press does the whole job and opens the page when it is done:

| Step | What happens | Shown as |
| --- | --- | --- |
| Check | One `sh` command reports `uname -s`/`-m`, the C library, `$HOME`, `tar`/`gzip`/`sha256sum` and the installed build's identity. Only lines between `JAN_HOSTS_PROBE_BEGIN` and `_END` count, so a login banner cannot answer. | Checking that computer... |
| Copy | Skipped when `~/.jan/hosts-runtime/VERSION` already names this build. Otherwise the archive for that computer streams through ssh's stdin; the remote checks its SHA-256, unpacks it into a staging directory, moves it to `current/` and writes `VERSION` last. A damaged or cut-off copy leaves the previous build in place, and a copy that ends before its last byte reads as a dropped connection to resend. | Copying Jan: N of M MB |
| Start | `ssh -tt -L` runs the copied Node with the `edge` profile under `~/.jan/hosts-runtime/home`, on a loopback port, with `XDG_DOCUMENTS_DIR` defaulting to `~/Documents` so a server with no desktop folders still gets its default project, and forwards that port here. `-tt` ends the remote Jan when the tunnel closes. | Starting Jan there... |

Nothing is downloaded on the other computer, so it needs no internet and no Node. Its model traffic leaves through this computer: a loopback HTTP proxy here (the relay) accepts `CONNECT` tunnels and plain `http://` requests, `ssh -R` forwards a port on the other computer to it, and the remote Jan's `HTTPS_PROXY` points there with a random per-run password, because every local user there can reach that forwarded port. TLS stays end to end between the remote Jan and the provider. Set `relay: false` to let that computer use its own network.

The archives come from [`scripts/build-host-runtime.ts`](../../scripts/build-host-runtime.ts) ([layout](../../apps/jan-host-runtime/README.md)) and are read from the `runtimeDirectory` config, or `JAN_HOST_RUNTIME_DIR` when it is empty; `pnpm run dev:desktop` sets that variable to `dist-host-runtime/` in the checkout. No installer ships them yet. A Jan with no archive for that computer says so on Connect. Targets: Linux x64 and arm64 with glibc 2.28 or newer, and macOS arm64 and x64.

A Jan someone installed on that computer by hand is never used or changed: Hosts keeps its own copy and home under `~/.jan/hosts-runtime/`. Remove that directory there to take it away.

## Versions on the two sides

Each Jan serves its own page, so Open always runs the Client that matches the Host on the other computer. Hosts depends only on what the two sides exchange before that:

| Exchange | Relied on | Older Jan |
| --- | --- | --- |
| Index without login | HTTP 401 with `jan web authentication required` | Releases before 2026-11-16 say `dsh web`; both are accepted. |
| Sign-in | `GET /connect?token=…&interactions=none` answers 302 with a cookie | Same since 2026-10-10. |
| Live connection | WebSocket `api/remote.mux` opens with that cookie | Same since 2026-08-22. |

An SSH entry saved by an earlier Hosts also carried a command, profile and port; they are ignored, and dropped when the entry is edited. The hosts files carry `"version": 1`; a file of another version is refused rather than rewritten.
