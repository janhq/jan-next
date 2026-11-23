# Web browser

Jan Desktop can browse the web in its own browser with the [agent-browser CLI](https://github.com/vercel-labs/agent-browser). Ask in a chat or bot to open a page, read it, fill a form or capture it. The plugin is mounted only in the desktop bundle. To turn off its tools, set `disabled: true` on the `jan-agent-browser` row in your profile's `cordis.patch.yml` and restart Jan.

## Setup

Install agent-browser and its browser (`agent-browser install`), then restart Jan. Jan uses `JAN_AGENT_BROWSER` when set, then looks on its `PATH` and checks `/opt/homebrew/bin` on macOS. On Windows it runs `agent-browser.exe` or the native executable from the official global npm installation, without invoking the `.cmd` shim. Run `agent-browser doctor` if Jan reports an invalid result.

Jan runs agent-browser with an empty config file and without `AGENT_BROWSER_*` variables, so your own agent-browser defaults (file access, extensions, proxies, cloud providers) do not apply to Jan's browser.

## Sessions and sign-ins

Each live Jan chat or bot gets its own browser session, which closes with the chat. Cookies and storage are saved under one shared name, so a site you signed in to from one chat stays signed in for the others and after a restart. To sign in yourself, ask Jan to open the page with a visible window; the browser restarts when the window mode changes. Anything signed in there is reachable by every Jan chat and bot that uses these tools.

Opening a page, acting on it and capturing it ask for approval unless the chat has Full access. Reading the page, waiting, listing tabs and closing the browser do not.

## Tools

| Tool | What it does |
|---|---|
| `web_open` | Opens an http or https address without embedded credentials, optionally in a visible window. |
| `web_snapshot` | Returns the page's accessibility tree with refs such as `@e3`, interactive elements by default, optionally scoped by a CSS selector. |
| `web_act` | Clicks, fills, types, selects, checks, unchecks, hovers, presses a key or scrolls, then asks the model to verify with a fresh snapshot. |
| `web_read` | Returns the title, address, or one element's text or form value. |
| `web_wait` | Waits for an element, or a fixed time up to 20 seconds. |
| `web_tabs` | Lists tabs or switches to one. |
| `web_screenshot` | Captures the page as a PNG attachment. It requires an image-capable model and refuses images over 4 MiB. |
| `web_close` | Closes the browser and keeps sign-ins. |

Refs come from the latest snapshot and go stale when the page changes; a stale ref returns an error that asks for a fresh snapshot. An action whose result is unknown is never retried automatically. Each command reaches agent-browser as one JSON batch entry on stdin, so model-supplied text is never read as a command-line switch.

## Model Experience

### Web tool calls and results

#### What the model sees

Eight tools. Page data is returned as JSON labeled as untrusted page data, not instructions, and capped at 24 KiB; actions return a delivery summary; screenshots return an image attachment.

#### Token effect

An additive fixed schema cost and conditional per-call results bounded as above.

#### KV Cache effect

Tool schemas are prefix-stable within the same composition. Tool results append to the Session transcript.

## Known Limitations

- Calls from one chat run one at a time against its browser.
- Bot background routines can use these tools only when the bot's chat has Full access.
- Jan Desktop does not bundle agent-browser yet.
