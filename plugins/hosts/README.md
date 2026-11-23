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

The gateway answers 403 to a request whose `Host` is not its own address and port, whose `Origin` is not its own origin, or that a browser marks `Sec-Fetch-Site: cross-site`, before it rewrites `Host` and `Origin` to loopback for this Jan. A page on another site, or one whose domain was rebound to this address, never reaches Jan through it.

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

Ids from another computer reach this window as `<hostId>~<id>`; Host ids are UUIDs and Session and Workspace ids never contain `~`. A call naming such an id goes to that computer with the plain id, and its answer comes back qualified. A file or image attached in the composer of a chat on another computer streams to that computer's upload route, so the receipt is staged where the chat runs. The sidebar's project list, the Session control stream, the Session list and search, and chat activity events merge every connected computer's with this one's; approvals and questions from a chat on another computer come here to be answered. Settings, providers and plugins stay per computer. When a computer disconnects, its projects stay listed, dimmed and marked Offline, until it reconnects or the Host is removed; calls and uploads to them fail with an offline message. Chats on another computer are logged only there.

This Host signs in to each other computer with `forward=local`, so that Jan answers from its own projects and chats only. Two computers connected to each other therefore list each other's items once, instead of passing lists and streams back and forth.

A chat running on another computer reads only chats on that computer with `read_chat`; a chat on this computer reads every connected computer's.

## Sync setup to another computer

In **Settings → Hosts**, connect to an SSH Host and choose **Sync setup…**. Jan compares the two setups without writing to the destination. Review the changes, then choose **Apply**. For each conflict, **Keep remote** is the default; choose **Use this computer** only for items you want to replace. New items that may contain credentials, including provider keys, are not selected by default. Identical and remote-only items are left untouched.

Sync covers portable model providers, provider keys, the default model, MCP servers, skills, and plugin bundles. It skips machine-specific entries, unreadable skills, and keys managed by the destination's environment. Chats, projects, downloaded models, and general preferences are outside this flow. Approved values travel through the authenticated SSH tunnel; the preview contains no key values. The receiving Jan only stores a provider key if every route that uses its reference has the same fixed endpoint as the sender.

After applying, check each item's result. If an item changed since review, choose **Review again** before deciding what to apply. If the connection dropped before Jan could confirm a result, review the destination before repeating the change. Some plugin changes need a restart.

## Versions on the two sides

Each Jan serves its own page, so Open in browser always runs the Client that matches the Host on the other computer. Hosts depends only on what the two sides exchange before that:

| Exchange | Relied on | Older Jan |
| --- | --- | --- |
| Index without login | HTTP 401 with `jan web authentication required` | Releases before 2026-11-16 say `dsh web`; both are accepted. |
| Sign-in | `GET /connect?token=…&interactions=none` answers 302 with a cookie | Same since 2026-10-10. |
| Live connection | WebSocket `api/remote.mux` opens with that cookie | Same since 2026-08-22. |
| Projects in this window | That Jan's Gateway forwards calls (`registerForwarder`) | A Gateway without it still answers compatible setup requests and folder browsing; its projects stay out of this window. |

This Jan still answers `setupState`, `receiveSetup`, and `customizationState` requests from older peers. New setup syncs use `syncPreview` and `syncApply` to review and apply changes on a connected SSH Host.

An SSH entry saved by an earlier Hosts also carried a command, profile and port; they are ignored, and dropped when the entry is edited. The hosts files carry `"version": 1`; a file of another version is refused rather than rewritten.

Older saved IPv6 destinations lost their brackets. If an older entry used a custom port and the saved string is also a valid IPv6 address, edit the entry to put the address in brackets and the port after them.
