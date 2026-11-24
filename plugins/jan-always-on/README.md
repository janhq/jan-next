# Bots

Open **Bots** in the sidebar to create a persistent assistant or return to its chat. A bot belongs to one project, and sits above that project's ordinary chats. If you don't pick a project, Jan uses the default project and creates it on demand. A bot keeps the same chat for direct messages, routine work and replies to proactive updates. **New chat** in the sidebar always opens an ordinary chat, even while a bot is your active conversation. To compact a bot's older context instead, use `/new` in its chat or **New chat** in its details.

You can also choose **Bots mode** from the agent-preset picker. From an existing project chat, this turns that chat into the new bot's canonical conversation without discarding its history or changing projects. From a new chat that has not yet opened a project session, choose the project in the bot form. This choice does not change the default mode for other chats.

Set a bot's name and role, then choose an **Agent** from its project or the global catalog. Choose **New agent from this bot** to create a global agent with its own description, model and instructions. Editing those fields updates the shared agent; for a read-only agent, choose **Copy to Jan** first. The bot's mode and appearance are under **Advanced**. Duplicate starts a new chat in the same project and references the same agent without copying the original chat, memory, routines or inbox. Delete removes the bot's memory, inbox, outbox and routines but keeps the agent and moves its conversation to Archived chats.

**Create bot** first offers templates: Chief of Staff, News Briefing, Repo Triage, Bug Reproducer, Competitor Watch, Support Triage, Weekly Status and Study Coach, or **Start from scratch**. A template fills the form with a name, role, avatar, a new global agent's description and instructions, and, for watchers, an empty source row to complete. Everything stays editable before you create the bot. On creation, a template's routines are added to Scheduled with localized titles in your time zone (UTC if Jan cannot read it). If a routine cannot be added, the bot is still created and Jan says to add it in Scheduled. Nothing stays linked to the template afterwards. Template instructions are written for the model in English, ask for missing setup in the first conversation, and never act outside the chat without your yes. The catalog lives in [templates.mjs](templates.mjs).

- **Routines** are ordinary Scheduled tasks targeting the bot's canonical chat. Use **Manage in Scheduled** to edit timing, pause, resume, delete or view delivery history. Recurrences catch up with their most recent missed occurrence. A follow-up is delivered to the same conversation, with the checkpoint named by the original run.
- **Memory** shows the bot's local Markdown files. `instructions.md`, `index.md` and `reported.md` each contribute at most 4 KiB to its context. `notes/` and `progress/` are read on demand. Use pointers and short checkpoints rather than copies of source material.
- **Activity** shows stored queue and outbox history. Instruction changes require the exact text to be reviewed inline in the bot chat. **Allow once** applies only that text; **Reject** leaves the instructions unchanged. Proactive messages appear in the bot chat and Jan notifies at most once per minute per bot.
- **Watch** polls up to 8 GitHub repositories, Slack channels or Discord channels on the Host and queues each new item for the bot, without calling the model on a quiet check. When Jan has a Tokamak account or `TOKAMAK_API_KEY` and the bot has a role or its agent has a description, Jev (Tokamak's System One classifier) first scores each new item against them. Scores below 0.2 are skipped, so a check that brings only unrelated items starts no run. The source card shows how many items were skipped. Without Tokamak, or when Jev fails, times out after 3 seconds or answers something unexpected, every item reaches the bot. Jev receives the bot's name and role, its agent's description and each item's text.

Background work runs only while Jan is open. Pause stops new background runs and interrupts the active background run without deleting the queue or pausing direct conversations. Resume lets queued work continue. The bot's preset chooses foreground capabilities, while routine runs use only the scoped memory, follow-up and notification tools. When the bot's chat has Full access, routine runs can also use Jan's web browser and desktop tools; without it they cannot, because nobody is there to answer approval prompts. The bot's selected model receives the chosen instructions, memory and routine context just as it receives other chat context; select a local model if that data should stay on-device.

## Local data and migration

`$JAN_HOME/bots/registry.json` stores bot IDs, project and canonical Session IDs, agent references, bot settings, newest-message previews and unread state. Each bot keeps `queue.sqlite` and `memory/` in `$JAN_HOME/bots/<id>/`. Transcripts live in normal Session storage, and routines remain in Scheduled's Host store. Jan upgrades v1 registries by moving each bot's description, model and persona into a global Markdown agent under `$JAN_HOME/agents/`, then removing the old persona files after the v2 registry is saved. If saving an agent fails, Jan keeps the v1 registry and retries on a later open.

If an earlier installation had Always-on enabled or already has `$JAN_HOME/always-on`, Jan adopts it as a bot named **Jan** in the default project. Its queue and memory stay at their original paths, including paused state and in-flight approvals. Saved Scheduled rows keep timing and history while their destination changes to the canonical bot chat. Already-saved historical transcripts remain at their original Session locations; newly delivered work and decisions continue in the bot chat. A fresh profile does not create a bot until you ask.

Choose **Import a bot** or **Settings -> Import -> AI app export** to bring bots from a supported export into the default project. Jan creates a global agent and a fresh chat for each new bot and keeps existing bots. The beginning of imported instructions is read automatically from bot memory's `instructions.md`. `index.md` points to any overflow and to imported memories and facts under `notes/`, which the bot can read on demand. Valid cron routines use their imported time zone and target the new chat. Paused routines remain paused; if Jan cannot pause or remove a new routine, it keeps the bot paused and reports which routine to check in Scheduled. See [Legacy import](../legacy-import/README.md#ai-app-export) for skills, MCP servers, and settings that do not transfer.

## Avatar states

Avatars use the bot's color and shape and follow the system's reduced-motion preference. Activity takes precedence from the top of this table down.

The **Bots mode** picker row shows up to four avatars from the Bots roster, ordered by latest chat activity or creation time for a bot with no activity. If there are no bots, it shows the four built-in shapes. Opening the picker mounts the lineup; closing it stops animation and pointer tracking. Reduced motion keeps the silhouettes still while preserving happy eyes on hover and keyboard focus.

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
