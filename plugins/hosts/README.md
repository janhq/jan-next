# Hosts

Hosts lists the other computers that run Jan and the devices that use this one. Open **Settings → Hosts**.

- **Other computers** saves a Jan by its address or over SSH. Test signs in with Jan's own login and opens its live connection, so a different web server on that port does not pass. Open opens that Jan's own page; its chats, files and tools stay on that computer. An address entry stores its login token in Jan's credential store, never in `hosts/connections.json`. An SSH entry runs `<command> --profile <profile> --no-open --port <port>` on the other computer and forwards that port to this one over loopback; the SSH key must already work in `BatchMode`.
- **Devices that reach this Jan** starts switched off. Turning it on opens a second listener on this computer's network address. Make code shows a QR code and a link that pairs exactly one device; each device gets a separate token, and Remove signs it out at once, including open chats. The devices file keeps only a hash of each device token. The owner's own login never leaves this computer.

A computer with no screen prints `jan hosts: pair a device at <link>` beside its `jan web:` line, once, when device access is on and no device is paired yet.

## Versions on the two sides

Each Jan serves its own page, so Open always runs the Client that matches the Host on the other computer. Hosts depends only on what the two sides exchange before that:

| Exchange | Relied on | Older Jan |
| --- | --- | --- |
| Index without login | HTTP 401 with `jan web authentication required` | Releases before 2026-11-16 say `dsh web`; both are accepted. |
| Sign-in | `GET /connect?token=…&interactions=none` answers 302 with a cookie | Same since 2026-10-10. |
| Live connection | WebSocket `api/remote.mux` opens with that cookie | Same since 2026-08-22. |
| SSH start | `<command> --profile <profile>` prints `jan web: <url>` | Older releases print `dsh web:`; both are read. A profile the other Jan lacks, such as `edge`, is reported as a missing profile; use `web`. |

An older Jan that opens a profile naming `jan-hosts` warns `entry "jan-hosts" not found` and starts without it. The hosts files carry `"version": 1`; a file of another version is refused rather than rewritten.
