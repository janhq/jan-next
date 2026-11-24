# Agent Note: CI failover runbook — hosted pools → in-house pool

Status: implemented

## Problem

The required Linux worker jobs in [CI](../../../../.github/workflows/ci.yml) (`node 24 / static` and `node 24 / snapshots and artifacts`; `node 24 / coverage` is disabled while CI uses hosted runners) run on GitHub-hosted `ubuntu-24.04`; the required verdict job that aggregates them (`all checks passed`) runs on standard `ubuntu-latest`; the [native Windows jobs](2026-08-08-native-windows-pull-request-ci.md) in [CI Windows](../../../../.github/workflows/ci-windows.yml) run on GitHub-hosted `windows-2025`. When the hosted pools degrade — jobs queue indefinitely or a label stops resolving — every open pull request becomes unmergeable, and the ordinary recovery of merging a fix is itself deadlocked behind the very required checks that cannot run. **Scope: two independent switches, one per platform.** `JAN_CI_FAILOVER_LINUX` recovers a hosted Linux-pool outage (the three required Linux workers plus the `all checks passed`, `windows checks passed`, and `python checks passed` verdicts); `JAN_CI_FAILOVER_WINDOWS` recovers a hosted Windows-pool outage (the native Windows jobs). A Linux-pool outage need not retarget Windows jobs and vice versa. The [Node compatibility jobs](../../../../.github/workflows/ci.yml) also follow the Linux switch with isolated setup; the verdict's `python-sdk` and `python-runtime` dependencies stay on standard hosted runners, as does CI Python's `python-runtime`; in a broader GitHub-hosted capacity failure that also takes out the standard pools, those dependencies still block the verdicts that require them. An outage therefore needs a switch any responder with repository write access can throw without merging anything.

## Decision

The three primary Linux jobs (`node-24`, `node-24-coverage`, `node-24-consumers`), the two `node-compat` matrix entries, and the `all-checks-passed`, `windows-checks-passed`, and `python-checks-passed` verdicts resolve through `JAN_CI_FAILOVER_LINUX`; the native Windows jobs resolve through `JAN_CI_FAILOVER_WINDOWS`. A platform switch does not redirect the other platform. Set to `selfhosted` by a repository writer, the applicable trusted jobs select `vm-backup` or `jan-win-ci`; the `blacksmith` value routes the participating jobs per the [blacksmith failover leg note](2026-09-09-blacksmith-failover-leg.md); unset or any other value retains the workflow-defined hosted fallbacks. Node compatibility jobs require a same-repository, non-fork head and a non-Dependabot author, use isolated runtime setup, and retain the `ubuntu-latest` fallback under unset and non-special values; the blacksmith branch carries none of those predicates. Under the `selfhosted` value, Linux failover bounds snapshot concurrency and skips hosted package-cache restores. The three verdict jobs follow the Linux switch so they do not remain queued on an unavailable hosted pool. Each switch is writer-manageable repository state, not a merge, so it works while checks are red. No master-push lane exercises the self-hosted pools, so the `selfhosted` value has no continuous readiness evidence; prove a newly registered pool with a manual run before relying on it.

### Release rehearsals share the Linux switch

`JAN_CI_FAILOVER_LINUX=selfhosted` also routes the credential-free dependency-layout job and both jan/vendor pack jobs onto `vm-backup` for eligible same-repository PRs and master pushes. Their [release rehearsal reference](../../../../.github/workflows/release.yml) owns the stricter event eligibility and hosted manual dispatch. This coupling is intentional: keeping the variable set to save release minutes also keeps the eligible main-CI Linux jobs self-hosted. Clearing it returns both workloads to their hosted targets for subsequent runs; publication stays hosted regardless.

### What the in-house pool is

No runner with the `vm-backup` or `jan-win-ci` label is registered for janhq/jan-next; the `selfhosted` value queues the selected jobs until a pool meeting the requirements below is registered.

`vm-backup`: one shared VM with multiple always-on systemd-managed runner instances. Registrations share its CPU, memory, and disk; their count is not a count of independent machines. Its image must preinstall the Linux system packages for Playwright Chromium and WebKit; CI downloads the lockfile-selected browsers but never runs `apt` on this persistent shared host.

#### Windows pool

`jan-win-ci`: 32 always-on runner instances (scheduled tasks `GH-Runner-01`…`GH-Runner-32`) on the in-house Windows CI server (one 96-core / 580 GB machine). Labels: `[self-hosted, jan-win-ci, windows]`. The image must preinstall Node 24, pnpm, Git (with Git Bash on `PATH`, i.e. `C:\Program Files\Git\bin` — the `bash` tool spawns `bash` by name), PowerShell 7, and enable Developer Mode for symlink support. The general-purpose Windows workspaces and pnpm store must both live on a ReFS volume (`F:`): those installs pass `--package-import-method=clone` on ReFS, which needs that volume layout and the `@reflink/reflink` native module that the system corepack pnpm carries; a rebuilt runner without this layout fails the Windows build gates with TS6231.

### Switch (any repository writer, ~1 minute, no merge)

The two switches are independent: flip only the one whose platform is degraded.

