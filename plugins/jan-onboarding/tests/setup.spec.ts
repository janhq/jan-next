import { beforeAll, describe, expect, it } from 'vitest'

type Recommendation = { id: string; copy: string }
type Bundle = { name: string; enabled: boolean; availability: string }
type Catalog = { presets: string[]; bundles: Bundle[] }
type Selection = { modes: Recommendation[]; plugins: Recommendation[] }
type Profile = { name: string; roles: string[]; goals: string[] }
type Operations = {
  enable(name: string): Promise<string>
  setDefault(id: string): Promise<void>
  saveProfile(profile: Profile): Promise<void>
}
type Setup = {
  roles: string[]
  goalsFor(roles: string[]): string[]
  recommend(roles: string[], catalog: Catalog): Selection
  recommendModel(roles: string[], goals: string[], localAvailable: boolean): { route: string; reason: string }
  applySetup(operations: Operations, profile: Profile, options: Selection,
    checked: { plugins: string[]; modes: string[]; defaultMode: string }): Promise<void>
}
let setup: Setup

beforeAll(async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { __ModuleLoader__: {
    load({ factory }: { factory: () => Setup }) { setup = factory() },
  } } })
  try {
    // The classic script registers its factory on the loader above during evaluation.
    await import('../client.setup.js')
  } finally {
    if (previous === undefined) Reflect.deleteProperty(globalThis, 'window')
    else Object.defineProperty(globalThis, 'window', previous)
  }
})

const worktrees = '@janhq/jan-experimental-tool-worktree'
const search = '@janhq/jan-experimental-session-search'
const titles = '@janhq/jan-experimental-session-titles-bundle'
const voice = '@janhq/jan-experimental-voice-input-bundle'
const bundle = (name: string, enabled = false) => ({ name, enabled, availability: 'installation' })
const catalog = { presets: ['chat', 'standard'], bundles: [worktrees, search, titles, voice].map(name => bundle(name)) }

function actualSettings(bundles = catalog.bundles) {
  const installed = new Map(bundles.map(row => [row.name, { ...row }]))
  const data = { mode: 'chat', profile: undefined as object | undefined }
  const enable = async (name: string) => {
    const row = installed.get(name)
    if (row === undefined) throw new Error('unknown plugin')
    row.enabled = true
    return 'applied'
  }
  return { installed, data, enable,
    setDefault: async (id: string) => { data.mode = id },
    saveProfile: async (profile: object) => { data.profile = profile },
  }
}

describe('onboarding setup', () => {
  it('filters goals by role and recommends different shipped setups', () => {
    expect(setup.roles).toHaveLength(8)
    expect(setup.goalsFor(['developer', 'researcher'])).toEqual(['code', 'debug', 'research', 'analyze'])
    expect(setup.goalsFor(['student', 'researcher'])).toEqual(['learn', 'research', 'analyze'])
    const developer = setup.recommend(['developer'], catalog)
    expect(developer.modes[0]?.id).toBe('standard')
    expect(developer.plugins.map(row => row.id)).toEqual([worktrees, search])
    const writer = setup.recommend(['writer'], catalog)
    expect(writer.modes[0]?.id).toBe('chat')
    expect(writer.plugins.map(row => row.id)).toEqual([voice, search])
  })

  it('deduplicates recommendations and never includes unavailable or pre-enabled bundles', () => {
    const result = setup.recommend(['developer', 'writer'], { presets: ['chat'], bundles: [
      bundle(worktrees, true), { ...bundle(voice), availability: 'missing' }, bundle(search),
    ] })
    expect(result.modes.map(row => row.id)).toEqual(['chat'])
    expect(result.plugins.map(row => row.id)).toEqual([search])
  })

  it('enables only the checked recommendations, preserves existing plugins, and persists the chosen default', async () => {
    const settings = actualSettings([...catalog.bundles.slice(0, 2), bundle(titles, true), catalog.bundles[3]!])
    const options = setup.recommend(['developer', 'writer'], catalog)
    const profile = { name: ' Ada ', roles: ['developer', 'writer'], goals: ['code', 'draft'] }
    await setup.applySetup(settings, profile, options, { plugins: [worktrees, 'unlisted'], modes: ['chat', 'standard'], defaultMode: 'standard' })
    expect([...settings.installed.values()].map(row => [row.name, row.enabled])).toEqual([
      [worktrees, true], [search, false], [titles, true], [voice, false],
    ])
    expect(settings.data).toEqual({ mode: 'standard', profile: { ...profile, name: 'Ada' } })
  })

  it('leaves the default unchanged when every mode is unchecked', async () => {
    const settings = actualSettings()
    await setup.applySetup(settings, { name: '', roles: ['developer'], goals: [] }, setup.recommend(['developer'], catalog),
      { plugins: [], modes: [], defaultMode: 'standard' })
    expect(settings.data.mode).toBe('chat')
    expect(settings.data.profile).toEqual({ name: '', roles: ['developer'], goals: [] })
  })

  it('does not report completion or change the default when an enablement is refused', async () => {
    const settings = actualSettings()
    await expect(setup.applySetup({ ...settings, enable: async () => 'overridden' }, { name: '', roles: ['developer'], goals: [] },
      setup.recommend(['developer'], catalog), { plugins: [worktrees], modes: ['standard'], defaultMode: 'standard' })).rejects.toThrow()
    expect(settings.data).toEqual({ mode: 'chat', profile: undefined })
  })

  it('suggests a hosted model for demanding work and the local model only for light work it can run', () => {
    expect(setup.recommendModel(['developer'], [], true)).toEqual({ route: 'account', reason: 'demanding' })
    expect(setup.recommendModel(['writer'], ['draft'], true)).toEqual({ route: 'local', reason: 'light' })
    expect(setup.recommendModel(['student'], ['learn', 'research'], true).route).toBe('account')
    expect(setup.recommendModel(['writer'], ['draft'], false)).toEqual({ route: 'account', reason: 'light' })
  })
})
