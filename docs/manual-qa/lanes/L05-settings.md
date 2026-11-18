# L05: Settings

## Summary

Every Settings section: General, Appearance, Models, Built-in plugins, Agent presets, MCP Servers, Skills, Presentations. Open them from the footer menu (Settings, Cmd+,). Each section is checked for icon, layout, controls that hold state, and persistence.

Needs: the seed. Port block 9450.

| ID | Via | Steps | Expect | Sev |
|---|---|---|---|---|
| L05-01 | any | Press Cmd+, | Settings opens on the last used section, or General. Escape or the close button closes it and returns focus to where it was | P1 |
| L05-02 | any | Read the section list. | Every section has its own icon (no two share the gear), a clear name, and the selected one is marked | P2 |
| L05-03 | any | Open each section in turn without changing anything. | Each loads within 2 seconds with no raw keys, no empty white area, no console-style text | P1 |
| L05-04 | any | General: change each control once. | Each control gives feedback (the control moves, a saved cue shows), and each survives close, reopen and relaunch | P0 |
| L05-05 | any | Appearance: change the accent colour, the theme (light, dark, system) and the user-bubble style. | The window repaints at once, including accent fills, with no half-painted element. The choices survive relaunch | P1 |
| L05-06 | any | Appearance: choose "System" theme, then change macOS appearance. | The app follows within a few seconds | P2 |
| L05-07 | any | Models: open the page. | Local model list, provider list, fallback chain card and context cards are present, each with a heading | P1 |
| L05-08 | any | Models: add a provider with a bad key and Test it. | A clear failure (bad key) in plain words; nothing saved as working | P1 |
| L05-09 | any | Models: add a provider with a good key (the mock server), then remove it. | It appears in the picker after adding and disappears after removing. A chat that used it still opens | P1 |
| L05-10 | any | Built-in plugins: open it. | Tabs: Plugin list, Translations, Import from Jan. Each lists its content. The search box filters | P1 |
| L05-11 | any | Built-in plugins: toggle one plugin off and on. | The switch shows a spinner on its own row, then the new state. If a restart is needed the row says so. The page is not greyed out for more than a second or two | P1 |
| L05-12 | any | Agent presets: open, create a preset, edit its name, delete it. | Each step works and survives relaunch. The editor keeps the text if you click away and return | P1 |
| L05-13 | any | MCP Servers: open. | The servers list shows each with an enable switch and its state. Disabled servers do not start | P1 |
| L05-14 | any | MCP Servers: open "Available tools" on a server. | Each tool shows name, description and arguments, not only a bare name | P2 |
| L05-15 | any | MCP Servers: add a server with an empty name, then with a name containing spaces and capitals. | Empty is refused with a message. Any other valid name is accepted | P2 |
| L05-16 | any | Skills: open. | Each skill can be toggled, searched, and its source is shown (bundled, user). There is a way to add one | P1 |
| L05-17 | any | Skills: toggle a skill off, start a chat, ask for something that skill covers. | The agent does not use the disabled skill | P1 |
| L05-18 | any | Presentations: open. | The section loads and shows presentation settings or an empty state, no error | P2 |
| L05-19 | any | Resize the window to 900 x 600 with Settings open. | The section list and the content stay usable; nothing is cut off | P2 |
| L05-20 | any | Scroll a long section (Models) to the bottom and back. | Scroll is smooth, headings do not overlap, no layout shift on load | P3 |
| L05-21 | any | Open Settings, change a value, close with Escape before any "save". | Either the value is already saved (no save button) or the app asks. Never silently lost | P0 |
| L05-22 | any | Open Settings, quit with Cmd+Q, relaunch. | App opens normally; changed values are kept | P1 |
