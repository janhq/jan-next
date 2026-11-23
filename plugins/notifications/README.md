# Notifications

Jan Desktop shows a system notification when a chat finishes, stops with an error, or waits for your approval, plan review or answer. Scheduled runs notify the same way, so a run that ends while Jan sits in the tray still reaches you. Clicking a notification brings Jan back and opens that chat.

A chat that is open in a focused, visible window does not notify. Subagent chats do not notify; their parent chat does when it ends. A chat that fails while Jan is open but another chat is on screen also shows a corner message with **Open**.
A stopped turn does not send a task-finished notification.

Turn notifications on or off under **Settings › General › Desktop notifications**, with one switch each for finished, failed and waiting. All are on by default. The settings are the `jan-notifications` profile entry's `enabled`, `finished`, `failed` and `waiting` fields.

## Model experience

This plugin adds no tools, prompt text, or Session events. It uses live Session status and the recorded turn outcome and sends no model request.

## Known Limitations and Deferred Work

- Notification text does not say that a run was scheduled.
- Clicking a notification that Jan replaced or that the platform kept after Jan forgot its id (more than 64 newer notifications) only focuses the window.
