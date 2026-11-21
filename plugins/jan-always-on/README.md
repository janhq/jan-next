# Bots

Open **Bots** in the sidebar to create a persistent assistant or return to its chat. A bot belongs to one project, and sits above that project's ordinary chats. If you don't pick a project, Jan uses the default project and creates it on demand. A bot keeps the same chat for direct messages, routine work and replies to proactive updates. **New chat** while that bot is your active conversation, or `/new` in its chat, compacts older context instead of creating another chat.

You can also choose **Bots mode** from the agent-preset picker. From an existing project chat, this turns that chat into the new bot's canonical conversation without discarding its history or changing projects. From a new chat that has not yet opened a project session, choose the project in the bot form. This choice does not change the default mode for other chats.

Set a bot's name, role and description when you create it. Advanced settings contain its appearance, instructions, agent preset and model. Jan derives a default avatar from the name; customize, randomize or lock it without changing the bot's identity. Duplicate copies the profile and persona into a new bot in the same project, not its conversation, memory, routines or inbox. Delete removes the profile, persona, memory, inbox, outbox and scheduled routines; the previous conversation is kept in Archived chats, where it no longer operates as a bot.

- **Routines** are ordinary Scheduled tasks targeting the bot's canonical chat. Use **Manage in Scheduled** to edit timing, pause, resume, delete or view delivery history. Recurrences catch up with their most recent missed occurrence. A follow-up is delivered to the same conversation, with the checkpoint named by the original run.
- **Memory** shows the bot's local Markdown files. `instructions.md`, `index.md` and `reported.md` each contribute at most 4 KiB to its context. `notes/` and `progress/` are read on demand. Use pointers and short checkpoints rather than copies of source material.
- **Activity** shows stored queue and outbox history. Instruction changes require the exact text to be reviewed inline in the bot chat. **Allow once** applies only that text; **Reject** leaves the instructions unchanged. Proactive messages appear in the bot chat and Jan notifies at most once per minute per bot.

Background work runs only while Jan is open. Pause stops new background runs and interrupts the active background run without deleting the queue or pausing direct conversations. Resume lets queued work continue. The bot's preset chooses foreground capabilities, while routine runs use only the scoped memory, follow-up and notification tools. The bot's selected model receives the chosen instructions, memory and routine context just as it receives other chat context; select a local model if that data should stay on-device.

## Local data and migration

`$JAN_HOME/bots/registry.json` stores stable bot IDs, project and canonical Session IDs, profile settings, newest-message previews and unread state. New bots keep `queue.sqlite`, `memory/`, and a digest-addressed `persona-*.md` in `$JAN_HOME/bots/<id>/`; transcripts live in normal Session storage. Routines remain in Scheduled's Host store.

If an earlier installation had Always-on enabled or already has `$JAN_HOME/always-on`, Jan adopts it as a bot named **Jan** in the default project. Its queue and memory stay at their original paths, including paused state and in-flight approvals. Saved Scheduled rows keep timing and history while their destination changes to the canonical bot chat. Already-saved historical transcripts remain at their original Session locations; newly delivered work and decisions continue in the bot chat. A fresh profile does not create a bot until you ask.

## Avatar states

Avatars use the bot's color and shape and follow the system's reduced-motion preference. Activity takes precedence from the top of this table down.

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

Tool activity, the last run outcome and the latest delivery time are live values for the current app session. The Activity panel still shows stored history after restart.

Browser code in this plugin can `require.async('./client.avatar.js')`. `loadAvatarRenderer()` resolves to `mountBotAvatar(element, options)`, which returns `{ update(partial), destroy() }` and follows system reduced motion. `avatarAppearance(snapshot)` maps a bot's live state to an avatar pose and localized status.

## Model experience

| Tool | Use |
| --- | --- |
| `memory_read` | Read one approved, relative memory path. |
| `memory_write` | Replace a short Markdown file. Changing `instructions.md` requires one-time user approval. |
| `set_follow_up` | Schedule one later run and name the saved `progress/` checkpoint it must read. |
| `send` | Queue a meaningful update by a stable key. Use normal model output for anything that should not notify the user. |

Event intake, background execution and notification receipts use `@janhq/dsh-superagent/queue` without mounting its GitHub router. Bot-to-bot messaging, group chats, messaging channels, remote-host bots and per-bot voice are not part of this release.

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
