---
name: create-skill
description: Use when the user asks Jan to create, write, update, or fix a skill (reusable instructions loaded on demand or with /name), or to save a workflow, checklist, or writing style from this conversation so later chats can reuse it.
---

# Create a Jan skill

A skill is reusable instructions, not a plugin or a named agent. Jan catalogs the skill's `name` and `description` and loads its Markdown body on demand. The user can invoke it with `/<name>`; new or edited skills are available without a restart.

## Decide what the skill does

1. Ask only what the conversation has not answered: the task, the requests that should trigger it, and what a good result looks like. When the user asks to save something just done, reuse that work's steps and the corrections the user made along the way.
2. One skill, one job. When a skill in the catalog almost covers the request, change that skill instead of adding a near-duplicate.
3. When the request needs a new tool, page, panel, or connection to a service, use `create-plugin` or `create-connector`. For a named agent with its own instructions, model, or tool limits, use `editing-cordis-compositions`.

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
- Optional keys: `disable-model-invocation: true` keeps it out of the model's catalog and loader; `user-invocable: false` hides it from the user's `/` menu.
- Body: imperative steps in the order the work happens, the output format with a short example, and the checks to run before finishing. Leave out what a capable agent already knows. Keep the body under about 6,000 characters; put long reference material in a `references` folder beside `SKILL.md`, one Markdown file per topic, and say in the body when to read each file.
- Load `agent-experience` for rules on making instructions discoverable and cheap to load.

## Save it

| Who should get it | Folder |
|---|---|
| Chats in this Jan home (default) | `$JAN_HOME/skills/<name>/` |
| Chats working in the current project | `<project>/.jan/skills/<name>/` at the nearest enclosing Git root, or the working directory when outside a Git repo |

Read `JAN_HOME` from the shell (`echo "$JAN_HOME"`, or `$env:JAN_HOME` in PowerShell). Write the file with the file-write tool. A write outside the workspace asks the user for approval, so say in one sentence what you are saving and why before writing. Do not write into a `.system` folder.

## Verify and report

1. Read `SKILL.md` back and check that the frontmatter `name` matches the folder.
2. Load it with the `skill` tool by name unless it is user-only. Check that `/<name>` appears in Jan's composer when it is user-invocable; use a new chat in the appropriate project to try the workflow.
3. Tell the user the skill's name, its saved path, and how to invoke it. The default home folder also appears in Customize > Skills on Desktop, where the user can open and edit it.
