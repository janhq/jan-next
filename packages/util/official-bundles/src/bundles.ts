/** The bundle package names the jan installation selects, offers, installs on demand, or retires. */

/** Installation-owned defaults used when a shipped profile is first opened. */
export interface ProfileTemplate {
  /** Ordered bundle layer list. */
  bundles: readonly string[]
}

/** The shipped profile templates auto-initialized on first use, by name. */
export const PROFILE_TEMPLATES: Record<string, ProfileTemplate> = {
  acp: {
    bundles: ['@janhq/jan-base', '@janhq/jan-acp-app'],
  },
  web: {
    bundles: ['@janhq/jan-base', '@janhq/jan-web-app'],
  },
  // The desktop app's Web surface plus Jan's theme, legacy chat import, and preset catalog.
  desktop: {
    bundles: ['@janhq/jan-base', '@janhq/jan-web-app', '@janhq/jan-desktop-app'],
  },
  headless: {
    bundles: ['@janhq/jan-base', '@janhq/jan-headless'],
  },
  sdk: {
    bundles: ['@janhq/jan-base', '@janhq/jan-sdk-app'],
  },
  'sdk-minimal': {
    bundles: ['@janhq/jan-sdk-minimal'],
  },
}

/**
 * Installation-owned bundle tuples that an earlier release wrote into a shipped profile; app-boot replaces an exact
 * match with the {@link PROFILE_TEMPLATES} entry of the same name and leaves every other list untouched.
 */
export const INSTALLATION_OWNED_PROFILE_TUPLES: Readonly<Record<string, readonly string[]>> = {
  headless: ['@janhq/jan-base', '@janhq/jan-web-app', '@janhq/jan-headless'],
  // Former Desktop default, not the current template. App-boot checks this tuple only once per profile.
  desktop: ['@janhq/jan-base', '@janhq/jan-web-app'],
}

/** Bundles an earlier release shipped and the installation no longer carries; app-boot removes them from profiles. */
export const RETIRED_BUNDLES: ReadonlySet<string> = new Set([
  // The Web composition mounts Schedule itself
  // ([upgrade guide](../../../../docs/upgrade-guide/v0.2.0-rc.2/schedule-bundle-retired/guide.md)).
  '@janhq/jan-experimental-schedule-bundle',
  '@janhq/jan-experimental-agent-team-profile',
])

/** The bundle list a `jan plugin` init uses for a name with no shipped template. */
export const DEFAULT_PROFILE_BUNDLES: readonly string[] = ['@janhq/jan-base']

/**
 * The bundles the jan installation ships for a person to switch on: each a
 * runtime dependency of the installation that declares `jan.bundle.patch`,
 * an `icon`, and `./locale/*.json` display metadata, selected by no shipped
 * template, and offered switched off by the plugin manager except persistent
 * terminals, which have no page switch
 * ([rationale](../../../../.agents/notes/implemented/process/2026-09-15-shipped-optional-bundles.md),
 * [admission](../../../../.agents/notes/implemented/architecture/2026-09-21-experimental-capabilities-as-optional-bundles.md)).
 */
export const OPTIONAL_BUNDLES: readonly string[] = [
  '@janhq/jan-personalized-recommendations',
  '@janhq/jan-cua-bundle',
  '@janhq/jan-experimental-session-search',
  '@janhq/jan-experimental-ralph-bundle',
  '@janhq/jan-experimental-terminal-bundle',
  '@janhq/jan-experimental-badge-skill-bundle',
  '@janhq/jan-experimental-session-titles-bundle',
  '@janhq/jan-experimental-voice-input-bundle',
  '@janhq/jan-experimental-cot-translation-bundle',
  '@janhq/jan-experimental-auto-review',
  '@janhq/jan-experimental-inspector-profile',
  '@janhq/jan-experimental-liveshare',
  '@janhq/jan-experimental-plugin-market-bundle',
  '@janhq/jan-experimental-tool-worktree',
  '@janhq/jan-experimental-forge-bundle',
  // Super Agent needs a state directory and a GitHub repository before it starts, so a person turns it on and sets it up.
  '@janhq/dsh-superagent',
]

/** Public Jan release members available through the ordinary on-demand bundle installer. */
export const ON_DEMAND_BUNDLES: readonly string[] = [
  '@janhq/jan-subagent-claude-code',
  '@janhq/jan-subagent-codex',
]
