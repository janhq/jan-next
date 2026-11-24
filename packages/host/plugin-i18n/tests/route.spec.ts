import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@janhq/cordis'
import { chooseRoute, routeChoices } from '../src/route.ts'

interface Fixture {
  /** Provider routes with an adapter, each with the models its catalog lists. */
  providers: Record<string, string[]>
  /** The default model selection. */
  fallbackDefault: { provider: string; model: string }
  /** Model ids that cannot be resolved, as `provider/model`. */
  broken?: string[]
  /** The managed local models service, when mounted. */
  local?: { provider: string; models: { id: string; active: boolean; status: string }[] }
}

/** A context exposing only what route selection reads. */
function contextOf(fixture: Fixture): Context {
  const services: Record<string, unknown> = {
    llm: {
      listProviders: () => Object.keys(fixture.providers).map(id => ({ id, name: id })),
      listModels: (provider: string) => Promise.resolve(
        (fixture.providers[provider] ?? []).map(id => ({ provider, id, name: id.toUpperCase() })),
      ),
      resolveModelInfo: (provider: string, model: string) => (fixture.broken ?? []).includes(`${provider}/${model}`)
        ? Promise.reject(new Error('unknown model'))
        : Promise.resolve({ provider, id: model, name: model }),
    },
    agentDefaultModel: { currentSelection: () => fixture.fallbackDefault },
    llamaCpp: fixture.local === undefined ? undefined : { snapshot: () => fixture.local },
  }
  return { ...services, get: (name: string) => services[name] } as never
}

