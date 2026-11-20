# Desktop computer use

Jan Desktop can inspect and act on native app windows with the [agent-desktop CLI](https://github.com/vercel-labs/agent-desktop). Open the app you want Jan to use, then name it in a Jan Desktop chat. The plugin is mounted only in the desktop bundle. To turn off its tools, set `disabled: true` on the `jan-agent-desktop` row in your profile's `cordis.patch.yml` and restart Jan. Remove the override and restart again to re-enable it.

## Setup and permissions

Jan Desktop ships agent-desktop 1.0.2 in `<resources>/runtime/agent-desktop` and passes its path to the Host as `JAN_AGENT_DESKTOP`, so computer use works without a separate install. That bundled executable is tried first. An unpackaged development build uses `JAN_AGENT_DESKTOP` when set, then looks on its `PATH` and checks `/opt/homebrew/bin` on macOS. On Windows it runs `agent-desktop.exe` or the native executable from the official global npm installation, without invoking the `.cmd` shim. Restart Jan after changing its environment.

On macOS, enable Accessibility for the app that launches the executable. Window screenshots also require Screen Recording. If access is denied, run `agent-desktop permissions --guide` to see the settings and grant access yourself. Jan never requests or changes system permissions. Use an interactive graphical session on Windows and Linux, and consult `agent-desktop skills get platform` for platform requirements.

Each action and screenshot asks for approval. In a chat set to Full access, which never asks, they run without a prompt. Allow all in this chat on the approval card switches the chat to Full access.

## Tools

| Tool | What it returns |
|---|---|
| `desktop_list` | Running apps or visible windows. Filter by application when known. |
| `desktop_snapshot` | The accessibility tree for one window or a qualified subtree. Defaults to compact and interactive; use `skeleton` to locate a subtree or turn off `interactive_only` to read static labels. |
| `desktop_find` | Up to 20 matching nodes for role, name, or text in a window or subtree. |
| `desktop_act` | The delivery and retry disposition after one approved semantic click, value write, text insertion, selection, check, uncheck, or scroll. |
| `desktop_wait` | Whether an existing qualified element ref satisfies the requested condition within the deadline. |
| `desktop_screenshot` | One approved PNG window capture as a durable attachment. It requires an image-capable model, and captures beyond 4 MiB or the deployment's image limits are refused. |

Select a window ID, inspect its tree, and use the full snapshot-qualified ref, for example `@s8f3k2p9:e8`. Each live Jan Session has a private temporary ref store; refs expire at Session close or plugin reload and can become stale when the native UI changes. If a ref goes stale, take a new snapshot and choose a fresh ref. `delivered_unverified` or unknown delivery does not mean it is safe to retry: observe the current app state first. Even verified delivery does not guarantee an app-level effect such as saving a document.

Jan's approval prompt authorizes a single action or screenshot. Headless semantic operations never request physical input, focus changes, or clipboard access. Unsupported semantic actions fail rather than falling back to physical input. Accessibility trees, window titles and screenshots can contain private content. The requested results enter the Session and may be sent to the selected model; keep sensitive windows out of the requested scope. Jan treats native content as data, not instructions.

## Model Experience

### Desktop tool calls and results

#### What the model sees

The desktop bundle advertises the six tools above. Observations return size-bounded JSON scoped to the request, actions return a delivery disposition with verification guidance, and screenshots return an image attachment rather than base64 text.

#### Token effect

An additive fixed schema cost and conditional per-call results. Observation JSON is capped at 24 KiB. Screenshots follow Jan's image admission and model adaptation.

#### KV Cache effect

Tool schemas are prefix-stable within the same composition. Tool results append to the Session transcript.

## Known Limitations and Deferred Work

- Native accessibility support varies by app and OS. On Windows, use `set-value` instead of `type` for semantic text entry. On Linux, scroll has no headless wheel path, and the CLI cannot capture individual windows on Wayland. Jan does not fall back to physical input or display-wide capture.
- Installation, permission grants, launch, window management, and display-wide capture are outside this plugin.
