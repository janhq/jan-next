# L02: Chat core

## Summary

Sending, streaming, stopping, retrying, attachments, slash commands, the composer, and what a conversation looks like while it runs and after it fails.

Needs: the seed and the lane's mock server. Port block 9420. Start the server with `--sequence success --repeat-last` unless a case says otherwise. Model: `qa-mock / mock-model`.

| ID | Via | Steps | Expect | Sev |
|---|---|---|---|---|
| L02-01 | stub | On a new chat type "hello" and press Enter. | The message appears at once, a running indicator with a clock shows, text streams, the indicator stops at the end, the chat is titled in the sidebar | P0 |
| L02-02 | stub | Type a message, press Shift+Enter twice, type more, press Enter. | Line breaks are kept in the sent message exactly | P1 |
| L02-03 | stub | Paste 3000 words, send. | The composer grows then scrolls inside itself, the page does not jump, the message renders in full | P2 |
| L02-04 | stub | Restart the server with `--sequence slow_success --repeat-last`. Send, then press the stop button mid-stream. | Streaming stops within 2 seconds, the partial text stays, the send button returns, the next message works | P0 |
| L02-05 | stub | Press Escape while a turn runs. | Same as stop, or nothing if Escape is not bound. Never a half state | P2 |
| L02-06 | stub | Send while a turn is still running. | The message is queued or blocked with a visible reason. It is not silently dropped | P1 |
| L02-07 | stub | Restart the server with `--sequence server_error,success`. Send. | The failure is shown in plain words with a Retry action. Retry runs the turn and succeeds. The composer draft is not touched by Retry | P0 |
| L02-08 | stub | Type an unsent draft "keep me", then click Retry on a failed turn. | The draft "keep me" is still in the box after the retry | P0 |
| L02-09 | stub | Server `rate_limit,success`. Send. | The app retries by itself or says it is waiting. No JSON or status code is shown raw | P1 |
| L02-10 | stub | Server `auth_error`. Send. | A plain message that the key was refused with a next step (open Settings, Models). No raw provider JSON | P1 |
| L02-11 | stub | Server `malformed_json`. Send. | A plain failure, a working Retry, and the chat stays usable | P1 |
| L02-12 | stub | Server `stall`. Send and wait 60 seconds. | The running clock keeps counting, Stop works, and nothing says "done". After Stop the next send works | P1 |
| L02-13 | stub | Server `max_tokens`. Send. | The turn ends with a notice that the reply was cut off and a way to continue | P2 |
| L02-14 | stub | Server `reasoning_success`. Send. | Reasoning is shown in its own collapsible block, collapsed or expanded as the setting says, separate from the answer | P2 |
| L02-15 | stub | Server `tool_call_success`. Send. | A tool call card appears with the tool name and arguments, a result, and the final answer under it. Expanding and collapsing works | P1 |
| L02-16 | any | Type `/`. | A command list opens with a description under each name. Arrow keys move, Enter picks, Escape closes | P1 |
| L02-17 | any | Type `@`. | Files and chats can be mentioned. Picking one inserts a visible chip. Backspace removes the whole chip | P2 |
| L02-18 | any | Click the `+` in the composer. | Menu: File, Goal, Plan, Feedback, Compact, Permission, Model, Export, each with a one-line description | P2 |
| L02-19 | any | Attach a 2 MB text file with `+` > File, send. | A chip shows name and size, the message sends with it, and the sent message shows the file | P1 |
| L02-20 | any | Attach an image, send to `qa-mock` (text only). | The picker warns before sending that this model cannot read images, with a way to pick another model. The send is not silently lossy | P1 |
| L02-21 | any | Drag a file from Finder onto the composer. | Same as L02-19. A drop target is visible while dragging | P2 |
| L02-22 | any | Paste an image from the clipboard. | An image chip appears | P2 |
| L02-23 | any | Click the Permission control under the composer (shows "Workspace Write"). | A list of presets with a one-line meaning each. The choice is kept for the chat | P1 |
| L02-24 | stub | Send ten messages, scroll up, then send another. | The view jumps to the bottom only if you were at the bottom; otherwise a "new message" cue shows | P2 |
| L02-25 | stub | Select text in a reply and copy. Click the copy control on a reply and a code block. | Plain text copies; the code block copies exactly its content | P2 |
| L02-26 | stub | Edit a sent user message if the UI allows it. | The reply is regenerated from the edit, the old branch is kept or clearly replaced | P1 |
| L02-27 | stub | Delete the chat while a turn is running. | The turn stops, the chat disappears, no error toast loop | P1 |
| L02-28 | stub | Send "hello", quit during the stream, relaunch. | The chat shows the partial text with a clear "interrupted" state and a way to continue. Nothing duplicated | P0 |
| L02-29 | stub | Open the same chat after relaunch and scroll to the top. | The whole history is there in order, with times | P1 |
| L02-30 | any | Export from `+` > Export. | A ZIP is saved; opening it shows a readable session log. The app says where it saved it | P2 |
| L02-31 | stub | macOS: add and select the Vietnamese input source (System Settings > Keyboard > Input Sources, Vietnamese, VNI or Telex). Type "where is the bird" and press Enter once, with no space after the last word. Repeat with the ABC input source. | Both times the first Enter sends "where is the bird" as one line. The composer never gains an empty second line and never needs a second Enter. Windows and Linux: same with the system Vietnamese input method if one is installed, otherwise record N/A | P0 |
| L02-32 | stub | Switch to a candidate input method (Chinese Pinyin or Japanese Romaji). Type "nihao" (or "konnichiha") so candidates show, press Enter to pick, then press Enter again. | The first Enter only commits the text into the composer; nothing is sent and no line break is added. The second Enter sends the committed text | P0 |
