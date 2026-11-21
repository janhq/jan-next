# Bots

Bots is an opt-in Jan Desktop feature for running background tasks. Open **More**, choose **Bots**, select **Enable**, and use **Timers** to tell Jan what to do and when. Jan must be open for a run to start. Pause stops new runs and interrupts the active run; resume lets queued work continue. A recurring timer catches up with its most recent missed occurrence, not every missed occurrence.

- **Events** shows the durable inbox and any proposed change to background instructions. Allow once applies only the exact text shown. Reject does not apply it. Jan continues the saved session after either answer.
- **Timers** lists tasks created in Bots from Jan's existing Scheduled store. Open **Manage in Scheduled** to edit, pause, resume, delete, or view delivery records. Follow-ups start a new transcript and read the checkpoint named by the prior run.
- **Memory** reads local Markdown files. `instructions.md`, `index.md` and `reported.md` each contribute at most 4 KiB to a run. Read `notes/` and `progress/` on demand. Use pointers and short checkpoints rather than copying source material.
- **Messages** shows the durable outbox. Significant messages appear as Jan notifications, at most one per minute. Replying to a delivered message continues its original session.

The durable inbox and outbox live in `$JAN_HOME/always-on/queue.sqlite`. Memory lives beside it in `memory/`; all timers are regular Scheduled tasks. The plugin uses the current default model, workspace-write permissions with approval, and a scoped tool set; shell, web and general file tools are not available to background runs. A remote model receives the selected memory and task context just as it would in an ordinary Jan session. Choose a local model if that data should stay on-device.

## Avatar states

The avatar next to the status line uses Jan's current accent and follows the system's reduced-motion preference. Bot activity takes precedence from the top of this table down.

| Bots activity | Avatar |
| --- | --- |
| Off or paused | Idle, dimmed and still |
| Awaiting **Allow once** or **Reject** | Blocked, neutral |
| Running a background tool | Working, neutral |
| Active outside tool calls, including model streaming | Thinking, neutral |
| Background event queued | Waiting, neutral |
| Latest run failed | Blocked, neutral until another run supersedes it |
| Just delivered a notification | Done, happy for four seconds, then idle |
| No active work, including a completed run without a notification | Idle, neutral |

Tool activity, the last run outcome and the latest delivery time are live values for the current app session. The durable Events and Messages tabs still show stored history after restart.

Browser code in this plugin can `require.async('./client.avatar.js')`. Its `loadAvatarRenderer()` resolves to `mountBotAvatar(element, { definition, color, state, mood, label })`, which returns `{ update(partial), destroy() }` and defaults to system reduced motion. Pass a new pose to `update` and call `destroy` when the host leaves the page. `definition` is the default chat-bubble artwork; `avatarAppearance(snapshot)` returns `{ state, mood, still, labelKey }` from the current background runner's snapshot. Other bot surfaces can supply their own definition and map their own activity without using the Events or Timers page.

## Model experience

| Tool | Use |
| --- | --- |
| `memory_read` | Read one approved, relative memory path. |
| `memory_write` | Replace a short Markdown file. Changing `instructions.md` requires one-time user approval. |
| `set_follow_up` | Schedule one later run and name the saved `progress/` checkpoint it must read. |
| `send` | Queue a meaningful update by a stable key. Use normal model output for anything that should not notify the user. |

The opt-in profile setting only opens the persistent state after the user enables it. Event intake, single-slot work, idempotent session delivery, and notification receipts use `@janhq/dsh-superagent/queue` without running the GitHub router. External webhook ingress, messaging channels and automatic memory curation are not part of Bots.

## Updating the avatar renderer

The desktop browser loader can load package-local factory chunks but cannot resolve bare npm ESM imports. This source-shipped plugin vendors the zero-dependency [open-bot-avatar 0.3.0](https://github.com/DominikScholz/open-bot-avatar) renderer as `client.open-bot-avatar.js` with its [MIT notice](LICENSE.open-bot-avatar). No CDN or package install is needed at runtime.

To regenerate from the repository root, use the published tarball and the workspace's esbuild (0.28.2 for this revision):

```sh
avatar=$(mktemp -d)
curl -fsSL https://registry.npmjs.org/open-bot-avatar/-/open-bot-avatar-0.3.0.tgz -o "$avatar/avatar.tgz"
test "$(openssl dgst -sha512 -binary "$avatar/avatar.tgz" | openssl base64 -A)" = \
  '3P0o8eiClHHiLr7lIFZE/WxUtqHLjVb0xQ0PqYzA48XG/oQlWyeIdcY0egK6H8AgFuoY1aKVhc8QKSaj4z5ZOw==' && \
  tar -xf "$avatar/avatar.tgz" -C "$avatar"
cmp "$avatar/package/LICENSE" plugins/jan-always-on/LICENSE.open-bot-avatar
printf '%s\n' "export { mountAvatar } from '$avatar/package/dist/dom/index.js'" \
  "export { renderAvatarSvg, validateAvatar } from '$avatar/package/dist/index.js'" | \
  ./node_modules/.bin/esbuild --bundle --minify --format=iife --global-name=avatarRuntime \
  --banner:js='/* Generated from open-bot-avatar 0.3.0 (MIT). See LICENSE.open-bot-avatar. */
window.__ModuleLoader__.load({ id: "@janhq/jan-always-on", chunk: "client.open-bot-avatar.js", factory() {' \
  --footer:js='return avatarRuntime;
} });' --outfile=plugins/jan-always-on/client.open-bot-avatar.js
rm -rf "$avatar"
```