describe('chooseRoute', () => {
  const base: Fixture = {
    providers: { openai: ['gpt'], local: ['a', 'b'] },
    fallbackDefault: { provider: 'openai', model: 'gpt' },
    local: { provider: 'local', models: [{ id: 'a', active: false, status: 'unloaded' }, { id: 'b', active: false, status: 'loaded' }] },
  }

  it('uses the default model when it resolves', async () => {
    expect(await chooseRoute(contextOf(base), undefined)).toEqual({ provider: 'openai', model: 'gpt', source: 'default' })
  })

  it('prefers a saved pick over the default model', async () => {
    expect(await chooseRoute(contextOf(base), { provider: 'local', model: 'a' })).toEqual({ provider: 'local', model: 'a', source: 'saved' })
  })

  it('falls back from a saved pick that no longer resolves to the default model', async () => {
    const ctx = contextOf({ ...base, broken: ['local/a'] })
    expect(await chooseRoute(ctx, { provider: 'local', model: 'a' })).toEqual({ provider: 'openai', model: 'gpt', source: 'default' })
  })

  it('falls back to a loaded local model when the default model cannot be used', async () => {
    const ctx = contextOf({ ...base, broken: ['openai/gpt'] })
    expect(await chooseRoute(ctx, undefined)).toEqual({ provider: 'local', model: 'b', source: 'loaded-local' })
  })

  it('tries the loaded default local model first, then the other loaded ones', async () => {
    const local = { provider: 'local', models: [{ id: 'a', active: false, status: 'loaded' }, { id: 'b', active: true, status: 'loaded' }] }
    const ctx = contextOf({ ...base, local, broken: ['openai/gpt'] })
    expect(await chooseRoute(ctx, undefined)).toMatchObject({ model: 'b', source: 'loaded-local' })
    expect(await chooseRoute(contextOf({ ...base, local, broken: ['openai/gpt', 'local/b'] }), undefined)).toMatchObject({ model: 'a', source: 'loaded-local' })
  })

  it('falls back to any configured model when the default is unusable and no local model is loaded', async () => {
    const ctx = contextOf({
      providers: { anthropic: ['claude'], local: ['a'] },
      fallbackDefault: { provider: 'gone', model: 'x' },
      local: { provider: 'local', models: [{ id: 'a', active: true, status: 'unloaded' }] },
    })
    expect(await chooseRoute(ctx, undefined)).toEqual({ provider: 'anthropic', model: 'claude', source: 'configured' })
  })

  it('falls back when the default model names no provider, as when none is configured', async () => {
    const ctx = contextOf({ providers: { anthropic: ['claude'] }, fallbackDefault: { provider: '', model: '' } })
    expect(await chooseRoute(ctx, undefined)).toMatchObject({ provider: 'anthropic', model: 'claude', source: 'configured' })
  })

  it('returns the default model unchecked when nothing resolves, so the request reports its own failure', async () => {
    const ctx = contextOf({ providers: {}, fallbackDefault: { provider: 'openai', model: 'gpt' } })
    expect(await chooseRoute(ctx, undefined)).toEqual({ provider: 'openai', model: 'gpt', source: 'default' })
  })

  it('returns the default route within ten seconds even when consecutive probes time out', async () => {
    vi.useFakeTimers()
    try {
      const fallbackDefault = { provider: 'gone', model: 'x' }
      const ctx = contextOf({
        providers: { offline: ['a', 'b', 'c', 'd', 'e'], online: ['f'] },
        fallbackDefault,
      })
      vi.spyOn(ctx.llm, 'resolveModelInfo').mockImplementation((provider, model) =>
        provider === 'offline' ? new Promise(() => {}) : Promise.resolve({ provider, id: model, name: model }),
      )
      const result = vi.fn()
      void chooseRoute(ctx, undefined).then(result)

      await vi.advanceTimersByTimeAsync(10_000)

      expect(result).toHaveBeenCalledExactlyOnceWith({ ...fallbackDefault, source: 'default' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('works without a managed local models service', async () => {
    const { local: _local, ...withoutLocal } = base
    const ctx = contextOf({ ...withoutLocal, broken: ['openai/gpt'] })
    expect(await chooseRoute(ctx, undefined)).toMatchObject({ provider: 'local', model: 'a', source: 'configured' })
  })
})

describe('routeChoices', () => {
  it('returns picker choices within the route deadline when a catalog stalls', async () => {
    vi.useFakeTimers()
    try {
      const fallbackDefault = { provider: 'online', model: 'a' }
      const ctx = contextOf({ providers: { online: ['a'], offline: ['b'] }, fallbackDefault })
      const listModels = ctx.llm.listModels.bind(ctx.llm)
      vi.spyOn(ctx.llm, 'listModels').mockImplementation(provider =>
        provider === 'offline' ? new Promise(() => {}) : listModels(provider),
      )
      const result = vi.fn()
      void routeChoices(ctx, undefined).then(result)

      await vi.advanceTimersByTimeAsync(10_000)

      expect(result).toHaveBeenCalledExactlyOnceWith({
        route: { ...fallbackDefault, source: 'default' },
        saved: null,
        default: { ...fallbackDefault, usable: true },
        models: [{ ...fallbackDefault, name: 'A', local: false, loaded: false }],
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('lists local models first with their loaded state, and reports the default model and the saved pick', async () => {
    const ctx = contextOf({
      providers: { openai: ['gpt'], local: ['a', 'b'] },
      fallbackDefault: { provider: 'openai', model: 'gpt' },
      broken: ['openai/gpt'],
      local: { provider: 'local', models: [{ id: 'a', active: false, status: 'unloaded' }, { id: 'b', active: false, status: 'loaded' }] },
    })
    expect(await routeChoices(ctx, { provider: 'openai', model: 'gpt' })).toEqual({
      route: { provider: 'local', model: 'b', source: 'loaded-local' },
      saved: { provider: 'openai', model: 'gpt' },
      default: { provider: 'openai', model: 'gpt', usable: false },
      models: [
        { provider: 'local', model: 'b', name: 'B', local: true, loaded: true },
        { provider: 'local', model: 'a', name: 'A', local: true, loaded: false },
        { provider: 'openai', model: 'gpt', name: 'GPT', local: false, loaded: false },
      ],
    })
  })
})
