/** The package names the plugin manager protects, hides, orders, or marks experimental. */

/**
 * Plugin packages the plugin manager refuses to disable or remove, because management itself needs them; a bundle that
 * contains one is read-only as well. Removing a name drops only this `management-required` refusal; the manager's own
 * entry, installation-carried bundles, and unaddressable rows stay protected by their own rules.
 */
export const PROTECTED_PLUGINS: ReadonlySet<string> = new Set([
  '@janhq/jan-plugin-manager', '@janhq/cordis-plugin-loader',
  '@janhq/cordis-plugin-include', '@janhq/jan-api-gateway',
  '@janhq/jan-host-webserver', '@janhq/jan-client-modules',
  '@janhq/jan-client-ui-settings-plugin-inventory', '@janhq/jan-client-ui-plugin-manager',
  '@janhq/jan-host-plugin-inventory', '@janhq/jan-typert-registry',
  '@janhq/jan-api-remotes', '@janhq/jan-api-remote-access',
  '@janhq/cordis-plugin-timer', '@janhq/jan-client-connection',
  '@janhq/jan-host-frontend-static', '@janhq/jan-tools',
  '@janhq/jan-hmr',
])

/**
 * Built-in profile bundles, persistent terminals, and the standalone worktree tool, which have no plugin manager page.
 * Their Host availability and activation stay intact.
 */
export const HIDDEN_BUNDLES: ReadonlySet<string> = new Set([
  '@janhq/jan-base',
  '@janhq/jan-web-app',
  '@janhq/jan-desktop-app',
  '@janhq/jan-headless',
  '@janhq/jan-sdk-app',
  '@janhq/jan-acp-app',
  '@janhq/jan-sdk-minimal',
  '@janhq/jan-experimental-terminal-bundle',
  '@janhq/jan-experimental-tool-worktree',
])

/**
 * The optional bundles the plugin manager's main and More lists rank first, in this order. {@link MORE_BUNDLES}, not
 * this list, decides whether a bundle appears on the main list.
 */
export const EXTENSION_BUNDLES: readonly string[] = [
  '@janhq/jan-experimental-voice-input-bundle',
  '@janhq/jan-experimental-plugin-market-bundle',
  '@janhq/jan-experimental-auto-review',
]

/**
 * The optional bundles the plugin manager's main list leaves out until the profile enables them; its More list,
 * which includes every eligible bundle, ranks them last in this order.
 */
export const MORE_BUNDLES: readonly string[] = [
  '@janhq/jan-personalized-recommendations',
  '@janhq/jan-experimental-inspector-profile',
  '@janhq/jan-cua-bundle',
  '@janhq/jan-experimental-cot-translation-bundle',
  '@janhq/jan-experimental-session-search',
  '@janhq/jan-experimental-session-titles-bundle',
  '@janhq/jan-experimental-badge-skill-bundle',
  '@janhq/jan-experimental-ralph-bundle',
  '@janhq/jan-subagent-codex',
  '@janhq/jan-subagent-claude-code',
]

/** Official bundles the plugin manager marks with the Experimental badge. */
export const EXPERIMENTAL_BUNDLES: ReadonlySet<string> = new Set([
  '@janhq/jan-personalized-recommendations',
  '@janhq/jan-cua-bundle',
  '@janhq/jan-experimental-voice-input-bundle',
  '@janhq/jan-experimental-auto-review',
  '@janhq/jan-experimental-inspector-profile',
  '@janhq/jan-experimental-forge-bundle',
  '@janhq/dsh-superagent',
  '@janhq/jan-experimental-tool-worktree',
  '@janhq/jan-experimental-cot-translation-bundle',
  '@janhq/jan-experimental-session-search',
  '@janhq/jan-experimental-session-titles-bundle',
  '@janhq/jan-experimental-badge-skill-bundle',
  '@janhq/jan-experimental-ralph-bundle',
  '@janhq/jan-experimental-plugin-market-bundle',
  '@janhq/jan-experimental-liveshare',
])
