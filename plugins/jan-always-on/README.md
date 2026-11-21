# Bots

Bots is an opt-in Jan Desktop feature for running background tasks. Open **More**, choose **Bots**, select **Enable**, and use **Timers** to tell Jan what to do and when. Jan must be open for a run to start. Pause stops new runs and interrupts the active run; resume lets queued work continue. A recurring timer catches up with its most recent missed occurrence, not every missed occurrence.

- **Events** shows the durable inbox and any proposed change to background instructions. Allow once applies only the exact text shown. Reject does not apply it. Jan continues the saved session after either answer.
- **Timers** lists tasks created in Bots from Jan's existing Scheduled store. Open **Manage in Scheduled** to edit, pause, resume, delete, or view delivery records. Follow-ups start a new transcript and read the checkpoint named by the prior run.
- **Memory** reads local Markdown files. `instructions.md`, `index.md` and `reported.md` each contribute at most 4 KiB to a run. Read `notes/` and `progress/` on demand. Use pointers and short checkpoints rather than copying source material.
- **Messages** shows the durable outbox. Significant messages appear as Jan notifications, at most one per minute. Replying to a delivered message continues its original session.

The durable inbox and outbox live in `$JAN_HOME/always-on/queue.sqlite`. Memory lives beside it in `memory/`; all timers are regular Scheduled tasks. The plugin uses the current default model, workspace-write permissions with approval, and a scoped tool set; shell, web and general file tools are not available to background runs. A remote model receives the selected memory and task context just as it would in an ordinary Jan session. Choose a local model if that data should stay on-device.

## Model experience

| Tool | Use |
| --- | --- |
| `memory_read` | Read one approved, relative memory path. |
| `memory_write` | Replace a short Markdown file. Changing `instructions.md` requires one-time user approval. |
| `set_follow_up` | Schedule one later run and name the saved `progress/` checkpoint it must read. |
| `send` | Queue a meaningful update by a stable key. Use normal model output for anything that should not notify the user. |

The opt-in profile setting only opens the persistent state after the user enables it. Event intake, single-slot work, idempotent session delivery, and notification receipts use `@janhq/dsh-superagent/queue` without running the GitHub router. External webhook ingress, messaging channels and automatic memory curation are not part of Bots.
