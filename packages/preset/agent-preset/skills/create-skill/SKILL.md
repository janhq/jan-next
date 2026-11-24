---
name: create-skill
description: Use when the user asks Jan to create, write, update, or fix a skill (reusable instructions loaded on demand or with /name), or to save a workflow, checklist, or writing style from this conversation so later chats can reuse it.
---

# Create a Jan skill

A skill is a folder holding `SKILL.md`: YAML frontmatter, then Markdown instructions. Jan shows every skill's `name` and `description` to the agent, loads the body only when a request matches the description, and loads it at once when a message contains `/<name>`. New and edited skills reach the next message without a restart.

## Decide what the skill does

1. Ask only what the conversation has not answered: the task, the requests that should trigger it, and what a good result looks like. When the user asks to save something just done, reuse that work's steps and the corrections the user made along the way.
2. One skill, one job. When a skill in the catalog almost covers the request, change that skill instead of adding a near-duplicate.
3. A skill holds instructions. When the request needs a new tool, page, panel, or connection to a service, load `create-plugin` or `create-connector` instead.

## Write SKILL.md

```markdown
---
name: weekly-report
description: Use when the user asks for a weekly status report, a summary of this week's work, or a Friday update.
---

# Weekly report

1. Collect ...
```

- `name`: lowercase letters, digits, and single hyphens, the same as the folder name. It is also the `/name` the user types.
- `description`: starts with "Use when" and names the concrete requests and words that should trigger the skill, in one or two sentences. It is the only part the agent sees before loading, so a vague description means the skill never loads.
- Optional keys: `disable-model-invocation: true` leaves `/name` as the only trigger; `user-invocable: false` hides the skill from the `/` menu.
- Body: imperative steps in the order the work happens, the output format with a short example, and the checks to run before finishing. Leave out what a capable agent already knows. Keep the body under about 6,000 characters; put long reference material in a `references` folder beside `SKILL.md`, one Markdown file per topic, and say in the body when to read each file.
- Load `agent-experience` for rules on making instructions discoverable and cheap to load.

## Save it

| Who should get it | Folder |
|---|---|
| Every chat in this Jan (default) | `$JAN_HOME/skills/<name>/` |
| Only chats in the current project | `.jan/skills/<name>/` at the project root: the nearest folder with `.git`, otherwise the working directory |

Read `JAN_HOME` from the shell (`echo "$JAN_HOME"`, or `$env:JAN_HOME` in PowerShell). Write the file with the file-write tool. A write outside the workspace asks the user for approval, so say in one sentence what you are saving and why before writing. Do not write into a `.system` folder.

## Verify and report

1. Read `SKILL.md` back and check that the frontmatter `name` matches the folder.
2. Load it with the `skill` tool by name. An unknown or invalid-name error means the folder, the `name`, or the frontmatter is wrong: fix the same file and load it again.
3. Tell the user the skill's name, where it was saved, and how to use it: type `/<name>` in a message, or ask for the task in words the description names. Skills in the default folder also appear in Customize > Skills, where the user can open and edit them.
