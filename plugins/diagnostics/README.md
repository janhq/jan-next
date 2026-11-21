# Diagnostics

Helps a person report a problem with Jan without digging for files.

- **On a failed chat:** the failure card gets **Copy details** and **Open logs**, through the `conversation.chat.turn-error-actions` slot of `ui-chat`. A sign-out the person chose shows neither.
- **Settings > About:** the Jan version, the system, the log folder, and **Copy details**, **Open logs**, **Save report** and **Send diagnostics**. Send diagnostics is a disabled placeholder: nothing is ever sent.

## The report

Plain text with the Jan version, system and memory, plugins that failed to start, the failure the person reported from, the last 20 failed turns since Jan started, and the end of `<JAN_HOME>/logs/jan.log` (up to 200 lines, 64 KiB). Before it leaves the Host, every line is redacted:

- the Jan folder is written `<JAN_HOME>` and the home folder `~`;
- provider keys (`sk-`, `ghp_`, `github_pat_`, `xoxb-`, `AKIA`, `AIza`), JWTs, `Bearer` tokens, credentials in URLs, secret query parameters and `key=value` / `"key": "value"` pairs named like a password, token, key, cookie or session id are replaced with `<redacted>`;
- email addresses become `<email>`.

**Save report** writes `diagnostics-<UTC time>.txt` to `<JAN_HOME>/logs` and shows it in the file manager.

## Logs

Each failed turn is logged once as a warning (`turn <n> failed in chat <id>: <code> <message>`). Jan Theme's startup health writes warnings and errors to `<JAN_HOME>/logs/jan.log`, so the failure sits beside its context. The desktop app's crash reports live in the system logs folder (on macOS `~/Library/Logs/Jan`), not here.

**Open logs** and **Save report** open the folder through `@janhq/jan-native-command`: Finder on macOS, Explorer on Windows, the default file manager on Linux. On a Linux Host with no display, Open logs is disabled and the path is shown instead.

## Mounting

A row in `plugins/desktop-app/cordis.patch.yml`; the installer packs `plugins/diagnostics`. Removing the row removes the buttons and the About section; the failure card returns to its stock look. Host work at start: one event listener and one route.
