# Hosts

Hosts lists the other computers that run Jan and the devices that use this one. Open **Settings → Hosts**.

- **Other computers** saves a Jan by its address or over SSH. Test signs in with Jan's own login and opens its live connection, so a different web server on that port does not pass. Open in browser opens that Jan's own page in the system browser; its chats, files and tools stay on that computer. An address entry stores its login token in Jan's credential store, never in `hosts/connections.json`. Import from SSH config lists the concrete `Host` aliases in `~/.ssh/config` and the files it includes (patterns and `Match` blocks are skipped) and saves each chosen one by its alias with no port, so ssh still applies that alias's HostName, User, Port, keys and proxies.
- **Devices that reach this Jan** starts switched off. Make code creates a link that works once and expires after ten minutes. The device gets a separate session token when it redeems the link, and Remove signs it out at once, including open chats. The devices file holds only token hashes. The owner's own login never leaves this computer.

A computer with no screen prints `jan hosts: pair a device at <link>` beside its `jan web:` line, once, when device access is on and no device is paired yet.

### Device gateway configuration

Set these fields on the `jan-hosts` plugin:

| Setting | Default | Behavior |
| --- | --- | --- |
| `gatewayEnabled` | `false` | Start the device listener. Also set by the Device access switch. |
| `gatewayHost` | empty | Bind to one IP. Automatic selection is limited to RFC 1918 private IPv4 and tailnet IPs; it prefers a tailnet IP when using HTTP without LAN opt-in. |
| `gatewayPort` | `0` | Use a free port, or set a fixed one. |
| `gatewayTlsCertFile`, `gatewayTlsKeyFile` | empty | Provide a trusted PEM certificate chain covering the bind IP and its unencrypted PEM private key. Device requests use HTTPS/WSS and get a Secure cookie. Partial or invalid TLS settings never fall back to HTTP. |
| `gatewayAllowInsecureLan` | `false` | Permit HTTP on a private LAN without TLS. Settings > Hosts shows the risk before opt-in, and Jan logs a warning whenever it starts a cleartext LAN listener. |

Without TLS, loopback and tailnet IPs (`100.64.0.0/10`, `fd7a:115c:a1e0::/48`) are allowed without LAN opt-in. Only use tailnet IPs on an actual tailnet, where WireGuard protects the traffic. Any other address except private IPv4 requires HTTPS. On upgrade, a previously enabled cleartext LAN listener gets a one-time saved opt-in, unless the option was already explicitly set.

Changing an Address Host's normalized URL clears its login unless the new address includes a replacement token. Older saved logins without an address binding need a fresh login link. Changing the destination of a connected SSH Host closes its tunnel.

## Connect over SSH

An SSH entry is only its destination: an ssh config alias, `user@host` or `user@host:port`. Use brackets for IPv6 with a port, for example `user@[2001:db8::42]:2222`. Left unnamed, it is called by that destination; a row for a config alias shows the `User@HostName:Port` the config gives it. The SSH key must already work in `BatchMode`, because there is no terminal to type a password into. One Connect press does the whole job and opens no page or window; the new-project menu's Remote row connects the same way:

| Step | What happens | Shown as |
| --- | --- | --- |
| Check | One `sh` command reports `uname -s`/`-m`, the C library, `$HOME`, `tar`/`gzip`/`sha256sum` and the installed build's identity. Only lines between `JAN_HOSTS_PROBE_BEGIN` and `_END` count, so a login banner cannot answer. | Checking that computer... |
| Copy | Skipped when `~/.jan/hosts-runtime/VERSION` already names this build. Otherwise the archive streams through SSH; the remote takes an install lock (`flock` on Linux or `lockf` on macOS), checks the archive's SHA-256, unpacks it into staging, moves it to `current/` and writes `VERSION` last. The OS releases the lock if the installer stops unexpectedly. A damaged or interrupted transfer leaves the previous build in place. | Copying Jan: N of M MB |
| Start | `ssh -tt -L` runs the copied Node with the `edge` profile under `~/.jan/hosts-runtime/home`, on a loopback port, with `XDG_DOCUMENTS_DIR` defaulting to `~/Documents` so a server with no desktop folders still gets its default project, with `JAN_HOST_NAME` set to the saved connection's name so the remote window names this machine, and forwards that port here. `-tt` ends the remote Jan when the tunnel closes. | Starting Jan there... |

Nothing is downloaded on the other computer, so it needs no internet and no Node. Its model traffic leaves through this computer: a loopback HTTP proxy here (the relay) accepts `CONNECT` tunnels and plain `http://` requests, `ssh -R` forwards a port on the other computer to it, and the remote Jan's `HTTPS_PROXY` points there with a random per-run password, because every local user there can reach that forwarded port. TLS stays end to end between the remote Jan and the provider. Set `relay: false` to let that computer use its own network.

The archives come from [`scripts/build-host-runtime.ts`](../../scripts/build-host-runtime.ts) ([layout](../../apps/jan-host-runtime/README.md)) and are read from the `runtimeDirectory` config, or `JAN_HOST_RUNTIME_DIR` when it is empty; `pnpm run dev:desktop` sets that variable to `dist-host-runtime/` in the checkout. No installer ships them yet. A Jan with no archive for that computer says so on Connect. Targets: Linux x64 and arm64 with glibc 2.28 or newer, and macOS arm64 and x64.

