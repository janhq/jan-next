---
kind: upgrade-guide
description: "The `agent-instructions` row no longer accepts `janHome`; instruction loading always resolves the harness home from `$JAN_HOME` or `~/.jan`."
---

# Instruction loading resolves one harness home

## Change

`@janhq/jan-agent-instructions` removed its `janHome` config field. The plugin resolves the harness home through `resolveJanHome()` from `@janhq/jan-home-paths`, like every other harness consumer: the home is `$JAN_HOME` when it is set and non-blank, otherwise `~/.jan`, with tilde expansion.

A `cordis.yml`, profile patch, or `--patch` overlay that still sets `janHome` on the `agent-instructions` row has no effect: the row keeps the stray key and the plugin ignores it, so instruction loading follows the process home. Other providers, such as `jan-skill-filesystem` and `jan-shell-env`, keep their own home fields; this removal covers the instruction loader only.

## Migration

1. Delete `janHome` from the `agent-instructions` row in `cordis.yml`, `$JAN_HOME/cordis.patch.yml`, `$JAN_HOME/profiles/<profile>/cordis.patch.yml`, and any `--patch` overlay.
2. Where the override pointed at a non-default home, export `JAN_HOME` for the process instead, so every harness consumer reads that home.
3. Confirm with `jan --profile <profile> --dump-config` that the `agent-instructions` row lists only its remaining fields, and that a new session's first request shows `Instructions from: $JAN_HOME/AGENTS.md` (or `~/.jan/AGENTS.md`) when that file exists.