1. Repository **Settings → Secrets and variables → Actions → Variables → New repository variable**: name `JAN_CI_FAILOVER_LINUX` (Linux pool outage) or `JAN_CI_FAILOVER_WINDOWS` (Windows pool outage), value `selfhosted`.
2. Retrigger the required jobs so they re-resolve their pool. Jobs already **queued** for the hosted labels do not retarget and cannot be re-run in place, so for the documented indefinite-queue outage, cancel the stuck run and re-run all jobs, or push a new commit; "Re-run failed jobs" only helps once a job has actually failed rather than queued.
3. That is the entire switch. Under the `selfhosted` Linux failover value the workflow also drops `JAN_SNAPSHOT_MAX_CONCURRENCY` to 12 for the shared VM and skips the hosted-path pnpm cache restores because the VM's persistent store serves warm installs. Self-hosted coverage uses four single-worker instrumented partitions and two exempt workers; isolated hosted runners derive worker defaults from available CPUs. The Windows switch selects the native Windows pool and retains explicit worker limits on shared self-hosted runners.

**Dependabot exception.** Both switches' `selfhosted` legs deliberately exclude `dependabot[bot]`: under self-hosted failover, Dependabot PRs stay queued for the hosted pool rather than executing dependency-supplied code on the persistent VMs. A Dependabot PR that remains queued during an outage is expected behavior, not a failed switch; it completes when the hosted pool recovers. The `blacksmith` value's branches carry no such exclusion, because Blacksmith runners are ephemeral (see the [blacksmith failover leg note](2026-09-09-blacksmith-failover-leg.md)).

**Who can flip the variable.** GitHub's API lets any collaborator with write access manage repository variables, so each switch is writer-level, not strictly admin-only. In this repository's trust model that is not an escalation: the runner groups admit all workflows of this private, fork-disabled repository (a deliberate trade to make PR-ref failover possible at all), so any writer could already reach the VMs by pushing a branch workflow. The boundary against untrusted code is repository membership; the variables only route work for members.

## Capacity during failover

Capacity includes main-CI jobs, and three release-rehearsal jobs for each eligible PR or master push while the Linux switch is set. Each trusted PR also adds two Node compatibility jobs at gate concurrency one, including the build-backed Node 24.9 leg and cold temporary runtime downloads. The release rehearsal workflows cancel superseded runs within each workflow/ref group under the [cancellation policy](../../../../.github/workflows/ci.yml); different refs can still add concurrent build, pack, and install load. Check current CPU, memory, disk, and queue pressure before extending self-hosted operation; extra registrations on this VM add scheduling slots, not machine resources. When host resources permit extra registrations, use an org registration token (org Settings → Actions → Runners → New runner). Clone an existing runner directory **excluding its identity files** — `rsync -a --exclude '.runner*' --exclude '.credentials*' --exclude '_diag' --exclude '_work' <src>/ <dst>/` (the globs also catch `.runner_migrated`/`.credentials_migrated`, which GitHub writes on migrated runners and which equally trigger the already-configured refusal) — then run `config.sh` (copying `.runner`/`.credentials` verbatim makes it refuse with "already configured"), and **start the listener**: `sudo ./svc.sh install ubuntu && sudo ./svc.sh start`. Registration alone leaves the runner offline; a started service adds a scheduling slot, not CPU or memory.


### Switch back

Delete the `JAN_CI_FAILOVER_LINUX` or `JAN_CI_FAILOVER_WINDOWS` variable (or set it to any value other than `selfhosted` or `blacksmith`). New runs resolve back to their hosted pools. Setting it to `blacksmith` keeps the jobs on Blacksmith until the value changes. Remove any extra instances that were registered during the incident.

### Trust boundary

The variables are writer-manageable repository state; a pull request event itself can neither set them nor read a different value into effect, and the selector expressions live in workflow definitions. Note that under failover, `pull_request` runs execute the PR merge ref's own workflow definition — the boundary against untrusted code is repository membership (private, forking disabled, Dependabot excluded by the `selfhosted` legs; the `blacksmith` legs carry no exclusion), not the variable. Note on runner-group policy: pinning the runner group to the master-ref workflow is **incompatible** with this failover — the failover jobs, including the Node compatibility matrix, are `pull_request` runs evaluated from PR merge refs, and a master-pinned group leaves them queued (observed live on 2026-07-27; the group was widened to all workflows of this repository to unblock the switch). A stricter runner-side policy therefore costs PR failover; the shipped posture accepts repository-scoped, all-workflow group access.

## Alternatives considered

**Merge a workflow change to switch pools.** Rejected because the outage that motivates the switch is exactly the state in which no PR can merge: the required checks are the ones failing. A repository variable is writer-manageable state that takes effect on re-run without a merge.

**Keep the self-hosted pool always in the required path.** Rejected because it trades hosted-pool availability for the in-house VM's, moving a single point of failure rather than adding a fallback. The unset defaults retain hosted targets and the switches provide a reversible, operator-selected self-hosted path; splitting them by platform means an outage on one platform does not retarget the other.

## Consequences

Recovering from a hosted-pool outage is flipping the affected platform's variable (any writer) plus a re-run, with no merge on the critical path. The cost is a second runner topology per platform to keep working without continuous readiness evidence, and the snapshot-concurrency and cache-restore branches in `ci.yml` carry a `selfhosted` leg (Linux only) that must stay in step with the hosted leg. Splitting the switch by platform adds one more variable to manage but bounds the blast radius of each switch to the jobs of a single platform.