A Jan someone installed on that computer by hand is never used or changed: Hosts keeps its own copy and home under `~/.jan/hosts-runtime/`. Remove that directory there to take it away.

## Projects and chats on connected computers

A connected SSH Host's projects appear in this window's sidebar beside this computer's, each tagged with that computer's name, and its chats open in normal tabs and run there. Remote in the new-project menu connects the computer and opens Jan's folder chooser on that computer's folders; the chosen folder becomes a project there. This Host signs in to the other Jan with the tunnel's token, which never leaves this process, and keeps one live connection to it that reconnects after 1, 2, 5 and then every 10 seconds while the tunnel runs. `state` reports `linkState` for each Host.

Ids from another computer reach this window as `<hostId>~<id>`; Host ids are UUIDs and Session and Workspace ids never contain `~`. A call naming such an id goes to that computer with the plain id, and its answer comes back qualified. The sidebar's project list, the Session control stream, the Session list and search, and chat activity events merge every connected computer's with this one's; approvals and questions from a chat on another computer come here to be answered. Settings, providers and plugins stay per computer. When a computer disconnects, its projects stay listed, dimmed and marked Offline, until it reconnects or the Host is removed; calls to them fail with an offline message. Chats on another computer are logged only there.

A chat running on another computer reads only chats on that computer with `read_chat`; a chat on this computer reads every connected computer's.

## Copy model providers to the other computer

Once an SSH Host is connected, its row asks the Jan there whether anybody set it up. A Jan with no provider added and no default model picked gets an offer under the row: each provider route this computer can give, ticked, and Copy. Copy sends the chosen routes, their keys and this computer's default model (when its route is among them) to that Jan's own `/jan-api/hosts` through the SSH tunnel, signed in with the tunnel's token, so keys never leave the encrypted session.

| Offered | Left out |
| --- | --- |
| A route the other Jan lacks, with its key when this computer has one | A route whose endpoint comes from a variable (`baseURLEnv`), such as the local llama.cpp worker: that address belongs to this computer |
| A key only (shown as "key only"), when both routes use the same fixed endpoint and credential reference and the key is missing there | A route that needs a key this computer does not have, or a route whose key destination cannot be verified |

The receiving Jan adds only what it lacks: a route with the same name, a key that already resolves there (stored or from its environment) and a default model someone picked all stay as they are, and the answer names what it kept. A route is sent as it was saved here; one with a `!!js` field goes as this computer evaluated it, because the expression would read the other computer's environment. Not now hides the offer until the next Connect.

The receiving Jan checks the route's endpoint and credential reference again before storing a key. If something changed or the destination cannot be verified, it does not store the key. Both Jans must support this check to copy keys.

## Bring MCP servers, skills and plugins to the other computer

A connected SSH Host's row has Bring setup. It asks the Jan there what it has and lists, by kind, what this computer can add: MCP servers, skills and plugin bundles it lacks, each with a checkbox. A filter by name shows once the list is long, and a group's checkbox ticks or clears only the rows the filter shows.

| Kind | How it travels | Left unticked |
| --- | --- | --- |
| MCP server | One merge into that Jan's `mcp-manager` settings | A server whose command, arguments or folder is a Windows path on this computer |
| Skill | The folders as one tar stream over SSH. The selected skill's top-level link is resolved, but nested links are never followed. Links that point outside the skill cannot be copied. `.git`, `node_modules`, `__pycache__` and `.venv` stay behind. | None |
| Plugin bundle | Enabled there when that Jan has it installed, otherwise installed from the same source | A bundle installed here from a local folder |

The other Jan keeps what it has: a server or skill with the same name is not offered, and tar never overwrites existing files. A plugin that fails is named in the row's note while the rest still land. That Jan's window shows new skills after a reload.

## Versions on the two sides

Each Jan serves its own page, so Open in browser always runs the Client that matches the Host on the other computer. Hosts depends only on what the two sides exchange before that:

| Exchange | Relied on | Older Jan |
| --- | --- | --- |
| Index without login | HTTP 401 with `jan web authentication required` | Releases before 2026-11-16 say `dsh web`; both are accepted. |
| Sign-in | `GET /connect?token=…&interactions=none` answers 302 with a cookie | Same since 2026-10-10. |
| Live connection | WebSocket `api/remote.mux` opens with that cookie | Same since 2026-08-22. |
| Projects in this window | That Jan's Gateway forwards calls (`registerForwarder`) | A Gateway without it still answers copies and folder browsing; its projects stay out of this window. |

An SSH entry saved by an earlier Hosts also carried a command, profile and port; they are ignored, and dropped when the entry is edited. The hosts files carry `"version": 1`; a file of another version is refused rather than rewritten.

Older saved IPv6 destinations lost their brackets. If an older entry used a custom port and the saved string is also a valid IPv6 address, edit the entry to put the address in brackets and the port after them.
