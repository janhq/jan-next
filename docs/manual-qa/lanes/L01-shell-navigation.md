# L01: Sidebar, top bar, navigation, shortcuts, window

## Summary

The frame around everything: the sidebar rows, quick-create buttons, the chat list, Back and Forward, the account footer, keyboard shortcuts and the window chrome.

Needs: the seed. Port block 9410. Seed the chat list first: create five chats with the mock server so the list scrolls.

| ID | Via | Steps | Expect | Sev |
|---|---|---|---|---|
| L01-01 | any | Look at the sidebar top to bottom. | Rows in order: New Chat (Cmd+N), Search (Cmd+K), Projects, Artifacts, Plugins, More, then the Chats list, then the account footer. Every row has an icon of the same size and weight | P2 |
| L01-02 | any | Hover each row in turn. | Hover shows a light highlight, never a dark block. The same highlight is used on the selected row and on a hovered chat | P3 |
| L01-03 | any | Hover Projects, Artifacts and Plugins. | A `+` quick-create button fades in on the right of each row (New project, New artifact, Create plugin). It is invisible when not hovered and does not shift the row label | P2 |
| L01-04 | any | Click the `+` on Projects. | The new-project flow opens. Cancelling leaves nothing behind in the list | P1 |
| L01-05 | any | Click More. | A menu lists Automation tasks, Downloads, Presets, Presentations, each with an icon. The More row is aligned with the other rows | P2 |
| L01-06 | any | Open each More entry in turn. | Each opens its own page with a title. Going back returns to the previous page | P1 |
| L01-07 | any | Click New Chat, send a message, click another chat, click Back (top bar), click Forward. | Back returns to the previous chat or page, Forward undoes it. Buttons are disabled (dim) when there is nowhere to go | P1 |
| L01-08 | any | Press Alt+Left and Alt+Right. Press Cmd+[ and Cmd+] (macOS). | Same as the buttons in L01-07. Focus in the message box does not block them | P2 |
| L01-09 | any | Press Cmd+K. Type part of a chat title. | A search opens; matches appear as you type; Enter opens the top match; Escape closes it and returns focus | P1 |
| L01-10 | any | Press Cmd+N from inside a chat with an unsent draft. | A fresh chat opens. Going Back returns to the old chat with the draft still in the box | P0 |
| L01-11 | any | Click the sidebar toggle in the top bar twice. | The sidebar hides and returns at the same width, with the selected chat still highlighted | P2 |
| L01-12 | any | Drag the sidebar edge, if it is resizable. Relaunch. | The width is kept, or the edge does not move. No half state | P3 |
| L01-13 | any | Scroll the chat list with 30 chats. | Smooth scroll, the footer stays pinned, the title and traffic lights stay put, no row is clipped | P2 |
| L01-14 | any | Click the search and filter icons beside "Chats". | Search filters the list in place; the filter menu lists its options, each toggles and shows its state | P2 |
| L01-15 | any | Right-click a chat. | A menu offers at least rename, pin or favourite if present, and delete. Each does what it says. Delete asks first | P1 |
| L01-16 | any | Rename a chat to a very long title, then to an empty title. | A long title ends with an ellipsis, never pushes the time label. An empty title is refused or reverts, never saved blank | P2 |
| L01-17 | any | Look at the account footer. | One row: the settings icon, the account name and "Local" (or the signed-in name). Same height and hover as the nav rows | P2 |
| L01-18 | any | Click the footer. | A menu: Settings (Cmd+,), Language, Inference configuration, View changelog, Learn more, and Sign in with Tokamak when signed out | P1 |
| L01-19 | any | macOS: look at the traffic lights next to the sidebar title. | They are centred on the sidebar title line | P3 |
| L01-20 | any | Close the window with the red button. Reopen the app from the Dock. | The window returns on the same page. Closing with a running turn asks or stops it clearly (see L11-05) | P1 |
| L01-21 | any | Quit and relaunch. | Selected chat, scroll position of the list and sidebar visibility are as left | P1 |
| L01-22 | any | Press Tab repeatedly from the top of the window. | Focus visits the sidebar rows in visual order with a visible focus ring, then the main area. Enter activates the focused row | P2 |
