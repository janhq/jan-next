window.__ModuleLoader__.load({
  id: '@janhq/jan-onboarding',
  chunk: 'client.setup.js',
  factory() {
/** Role, goal and setup data for the desktop questionnaire. */
const worktrees = '@janhq/jan-experimental-tool-worktree'
const search = '@janhq/jan-experimental-session-search'
const titles = '@janhq/jan-experimental-session-titles-bundle'
const voice = '@janhq/jan-experimental-voice-input-bundle'

const profiles = {
  developer: { goals: ['code', 'debug'], modes: ['standard', 'chat'], plugins: [worktrees, search] },
  student: { goals: ['learn', 'research'], modes: ['chat'], plugins: [search, titles] },
  researcher: { goals: ['research', 'analyze'], modes: ['chat', 'standard'], plugins: [search, titles] },
  writer: { goals: ['draft', 'research'], modes: ['chat'], plugins: [voice, search] },
  marketing: { goals: ['draft', 'plan'], modes: ['chat'], plugins: [voice, titles] },
  analyst: { goals: ['analyze', 'report'], modes: ['standard', 'chat'], plugins: [search, titles] },
  office: { goals: ['plan', 'report'], modes: ['chat'], plugins: [titles, voice] },
  designer: { goals: ['design', 'research'], modes: ['chat', 'standard'], plugins: [voice, search] },
}

const pluginCopy = {
  [worktrees]: 'worktrees', [search]: 'search', [titles]: 'titles', [voice]: 'voice',
}

/** Role identifiers in display order. */
const roles = Object.keys(profiles)

/**
 * @param {string[]} selected - role identifiers in selection order.
 * @returns {string[]} available goals with duplicates removed.
 */
function goalsFor(selected) {
  return [...new Set(selected.flatMap(role => profiles[role].goals))]
}

/**
 * @param {string[]} selected - role identifiers in selection order.
 * @param {{ presets: string[], bundles: { name: string, availability: string, enabled: boolean, readOnlyReason?: string }[] }} catalog - live Host choices.
 * @returns {{ modes: { id: string, copy: string }[], plugins: { id: string, copy: string }[] }} ordered recommendations; the first checked mode wins unless the user picks another.
 */
function recommend(selected, catalog) {
  const modeIds = new Set(selected.flatMap(role => profiles[role].modes))
  const pluginIds = new Set(selected.flatMap(role => profiles[role].plugins))
  const presets = new Set(catalog.presets)
  const available = new Set(catalog.bundles.filter(bundle => bundle.availability === 'installation'
    && !bundle.enabled && bundle.readOnlyReason === undefined).map(bundle => bundle.name))
  return {
    modes: [...modeIds].filter(id => presets.has(id)).map(id => ({ id, copy: id })),
    plugins: [...pluginIds].filter(id => available.has(id)).map(id => ({ id, copy: pluginCopy[id] })),
  }
}

/**
 * Apply explicit choices through profile-wide operations. Never disable a plugin that was on before onboarding.
 * @param {{ enable: (name: string) => Promise<string>, setDefault: (id: string) => Promise<void>, saveProfile: (profile: { name: string, roles: string[], goals: string[] }) => Promise<void> }} settings - profile operations.
 * @param {{ name: string, roles: string[], goals: string[] }} profile - device-local answers.
 * @param {ReturnType<typeof recommend>} options - items actually offered to this user.
 * @param {{ plugins: string[], modes: string[], defaultMode: string }} checked - selected recommendation IDs and preferred default.
 */
async function applySetup(settings, profile, options, checked) {
  const modes = options.modes.filter(({ id }) => checked.modes.includes(id))
  for (const { id } of options.plugins) {
    if (!checked.plugins.includes(id)) continue
    // Like the Plugins page, persist the change even on hosts requiring a restart.
    const result = await settings.enable(id)
    if (result !== 'applied' && result !== 'restart-required') throw new Error(`Plugin enablement refused: ${id}`)
  }
  const mode = modes.find(({ id }) => id === checked.defaultMode) ?? modes[0]
  if (mode !== undefined) await settings.setDefault(mode.id)
  await settings.saveProfile({ ...profile, name: profile.name.trim() })
}

    return { roles, goalsFor, recommend, applySetup }
  },
})
