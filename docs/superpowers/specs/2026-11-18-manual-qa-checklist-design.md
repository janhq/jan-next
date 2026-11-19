# Manual QA checklist: design

## Problem

Unit, snapshot and coverage gates pass while the shipped desktop app still has user-visible bugs. Nothing in the repository tells a person or an agent what to click, what to expect, and how to record a failure. Past walks live in personal notes outside the repository and cover one feature each.

## Decisions

- **Scope:** everything the `jan-shell-ui` branch adds or changes, plus the core flows it can break (first launch, send a chat, switch model, restart). It is a standing release checklist, so every case is written against current behavior.
- **Location:** `docs/manual-qa/`, one README and one file per lane under `lanes/`. Plain Markdown tables so a person reads the same file an agent executes.
- **Parallel by construction:** a lane owns its scratch `JAN_HOME`, Electron user-data directory, ports and mock model server. Lanes never share mutable state, so any subset runs at the same time. The only ordering rule is that lane L00 must pass once to produce the seed profile the other lanes clone.
- **Hands only:** a case passes only when observed through the real window with clicks, keys and screenshots. Evals, API calls and file reads are for the fix turn, not evidence.
- **Keyless by default:** each case names how it runs (`stub`, `real`, `local`). Stub cases use the repository's mock model server so a lane needs no provider key.
- **One result file per lane per run,** outside the repository, with a fixed row format, so findings from parallel lanes merge by concatenation.
- **Bugs follow the self-improve loop:** walk, fix by severity, re-walk the whole lane, requirements check. A fix carries annotated before and after screenshots with the finding id.

## Rejected alternatives

- **One flat checklist:** unusable in parallel and unreadable at several hundred cases.
- **A scripted end-to-end suite instead:** the existing tiers already cover scripted paths. The bugs that escape are the ones a script presses in the wrong order, so the checklist stays manual and gets automated only where a case proves stable and valuable.
- **A launcher script in `scripts/`:** it would join the repository's script gates for little gain. The README carries the launch recipe instead.

## Lane map

| Lane | Subject |
|---|---|
| L00 | First launch, onboarding, seed profile (blocking) |
| L01 | Sidebar, top bar, navigation, shortcuts, window |
| L02 | Chat core: send, stream, stop, retry, attachments, commands |
| L03 | Model picker, context ring, fallback chain, compaction |
| L04 | Local models: download, load, context length, auto-fit |
| L05 | Settings sections |
| L06 | Account, sign-in, language |
| L07 | Plugin manager, third-party install, plugin translation |
| L08 | Office (Word, Excel), PPTX, CAD |
| L09 | Artifacts, projects, workspace, right panel |
| L10 | Legacy Jan import |
| L11 | Persistence, restart, crash, offline, performance |
| L12 | Appearance, themes, locales, accessibility, window sizes |
| L13 | MCP servers, skills, presets, automation, permissions |

## Definition of done for a run

Every case in every assigned lane is `pass`, `fail` with a finding row, `blocked` with a reason, or `n/a` with a reason. No P0 or P1 finding is open. Each fixed finding has annotated before and after screenshots. Cases written but not run are reported by id.
