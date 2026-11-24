---
kind: upgrade-guide
description: "The tool-skill row lists skills in search mode by default, with descriptions shortened to 100 characters and a skill_search tool, and the desktop coding modes no longer send the Generative UI card guide in every request."
---

# The skill catalog defaults to search mode

## Change

The `@janhq/jan-tool-skill` row's `catalogMode` now defaults to `search`. The session skill catalog lists each skill with a description capped by the new `listedDescriptionMaxLength` key (default 100 characters) in place of `catalogDescriptionMaxLength` (500), and the row registers the `skill_search` tool. Skills named in `pinnedSkills` keep the longer cap. In `search` mode, `listedDescriptionMaxLength: 0` lists unpinned skills by name alone, which was the only form before.

The `@janhq/dsh-generative-ui` row gains `inlinePrompt` (`full`, `brief` or `off`; default `full`) and `inlinePromptByMode`, which overrides it by the id of the chat's current agent mode. The desktop bundle sets `off` for the `standard` and `ptc` modes, so those modes no longer receive the card guide in the system prompt. The `generative-ui` skill stays in their skill catalog and loads the guide on demand.

## Migration

1. To keep the complete catalog, set `catalogMode: full` on each `tool-skill` row, including the rows inside agent mode declarations.
2. A test or script that expects only the `skill` tool from a default `tool-skill` mount passes `catalogMode: full`, or expects `skill_search` as well.
3. To send the card guide in a coding mode again, set `inlinePromptByMode: { standard: full }` (or `brief`) on the `dsh-generative-ui` row in a profile patch.
4. Start a new chat and open the context meter: the Skills and System prompt rows show the smaller figures. Chats started earlier keep the catalog they already received until it changes.
