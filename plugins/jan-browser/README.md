# Jan Browser

Jan Desktop controls the Chrome profile connected by the published [Jan Browser MCP extension](https://chromewebstore.google.com/detail/jan-browser-mcp/mkciifcjehgnpaigoiaakdgabbpfppal). It does not launch Chrome, install an extension, or start an MCP server.

## Connect Chrome

1. Install Jan Browser MCP in the Chrome profile you want to use. Pin it if you want its toolbar button visible.
2. In a Jan Desktop Session, ask Jan to open a page using Chrome and approve the browser tool. Jan starts the bridge on this first approved call. If Chrome has not connected yet, the call gives you the install link and connection instructions.
3. Open the Chrome extension popup. If it does not connect automatically, choose **Connect**. The default bridge port is `17389`. If a legacy Jan MCP server is already running, quit it or set the same unused port in the Jan Browser plugin and the Chrome extension.
4. Retry the browser tool once the extension says **Connected**. Jan can open an automation tab; to use a tab you already have open, choose **Set current tab for browser use** from the extension popup while on that tab.

The extension owns its automation group. Chrome stays open when Jan disconnects. One live Session can own the attached profile at a time. Jan will not silently move that Session to a different extension connection after a reconnect or profile change: end the previous Session activation and start a new one. Stop a Session before moving ownership to another. After an interrupted action, inspect Chrome before retrying; the published extension cannot cancel actions it already received.

Use the **Plugins** page to disable the Jan Browser row or edit its host configuration. `proactiveCapture` is off by default. When enabled, and only after the same live Session received a successful screenshot-bearing browser result, Jan can capture the registered page before a new turn using a model that accepts image input. The capture is recorded as Session context and can be sent to the selected model. The extension also automatically captures the resulting page after navigation and most input actions; no additional snapshot call is needed for those results. Keep sensitive tabs out of the automation group and disconnect when done.

## Tools

| Jan tool | Arguments | Chrome result |
|---|---|---|
| `browser_navigate` | `target: string`, `forceNewTabOpen?: boolean` | Open an HTTP(S) URL, bare domain, `back`, `forward`, or `new`. |
| `browser_search` | `query: string` | Open Google results in a new automation tab and return the rendered page. Jan's existing `web_search` remains separate. |
| `browser_snapshot` | `fullPage?: boolean`, `detail?: shorten \| all` | Accessibility tree, plain screenshot, ref overlay. |
| `browser_extract` | `fullPage?: boolean` | Full accessibility-tree text without including images in the result. |
| `browser_screenshot` | `fullPage?: boolean` | Plain screenshot only; viewport by default. |
| `browser_click` | `target: string` | Click a snapshot ref or viewport coordinates. |
| `browser_type` | `target: string`, `text?: string`, `clear?: boolean`, `submit?: boolean` | Type text and optional `<kbd>…</kbd>` keys. |
| `browser_scroll` | `direction: up \| down \| top \| bottom`, `amount?: number`, `target?: string` | Scroll the page or a referenced element. |
| `browser_tabs` | none | List tabs in the automation group. |
| `browser_tab_switch` | `tabId: integer` | Focus a tab returned by `browser_tabs`. |
| `browser_close_tabs` | none | Close every tab in the automation group, including manually assigned tabs. |

Ordinary browser tool calls go through Jan's existing approval and policy pipeline. Image-capable models receive persisted screenshot attachments; text-only models receive the accessibility text and a diagnostic when a returned image cannot be sent. A page can contain misleading instructions; a snapshot is page data, not authorization.

## Transport and trust boundary

The bridge listens only on `127.0.0.1`. A WebSocket upgrade must carry the published extension's `Origin` and a client-supplied profile ID. The origin check blocks ordinary web pages from connecting through Chrome, but it does not authenticate local peers: a process that can reach the loopback port can supply both values and impersonate the extension, including returning fake browser results. The profile ID is for routing, and echoing it in `ready` only completes the protocol handshake. Use the bridge only on a machine where you trust the local processes that can reach it. Otherwise, disable Jan Browser in **Plugins**.

The extension is installed directly from the Chrome Web Store and connects over WebSocket. Its popup lets users set the port, but Jan does not install the extension, register a native messaging host, or serve a pairing page. The bridge's HTTP `HEAD` probe only checks reachability. Jan v0.7.3 launched [`search-mcp-server@latest`](https://github.com/janhq/jan/blob/v0.7.3/src-tauri/src/core/mcp/constants.rs), whose legacy bridge could check an optional `t` query token. This plugin has no trusted way to deliver a per-launch token to the published extension, so it does not require one.

The bridge, schemas and tab behavior were implemented against the Store v0.14.4 bundle and [Jan Browser extension tag `0.14.4`](https://github.com/janhq/jan-browser-extension/tree/0.14.4) (Apache-2.0, commit `d59cf120001ec6990e9be567e5e534589a4ba7d2`). Jan sends `hello` and `profile_state`, waits for the extension's `ready`, sends `{kind: 'call', id, tool, params}`, and consumes matching `{kind: 'result', id, ok, content?, error?}` frames. Heartbeats use JSON `ping` and `pong`. No extension or legacy MCP server code ships in this package.
