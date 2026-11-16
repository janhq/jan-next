# Agent Note: One harness home resolver

Status: implemented

## Problem

The harness had two inconsistent conventions for "where does Jan user data live":

- `@janhq/jan-home` resolved `configured ?? $JAN_HOME ?? ~/.jan`.
- `@janhq/jan-home-paths` shipped a **second** `resolveJanHome` with the same precedence plus tilde expansion — a near-duplicate of `jan-home` that no gate flagged because the two lived in different packages and had already drifted (only one expanded tildes).

Two resolvers for the same cross-cutting fact meant there was no single home policy.

## Decision

One resolver owns the harness home, in `@janhq/jan-home-paths`, single-root:

```
explicit configured path  >  $JAN_HOME  >  ~/.jan
```

An empty or whitespace-only `$JAN_HOME` is treated as unset; otherwise `resolve('')` would silently place the home at the current working directory. The harness keeps all user data under one root; there is no XDG config/data/cache split. `janHomePath(...segments)` joins deployment-owned children onto that root, and `jan-app-boot` exposes it to Loader `!!js` config expressions before mounting entries, so shipped compositions derive `sessions` and `storages` without copying the resolver. `janHomeDisplay()` names a resolved root symbolically for user-facing paths — `~/.jan` for the default home, `$JAN_HOME` for any configured home — so the user-global `AGENTS.md` label never leaks an absolute machine path. It replaces agent-instructions's bespoke default-vs-`$JAN_HOME` check. Home is process policy rather than row configuration: `jan-agent-instructions` accepts no home override, so a composition cannot point instruction loading at a root that sessions, skills, and storage would not read. `resolveAgentsHome()` and `agentsHomeDisplay()` apply the same precedence, tilde expansion, and symbolic labelling to the shared agent configuration root (`$JAN_AGENTS_HOME` or `~/.agents`), which stays outside the harness home because other agent tools share it ([shared agents root](2026-10-05-shared-agents-root-instructions.md)); `jan-skill-filesystem` still accepts its own `janHome` and `agentsHome` fields, which select its own skill roots and resolve through the shared resolver in the instruction-loading change.

`janCachePath(...segments)` derives paths below the resolved home's `cache` directory. An initial `{ janHome }` option preserves a provider's explicit home override. It resolves paths without creating directories; callers own directory creation. `attachment-local` uses this helper for regenerable request-image variants while retaining durable attachment objects in their versioned storage tree, so clearing the cache cannot remove Session attachments. Existing request-image cache entries are left in place and are not read or copied; a cache miss regenerates the variant from its durable attachment.

`@janhq/jan-home` is deleted. Home-owning providers and boot packages import `resolveJanHome` from `jan-home-paths`; composition bundles contain only the resolved configuration rows.

`jan-telemetry` and its separate home policy are absent, leaving this resolver as the sole home policy.

## Alternatives considered

**Leave the two `resolveJanHome` copies in place.** They had already drifted (one expands tildes, one didn't) and encode the same cross-cutting fact twice. Consolidation is the point of the `util/` layer; a duplicate resolver is a latent divergence bug.

**Adopt XDG (honor `$XDG_CONFIG_HOME`, or split config/data/cache into separate trees).** Considered and dropped in favor of one obvious root. A single `$JAN_HOME || ~/.jan` ground truth matches `~/.claude` / `~/.aws`, needs no per-kind reclassification of every `~/.jan` consumer, and leaves no resolver asymmetry to reconcile.

## Consequences

- One home fact, one resolver. `jan-home-paths` is the sole owner; the `util/` group loses the `home` package.
