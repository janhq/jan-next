# Manual QA checklist

## Summary

A hands-on checklist for the Jan Next desktop app. A person or an agent drives the real window, case by case, and records every failure with a screenshot. The checklist is split into independent lanes so several people or agents can run different lanes at the same time without sharing any state. Each case has an id, how it runs, the steps, the expected result, and the severity if it fails.

## Table of Contents

- [Run a lane](#run-a-lane)
- [Lane map](#lane-map)
- [Isolation rules](#isolation-rules)
- [Case format and statuses](#case-format)
- [Severity](#severity)
- [Evidence](#evidence)
- [Result file](#result-file)
- [Fix protocol](#fix-protocol)
- [Running lanes in parallel](#parallel)

<a id="run-a-lane"></a>
## Run a lane

Read the lane file first: it lists what the lane needs and which cases need a real model. Work through the cases in order; later cases assume the state earlier ones leave.

1. **Build once.** From the repository root run `corepack pnpm run dev:desktop` with L00's scratch home, fake home and user-data directory (see L00-01). It is the only launcher that builds, and it runs once, for L00 only. It leaves the artifacts every lane reuses under `apps/desktop/.desktop-build`. Wait for the window, then continue with L00. Never run `dev:desktop` for another lane: concurrent builds overwrite the shared build directory. Every lane, L00 included from then on, starts the app with the Electron command in the recipe below. Both launchers must use the same user-data directory (`$Q/ud`), or the profile the first one wrote is not the one the second one opens. The default model on a fresh home is `anthropic/claude-sonnet-5-5[1m]`, so in every lane that runs `stub` or `any` cases, switch the model picker to `qa-mock / mock-model` before the first send; a case must never run on the default model by accident.
2. **Pass L00 and make the seed.** L00 launches with an empty home, completes onboarding, adds the mock model, and copies the result to `/tmp/jan-qa/seed`. Every other lane clones that seed.
3. **Launch the lane instance** with the recipe below.
4. **Start the lane's mock model server** when a case says `stub`.
5. **Walk the cases,** logging each one in the lane's result file as you go.
6. **Fix and re-walk** following the [fix protocol](#fix-protocol).

Launch recipe, macOS arm64 (change the `targets/mac-arm64` segment on other platforms):

```bash
REPO=~/orca/workspaces/jan-next/pr-15
LANE=03                                   # the lane number
BASE=$((9400 + 10#$LANE * 10))            # this lane's port block
Q=/tmp/jan-qa/L$LANE
mkdir -p $Q $Q/fakehome && cp -cR /tmp/jan-qa/seed/home $Q/home && cp -cR /tmp/jan-qa/seed/ud $Q/ud
export HOME=$Q/fakehome JAN_HOME=$Q/home JAN_AGENTS_HOME=$Q/agents
for v in $(env | sed -n 's/^\([A-Za-z0-9_]*API_KEY\)=.*/\1/p'); do unset $v; done   # no provider key from the shell
# Lanes with `real` cases: export exactly the one key the lane needs here, for example: export ANTHROPIC_API_KEY=...
export JAN_DESKTOP_PRIMARY_RUNTIME_DIR=$REPO/apps/desktop/.desktop-build/targets/mac-arm64/runtime/primary-runtime
export JAN_DESKTOP_HOST_INSPECT_PORT=$((BASE+2)) JAN_DESKTOP_OPEN_DEVTOOLS=0 JAN_DESKTOP_DEV_APP=1
export JAN_LLAMA_WORKER=$REPO/native/llama-worker/dist/jan-llama-worker
export MOCK_MESSAGES_API_KEY=mock QA_MOCK_BASE_URL=http://127.0.0.1:$((BASE+3))/v1
cd $REPO/apps/desktop
"$REPO/apps/desktop/.desktop-build/development/Jan Next Dev.app/Contents/MacOS/Electron" \
  --inspect=127.0.0.1:$((BASE+1)) --remote-debugging-port=$BASE --user-data-dir=$Q/ud .
```

Mock model server for a lane (`stub` cases). The scripted behaviors are listed in the [mock server README](../../packages/test-support/llm-mock-server/README.md):

```bash
cd $REPO && pnpm run mock:llm --port $((BASE+3)) --api-key mock --sequence success --repeat-last
```

Restart it with another `--sequence` (for example `rate_limit,success` or `context_overflow`) whenever a case asks for a failure. The seed profile registers one provider named `qa-mock` whose base URL comes from `QA_MOCK_BASE_URL`, so the launch recipe points each lane at its own server and no lane edits its profile (L00-05 creates the provider).

`HOME` is set to an empty folder because the app looks for the original Jan app's data under the real home directory (`~/Library/Application Support/Jan/data` on macOS, `$XDG_DATA_HOME/Jan/data` or `~/.local/share/Jan/data` on Linux, `%APPDATA%\Jan\data` on Windows). Without it a lane on a machine that has the old Jan installed offers to import the person's real chats and could import them. L10 puts its own test data folder at that path under the fake home. Never skip the `HOME` line, and never copy a real person's chats into a lane.

The `unset` loop is there because the app reads provider keys such as `TOKAMAK_API_KEY`, `GROQ_API_KEY`, `MINIMAX_API_KEY`, `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` from the environment. Left exported, one of them gives a brand-new empty home a real model and a real bill (a first send on an empty home once returned a paid reply from `anthropic/claude-sonnet-5-5`), and a case about a missing key or a missing model silently passes. `stub` and `any` lanes run with no provider key in the environment at all. Only a lane with `real` cases (L06, L07, L08, L09, L13 and L10-18) exports a key, exactly the one it needs, and only for that lane's shell.

<a id="lane-map"></a>
## Lane map

| Lane | File | Subject | Needs |
|---|---|---|---|
| L00 | [L00-first-launch.md](lanes/L00-first-launch.md) | First launch, onboarding, seed profile | nothing; blocks all others |
| L01 | [L01-shell-navigation.md](lanes/L01-shell-navigation.md) | Sidebar, top bar, navigation, shortcuts, window | seed |
| L02 | [L02-chat-core.md](lanes/L02-chat-core.md) | Send, stream, stop, retry, attachments, commands | seed, mock server |
| L03 | [L03-models-context.md](lanes/L03-models-context.md) | Picker, context ring, fallback chain, compaction | seed, mock server |
| L04 | [L04-local-models.md](lanes/L04-local-models.md) | Local model download, load, context, auto-fit | seed, network, disk |
| L05 | [L05-settings.md](lanes/L05-settings.md) | Every Settings section | seed |
| L06 | [L06-account-language.md](lanes/L06-account-language.md) | Account, sign-in, language | seed, Tokamak account |
| L07 | [L07-plugins.md](lanes/L07-plugins.md) | Plugin manager, third-party install, translation | seed, network |
| L08 | [L08-office-ppt-cad.md](lanes/L08-office-ppt-cad.md) | Office, PPTX, CAD | seed, real model, office resources |
| L09 | [L09-artifacts-projects-panel.md](lanes/L09-artifacts-projects-panel.md) | Artifacts, projects, workspace, right panel | seed, real model for agent cases |
| L10 | [L10-legacy-import.md](lanes/L10-legacy-import.md) | Import from the original Jan | seed, a copy of an original Jan data folder |
| L11 | [L11-persistence-reliability.md](lanes/L11-persistence-reliability.md) | Restart, crash, offline, performance | seed, mock server |
| L12 | [L12-appearance-a11y.md](lanes/L12-appearance-a11y.md) | Themes, locales, accessibility, window sizes | seed |
| L13 | [L13-agents-mcp-skills.md](lanes/L13-agents-mcp-skills.md) | MCP servers, skills, presets, automation, permissions | seed, real model |

<a id="isolation-rules"></a>
## Isolation rules

- A lane owns `/tmp/jan-qa/Lnn`: its home, fake home, user-data directory, agents directory and logs. Nothing else writes there.
- A lane owns the port block `9400 + 10 x lane`: renderer debugging `BASE`, main inspector `BASE+1`, host inspector `BASE+2`, mock model server `BASE+3`, spare `BASE+4`.
- Never point a lane at your real Jan data. Every case that writes data writes to the lane's scratch home. Clean up files created outside it (downloads in the real Downloads folder, Keychain items) and list them in the result file.
- Never point a lane at the original Jan app's data folder. The recipe sets `HOME` to the lane's empty `fakehome`; L10 copies its own test data folder into that path and never reads the real one.
- Network cases use throwaway accounts and test repositories only.

<a id="case-format"></a>
## Case format and statuses

Each lane file is a table with these columns.

| Column | Meaning |
|---|---|
| ID | `Lnn-mm`, never reused or renumbered |
| Via | `stub` (mock model server), `real` (a provider key from `.env` or `~/.zshrc`), `local` (a downloaded llama.cpp model), `any` (no model call) |
| Steps | What the user does, in order; use only clicks, keys, scrolling, resizing |
| Expect | What a person must see; a case fails on any difference |
| Sev | Default severity if the case fails |

Statuses: `pass`, `fail` (with a finding row), `blocked` (a dependency was missing, with the reason), `n/a` (does not apply on this platform or build, with the reason). A case that was not run is `not run`, never `pass`.

State-holding controls are exercised four ways wherever a case says so: first on an untouched item, then after use, after leaving and returning, and after quit and relaunch. Lost work is P0.

<a id="severity"></a>
## Severity

| Sev | Meaning |
|---|---|
| P0 | Wrong result or lost user work, data corruption, crash, security or privacy leak |
| P1 | Blocks the job or misleads: the user cannot finish, or is told something false |
| P2 | Slows or confuses: wrong label, missing feedback, confusing state |
| P3 | Polish: spacing, alignment, optics, copy |

<a id="evidence"></a>
## Evidence

Every failure needs a screenshot taken while the state is on screen, plus an annotated copy: a box on the exact control or region and a numbered mark labelled with the finding id (`F-12: draft lost after switching chats`). Open the annotated image and check the mark is on the right thing before filing. Keep the original. A text description, a DOM snapshot or an API reply is not evidence.

For a fix, keep annotated before and after screenshots with the same finding id; the after is taken during the re-walk, after the fix. The helper `annotate.py` in the `00-human-ux-walkthrough` skill draws the marks.

<a id="result-file"></a>
## Result file

One file per lane per run, outside the repository: `~/ux-walks/manual-qa/<yyyy-mm-dd>/Lnn.md`. Case rows first, findings second, so results from lanes concatenate.

```markdown
# Lnn result, <date>, commit <sha>, <who>

## Cases
| ID | Status | Note |
|---|---|---|
| L03-01 | pass | |
| L03-02 | fail F-3 | |

## Findings
| # | Case | Sev | I expected | I got | Evidence | Status |
|---|---|---|---|---|---|---|
| F-3 | L03-02 | P1 | picker lists 3 models | picker empty | `shots/L03-02-annotated.png`, mark 1 `F-3: picker empty` (read back) | open |

## Cleanup
Files, accounts or processes created outside the lane's scratch directory.
```

Finding ids restart per lane and carry the lane prefix when merged (`L03/F-3`).

<a id="fix-protocol"></a>
## Fix protocol

1. Reproduce the finding by hand and screenshot it failing. A report that will not reproduce is `fixed-unseen` and is named as such in the report.
2. Fix in severity order, cause first. One commit per concern, scoped to the owning package.
3. Re-walk the whole lane from its first case, not just the failing case, and add any new findings. A fix that moves the bug elsewhere shows up here.
4. A product or policy decision is `needs-owner` with a recommendation; the fixer does not decide it.
5. Stop after four rounds on one lane and report the remaining findings as a design problem.

<a id="parallel"></a>
## Running lanes in parallel

- Lanes are independent. Run any subset at once; at most four Electron instances on a 10-core, 32 GB laptop before timings stop meaning anything. L04 and L11's performance cases want an otherwise quiet machine: run them alone.
- Each agent takes whole lanes. Two agents never edit the same lane's result file.
- Fixes touch the shared repository. Agents that fix code work in their own worktree or hand findings to one fixer; a lane re-walk always runs against the built artifacts of the commit under test, so rebuild once after merging fixes and tell the other lanes.
- The shared build directory is read-only during a run. Rebuild only when no lane instance is open.
