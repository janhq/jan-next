import { beforeAll, describe, expect, it } from 'vitest'

type Recommendation = { id: string; copy: string }
type Bundle = { name: string; enabled: boolean; availability: string }
type Catalog = { presets: string[]; bundles: Bundle[] }
type Selection = { modes: Recommendation[]; plugins: Recommendation[] }
type Profile = { name: string; roles: string[]; goals: string[]; mode?: string }
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
  applyAssistant(operations: Operations & { enablePlugin(name: string): Promise<string>; layout(kind: string): void }, profile: Profile): Promise<string>
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

const bots = '@janhq/jan-always-on'

function actualSettings(bundles = catalog.bundles) {
  const installed = new Map(bundles.map(row => [row.name, { ...row }]))
  const data = { mode: 'chat', profile: undefined as object | undefined, layout: undefined as string | undefined }
  const enable = async (name: string) => {
    const row = installed.get(name)
    if (row === undefined) throw new Error('unknown plugin')
    row.enabled = true
    return 'applied'
  }
  return { installed, data, enable, enablePlugin: enable,
    setDefault: async (id: string) => { data.mode = id },
    saveProfile: async (profile: object) => { data.profile = profile },
    layout: (kind: string) => { data.layout = kind },
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
    expect(settings.data).toEqual({ mode: 'standard', profile: { ...profile, name: 'Ada', mode: 'workspace' }, layout: undefined })
  })

  it('leaves the default unchanged when every mode is unchecked', async () => {
    const settings = actualSettings()
    await setup.applySetup(settings, { name: '', roles: ['developer'], goals: [] }, setup.recommend(['developer'], catalog),
      { plugins: [], modes: [], defaultMode: 'standard' })
    expect(settings.data.mode).toBe('chat')
    expect(settings.data.profile).toEqual({ name: '', roles: ['developer'], goals: [], mode: 'workspace' })
  })

  it('does not report completion or change the default when an enablement is refused', async () => {
    const settings = actualSettings()
    await expect(setup.applySetup({ ...settings, enable: async () => 'overridden' }, { name: '', roles: ['developer'], goals: [] },
      setup.recommend(['developer'], catalog), { plugins: [worktrees], modes: ['standard'], defaultMode: 'standard' })).rejects.toThrow()
    expect(settings.data).toEqual({ mode: 'chat', profile: undefined, layout: undefined })
  })

  it('Assistant mode turns on Bots, keeps the short sidebar, and saves the answer', async () => {
    const settings = actualSettings([...catalog.bundles, bundle(bots)])
    const profile = { name: ' Ada ', roles: ['office'], goals: [] }
    await expect(setup.applyAssistant(settings, profile)).resolves.toBe('applied')
    expect(settings.installed.get(bots)?.enabled).toBe(true)
    expect([...settings.installed.values()].filter(row => row.enabled).map(row => row.name)).toEqual([bots])
    expect(settings.data).toEqual({ mode: 'chat', profile: { ...profile, name: 'Ada', mode: 'assistant' }, layout: 'assistant' })
  })

  it('Assistant mode reports a pending restart and changes nothing when Bots is refused', async () => {
    const pending = actualSettings()
    await expect(setup.applyAssistant({ ...pending, enablePlugin: async () => 'restart-required' }, { name: '', roles: [], goals: [] }))
      .resolves.toBe('restart-required')
    expect(pending.data.layout).toBe('assistant')
    const refused = actualSettings()
    await expect(setup.applyAssistant({ ...refused, enablePlugin: async () => 'failed' }, { name: '', roles: [], goals: [] })).rejects.toThrow()
    expect(refused.data).toEqual({ mode: 'chat', profile: undefined, layout: undefined })
  })

  it('suggests a hosted model for demanding work and the local model only for light work it can run', () => {
    expect(setup.recommendModel(['developer'], [], true)).toEqual({ route: 'account', reason: 'demanding' })
    expect(setup.recommendModel(['writer'], ['draft'], true)).toEqual({ route: 'local', reason: 'light' })
    expect(setup.recommendModel(['student'], ['learn', 'research'], true).route).toBe('account')
    expect(setup.recommendModel(['writer'], ['draft'], false)).toEqual({ route: 'account', reason: 'light' })
  })
})
