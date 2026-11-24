/**
 * ui-model-selection browser half on a real cordis Context with fake command/slots/
 * connection faces and real session scopes: the plugin mounts ModelDirectoryResolver
 * as `models`, the /model contribution and the conversation.input.model
 * seat both register, and BOTH entries resolve the SAME per-session
 * directory through the service — a selection submitted through the seat's
 * inject face is the current the popup's next options pass marks active
 * (and the reverse), the one-shared-state contract of the dual entry.
 * Scope disposal drops the directory (HMR safety).
 */
import { Context } from '@janhq/cordis'
import { describe, expect, it, vi } from 'vitest'
import { createScope } from '@janhq/jan-api-session-controller/client'
import type { SessionId } from '@janhq/jan-session/types'
import { LocaleRuntime } from '@janhq/jan-client-locale/client'
import { createSnapshotStore, type SnapshotStore } from '@janhq/jan-client-store'
import { RemoteError, TestRemote } from '@janhq/jan-client-test-runtime'
import type { ModelSelection } from '@janhq/jan-agent/types'
import type { ModelSelectionProjection } from '@janhq/jan-agent/types'
import { ReasoningEffortId } from '@janhq/jan-llm/brand'
import type { CommandContribution, PopupSelectSpec, SelectOption } from '@janhq/jan-client-ui-commands/client'
import type { ModelSelectInjected } from '../src/client/slots.ts'
import { apply, inject } from '../src/client/index.ts'
import { zh } from '../src/client/locales.ts'

const sid = (k: string): SessionId => k as SessionId

const GROUPS = [{
  id: 'example',
  name: 'Tokamak',
  models: [
    {
      id: 'tokamak-1-preview',
      name: 'Tokamak 1 Preview',
      description: 'Fast, efficient, and economical; suited to focused, routine, or parallel tasks.',
      reasoning: {
        efforts: [
          { id: 'off', name: 'Off' },
          { id: 'high', name: 'High' },
          { id: 'max', name: 'Max' },
        ],
        defaultEffort: 'high',
      },
    },
    {
      id: 'tokamak-1-pro',
      name: 'Tokamak 1 Pro',
      description: 'Stronger agentic coding, knowledge, and difficult reasoning; suited to complex or quality-critical tasks at higher cost.',
      reasoning: {
        efforts: [
          { id: 'off', name: 'Off' },
          { id: 'high', name: 'High' },
          { id: 'max', name: 'Max' },
        ],
        defaultEffort: 'high',
      },
    },
  ],
}, {
  id: 'external',
  name: 'External Provider',
  models: [{
    id: 'tokamak-1-preview',
    name: 'External Flash',
    description: 'Provider-authored description.',
  }],
}]

/** Boot the plugin over fake faces + a stateful fake host (current moves on selectModel). */
async function bench(locale: 'zh' | 'en' = 'zh') {
  const ctx = new Context()
  let defaultSelection: ModelSelection = { provider: 'example', model: 'tokamak-1-preview' }
  let selected = defaultSelection
  const calls = { models: 0, select: 0 }
  const projections = new Map<SessionId, SnapshotStore<ModelSelectionProjection | undefined>>()
  // Whether the Host advertises available models for the current route.
  let routable = true
  let catalogFailure = false
  let groups = GROUPS
  let failures: { id: string; name: string; message: string; code?: string }[] = []
  let selectionFailure: RemoteError<'session/writer-held'> | undefined
  const sessionRemote = {
    modelCatalog: () => {
      calls.models += 1
      if (catalogFailure) return Promise.reject(new Error('catalog offline'))
      return Promise.resolve({
        ok: true as const,
        value: {
          default: defaultSelection,
          routableProviders: routable ? ['example'] : [],
          groups: routable ? groups : [],
          failures,
        },
      })
    },
    selectModel: (payload: { sessionId: SessionId; provider: string; model: string; reasoningEffort?: string }) => {
      calls.select += 1
      if (selectionFailure !== undefined) return Promise.resolve({ ok: false as const, error: selectionFailure })
      selected = {
        provider: payload.provider,
        model: payload.model,
        ...payload.reasoningEffort === undefined
          ? {}
          : { reasoningEffort: ReasoningEffortId(payload.reasoningEffort) },
      }
      projections.get(payload.sessionId)?.set({ lastUsed: null, next: selected })
      return Promise.resolve({ ok: true as const, value: { selected } })
    },
  }
  const remote = Object.assign(new TestRemote(ctx), { session: sessionRemote })
  ctx.reflect.provide('remote.session', sessionRemote)
  const blocks = new Map<SessionId, { reason: string } | undefined>()
  ctx.provide('conversation', {
    blocks: {
      set: (id: SessionId, block: { reason: string } | undefined) => { blocks.set(id, block) },
    },
  })
  let contribution: CommandContribution | undefined
  ctx.provide('commandUi', {
    register(c: CommandContribution) {
      contribution = c
      return () => { contribution = undefined }
    },
  })
  const seats = new Map<string, {
    inject: ((sessionId: SessionId) => ModelSelectInjected) | undefined
    locale: string | undefined
  }>()
  ctx.provide('slots', {
    inject(_name: string, callback: () => () => void) { return callback() },
    register(options: { name: string; locale?: string; inject?: (sessionId: SessionId) => ModelSelectInjected }) {
      seats.set(options.name, { inject: options.inject, locale: options.locale })
      return () => { seats.delete(options.name) }
    },
  })
  const localeRuntime = new LocaleRuntime(ctx)
  // There is no jsdom `window` in this lane, so browser-language detection
  // never runs. Each bench states the locale its assertions require.
  localeRuntime.setLocale(locale)
  ctx.provide('locale', localeRuntime)
  const scopes = new Map<SessionId, Context>()
  const bindings = new Map<SessionId, {
    sessionId: SessionId
    session: {
      sessionId: SessionId
      getSnapshot: () => { blank: boolean }
      projections: { faceOf: () => SnapshotStore<ModelSelectionProjection | undefined> }
    }
    ctx: Context
  }>()
  const addressed = new Set<SessionId>()
  ctx.provide('sessions', {
    scope: (id: SessionId) => scopes.get(id),
    binding: (id: SessionId) => bindings.get(id),
    subagentAddress: (id: SessionId) => addressed.has(id)
      ? { parentSessionId: sid('parent'), childSessionId: id, mode: 'continuable' as const }
      : undefined,
  })
  const track = vi.fn()
  ctx.provide('productAnalytics', { enabled: true, track } as never)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  await ctx.plugin(function probe() {}).await()
  const mint = (key: string, blank = false) => {
    const id = sid(key)
    const handle = createScope(ctx, id)
    scopes.set(id, handle.ctx)
    const projection = createSnapshotStore<ModelSelectionProjection | undefined>({
      lastUsed: null,
      next: null,
    })
    projections.set(id, projection)
    const binding = {
      sessionId: id,
      session: { sessionId: id, getSnapshot: () => ({ blank }), projections: { faceOf: () => projection } },
      ctx: handle.ctx,
    }
    bindings.set(id, binding)
    handle.ctx.effect(() => () => {
      if (bindings.get(id) === binding) bindings.delete(id)
    })
    return { ...handle, projection }
  }
  return {
    ctx, fiber, mint, calls, remote, track,
    contribution: () => contribution!,
    popup: (): PopupSelectSpec => {
      const ui = contribution!.ui
      if (ui.kind !== 'popupSelect') throw new Error('expected the popupSelect kind')
      return ui
    },
    seat: () => seats.get('conversation.input.model')!,
    hostCurrent: () => selected,
    rejectSelection: () => {
      selectionFailure = new RemoteError('session/writer-held', 'writer held', { sessionId: sid('owned') })
    },
    setHostCurrent: (selection: ModelSelection) => { defaultSelection = selection },
    setProjected: (id: SessionId, value: ModelSelectionProjection) => { projections.get(id)?.set(value) },
    address: (id: SessionId) => { addressed.add(id) },
    setGroups: (next: typeof GROUPS) => { groups = next },
    setFailures: (next: typeof failures) => { failures = next },
    setCatalogFailure: (next: boolean) => { catalogFailure = next },
    setRoutable: (next: boolean) => { routable = next },
    blockOf: (key: string) => blocks.get(sid(key)),
  }
}

const projection = (id: string) => ({ sessionId: sid(id) })

describe('ui-model-selection dual entry', () => {
  it('carries writer contention to the model seat and localizes the command failure', async () => {
    const b = await bench()
    b.mint('owned')
    const input = projection('owned')
    const options = await b.popup().options(input, new AbortController().signal)
    b.rejectSelection()
    await expect(b.popup().onSelect(options[0]!, input)).rejects.toThrow(zh['error.sessionInUse'])
    expect(b.ctx.modelDirectories.directoryFor(sid('owned')).store.getSnapshot()).toMatchObject({
      status: 'error', pending: null, error: 'session/writer-held: writer held',
    })
  })

  it('registers the /model contribution and the composer model seat', async () => {
    const b = await bench()
    expect(b.contribution().name).toBe('model')
    expect(b.contribution().ui.kind).toBe('popupSelect')
    expect(b.seat().inject).toBeTypeOf('function')
    // Copy rides the standard locale seat.
    expect(b.seat().locale).toBe('model')
  })

  it('selects a catalog model from its inline argument without the popup', async () => {
    const b = await bench('en')
    b.mint('s1')
    const args = b.contribution().arguments!
    const session = projection('s1')
    expect(await args.complete('pro', session, new AbortController().signal)).toContainEqual({
      value: 'tokamak-1-pro', label: 'Tokamak 1 Pro', group: 'Tokamak',
    })
    await args.run('tokamak-1-pro', session)
    expect(b.hostCurrent()).toEqual({ provider: 'example', model: 'tokamak-1-pro', reasoningEffort: 'high' })
    expect(await args.complete('', session, new AbortController().signal)).toContainEqual({
      value: 'external/tokamak-1-preview', label: 'External Flash', group: 'External Provider',
    })
    await args.run('external/tokamak-1-preview', session)
    expect(b.hostCurrent()).toEqual({ provider: 'external', model: 'tokamak-1-preview' })
    await expect(args.run('missing-model', session)).rejects.toThrow('No matching models.')
  })

  it.each([['zh', '新'], ['en', 'New']] as const)('resolves seat badge text for the active %s locale', async (locale, expected) => {
    const b = await bench(locale)
    b.mint('s1')
    const face = b.seat().inject!(sid('s1'))
    expect(face.resolveText({ en: 'New', zh: '新' })).toBe(expected)
    expect(face.resolveText('1017')).toBe('1017')
  })

  it('lists provider failures as unselectable rows, asking for a sign-in when a credential is missing', async () => {
    const b = await bench('en')
    b.setFailures([
      { id: 'tokamak', name: 'Tokamak', message: 'no credential', code: 'MISSING_CREDENTIAL' },
      { id: 'gateway', name: 'Gateway', message: 'answered 503' },
    ])
    b.remote.emit('llm/adapters-updated', [])
    b.mint('s1')
    const options = await b.popup().options(projection('s1'), new AbortController().signal)
    expect(options.slice(-2).map(option => [option.label, option.detail])).toEqual([
      ['Tokamak', 'Sign in or add an API key to load models'],
      ['Gateway', 'Catalog failed to load: answered 503'],
    ])
  })

  it.each(['zh', 'en'] as const)('shows names and providers without catalog descriptions (%s)', async (locale) => {
    const b = await bench(locale)
    b.mint('s1')
    const options = await b.popup().options(projection('s1'), new AbortController().signal)
    expect(options.map((o: SelectOption) => o.label)).toEqual([
      'Tokamak 1 Preview', 'Tokamak 1 Pro', 'External Flash',
    ])
    expect(options.map(option => option.group?.label)).toEqual(['Tokamak', 'Tokamak', 'External Provider'])
    expect(options.every(option => option.detail === undefined)).toBe(true)
    expect(options[0]?.active).toBe(true)
    expect(options[1]?.active).toBeUndefined()
    expect(b.popup().searchLabels?.()).toEqual(locale === 'zh'
      ? { placeholder: '搜索模型…', empty: '还没有可用的模型。前往设置 -> 模型免费下载本地模型，在这台电脑上运行，无需账号。', noResults: '没有匹配的模型。' }
      : {
        placeholder: 'Search models…',
        empty: 'No models yet. Go to Settings -> Models to download a free local model that runs on this computer, no account needed.',
        noResults: 'No matching models.',
      })
  })

  it('lists popup provider groups in catalog order', async () => {
    const b = await bench()
    try {
      b.setGroups([GROUPS[1]!, GROUPS[0]!, { ...GROUPS[1]!, id: 'last-provider', name: 'Last Provider' }])
      b.remote.emit('llm/adapters-updated', [])
      b.mint('s1')
      const options = await b.popup().options(projection('s1'), new AbortController().signal)
      expect([...new Set(options.map(option => option.group?.name))])
        .toEqual(['external', 'example', 'last-provider'])
    } finally {
      await b.ctx.fiber.dispose()
    }
  })

  it('a seat selection is the current the popup marks active next — one shared state', async () => {
    const b = await bench()
    b.mint('s1')
    const seatFace = b.seat().inject!(sid('s1'))
    // Switch through the SEAT entry; the directory holds the submission until it settles.
    const selection = { provider: 'example', model: 'tokamak-1-pro', reasoningEffort: 'max' }
    const settled = seatFace.select(selection)
    expect(seatFace.directory.getSnapshot()).toMatchObject({ status: 'selecting', pending: selection })
    expect(await settled).toEqual({ ok: true, value: undefined })
    expect(seatFace.directory.getSnapshot()).toMatchObject({ status: 'ready', pending: null })
    expect(b.hostCurrent()).toEqual({
      provider: 'example',
      model: 'tokamak-1-pro',
      reasoningEffort: 'max',
    })
    expect(seatFace.directory.getSnapshot().current).toEqual({
      provider: 'example',
      model: 'tokamak-1-pro',
      reasoningEffort: 'max',
    })
    // The POPUP's next options pass reflects it without a seat-side reload.
    const options = await b.popup().options(projection('s1'), new AbortController().signal)
    expect(options.find((o: SelectOption) => o.label === 'Tokamak 1 Pro')).toMatchObject({ active: true })
  })

  it('a popup selection lands on the seat store — the reverse direction of the same state', async () => {
    const b = await bench()
    b.mint('s1')
    const seatFace = b.seat().inject!(sid('s1'))
    const options = await b.popup().options(projection('s1'), new AbortController().signal)
    const pro = options.find((o: SelectOption) => o.label === 'Tokamak 1 Pro')!
    await b.popup().onSelect(pro, projection('s1'))
    expect(seatFace.directory.getSnapshot().current).toEqual({
      provider: 'example',
      model: 'tokamak-1-pro',
      reasoningEffort: 'high',
    })
  })

  it('removes account models from the picker after sign-out', async () => {
    const b = await bench('en')
    try {
      b.setGroups([{ ...GROUPS[0]!, id: 'account', name: 'Account' }, ...GROUPS])
      b.remote.emit('llm/adapters-updated', [])
      b.mint('s1')
      const before = await b.popup().options(projection('s1'), new AbortController().signal)
      expect(before.some(option => option.group?.label === 'Account')).toBe(true)
      b.setGroups(GROUPS)
      b.remote.emit('credentials/record-updated', ['account-record'])
      await vi.waitFor(() => {
        expect(b.ctx.modelDirectories.directoryFor(sid('s1')).store.getSnapshot().groups).toEqual(GROUPS)
      })
      const after = await b.popup().options(projection('s1'), new AbortController().signal)
      expect(after.some(option => option.group?.label === 'Account')).toBe(false)
      expect(after.length).toBeGreaterThan(0)
    } finally {
      await b.ctx.fiber.dispose()
    }
  })

  it('both entries share one directory instance per session, isolated across sessions', async () => {
    const b = await bench()
    b.mint('a')
    b.mint('b')
    const faceA = b.seat().inject!(sid('a'))
    const faceA2 = b.seat().inject!(sid('a'))
    const faceB = b.seat().inject!(sid('b'))
    expect(faceA.directory).toBe(faceA2.directory)
    expect(faceA.directory).not.toBe(faceB.directory)
    // The service face resolves the same instance the seat inject handed out.
    expect(b.ctx.modelDirectories.directoryFor(sid('a')).store).toBe(faceA.directory)
    await Promise.all([
      b.popup().options(projection('a'), new AbortController().signal),
      b.popup().options(projection('b'), new AbortController().signal),
    ])
    expect(b.calls.models).toBe(1)
  })

  it('drops a pending selection on connection reset and ignores its late settlement', async () => {
    const b = await bench()
    b.mint('s1')
    const face = b.seat().inject!(sid('s1'))
    await b.ctx.modelDirectories.directoryFor(sid('s1')).load()
    const late = face.select({ provider: 'example', model: 'tokamak-1-pro' })
    expect(face.directory.getSnapshot().pending).toEqual({ provider: 'example', model: 'tokamak-1-pro' })
    b.ctx.emit('connection/reset')
    expect(face.directory.getSnapshot()).toMatchObject({ status: 'loading', pending: null })
    await late
    expect(face.directory.getSnapshot().pending).toBeNull()
  })

  it('hides the effective selection until the reconnected catalog validates it', async () => {
    const b = await bench()
    b.mint('s1')
    const face = b.seat().inject!(sid('s1'))
    await face.select({ provider: 'example', model: 'tokamak-1-pro' })
    b.setHostCurrent({ provider: 'example', model: 'tokamak-1-preview' })

    b.ctx.emit('connection/reset')
    expect(face.directory.getSnapshot()).toMatchObject({
      current: null,
      status: 'loading',
    })
    face.load()
    expect(face.directory.getSnapshot()).toMatchObject({
      current: null,
      status: 'loading',
    })
  })

  it('replaces and removes badges in an open directory on model catalog notifications', async () => {
    const b = await bench()
    try {
      b.mint('s1')
      const face = b.seat().inject!(sid('s1'))
      for (const badge of [{ text: 'New', tone: 'info' as const }, { text: 'Updated', tone: 'success' as const }, undefined]) {
        b.setGroups(GROUPS.map(group => ({
          ...group, models: group.models.map(model => ({ ...model, ...(badge === undefined ? {} : { badge }) })),
        })))
        b.remote.emit('llm/adapters-updated', [])
        await vi.waitFor(() => {
          expect(face.directory.getSnapshot().status).toBe('ready')
          expect(face.directory.getSnapshot().groups[0]?.models[0]?.badge).toEqual(badge)
        })
      }
      expect(face.directory.getSnapshot().current?.model).toBe('tokamak-1-preview')
    } finally {
      await b.ctx.fiber.dispose()
    }
  })

  it('retains the selected model while refreshing its catalog', async () => {
    const b = await bench()
    b.mint('s1')
    const face = b.seat().inject!(sid('s1'))
    face.load()
    expect(face.directory.getSnapshot().current?.model).toBe('tokamak-1-preview')

    b.remote.emit('settings/document-updated', ['llm-pi-ai', 1])
    b.setProjected(sid('s1'), {
      lastUsed: { provider: 'example', model: 'tokamak-1-preview' },
      next: { provider: 'example', model: 'tokamak-1-pro' },
    })
    expect(face.directory.getSnapshot()).toMatchObject({
      current: { provider: 'example', model: 'tokamak-1-preview' },
      groups: GROUPS,
      routable: null,
      status: 'loading',
    })

    await vi.waitFor(() => {
      expect(face.directory.getSnapshot()).toMatchObject({
        current: { provider: 'example', model: 'tokamak-1-pro' },
        status: 'ready',
      })
    })
  })

  it('retains the last catalog on refresh failure and recovers on retry', async () => {
    const b = await bench()
    try {
      b.mint('s1')
      const face = b.seat().inject!(sid('s1'))
      await b.ctx.modelDirectories.directoryFor(sid('s1')).load()
      b.setCatalogFailure(true)
      b.remote.emit('credentials/record-updated', ['TOKAMAK_API_KEY'])
      await vi.waitFor(() => {
        expect(face.directory.getSnapshot()).toMatchObject({
          current: { provider: 'example', model: 'tokamak-1-preview' },
          groups: GROUPS, routable: null, status: 'error', error: 'catalog offline',
        })
      })
      expect(b.blockOf('s1')).toBeUndefined()
      b.setCatalogFailure(false)
      await b.ctx.modelDirectories.directoryFor(sid('s1')).load()
      expect(face.directory.getSnapshot().routable).toBe(true)
      expect(b.blockOf('s1')).toBeUndefined()
    } finally {
      await b.ctx.fiber.dispose()
    }
  })

  it('scope disposal drops the directory; a reborn scope gets a fresh one', async () => {
    const b = await bench()
    const first = b.mint('s1')
    const face1 = b.seat().inject!(sid('s1'))
    await first.fiber.dispose()
    b.mint('s1')
    const face2 = b.seat().inject!(sid('s1'))
    expect(face2.directory).not.toBe(face1.directory)
  })

  it('retains saved effort for existing and new sessions after credentials disappear', async () => {
    const b = await bench()
    try {
      b.setHostCurrent({ provider: 'example', model: 'tokamak-1-preview', reasoningEffort: ReasoningEffortId('max') })
      b.mint('existing')
      const existing = b.ctx.modelDirectories.directoryFor(sid('existing'))
      await existing.load()
      b.setProjected(sid('existing'), { lastUsed: null,
        next: { provider: 'example', model: 'tokamak-1-preview', reasoningEffort: ReasoningEffortId('high') } })
      b.setRoutable(false)
      b.remote.emit('settings/document-updated', ['llm-pi-ai', 1])
      expect(existing.store.getSnapshot().retainedEffort).toBe('High')
      await vi.waitFor(() => {
        expect(existing.store.getSnapshot()).toMatchObject({ current: { provider: 'example', model: 'tokamak-1-preview', reasoningEffort: 'high' }, routable: false, retainedEffort: 'High' })
      })
      b.mint('new')
      const fresh = b.ctx.modelDirectories.directoryFor(sid('new'))
      expect(fresh.store.getSnapshot()).toMatchObject({ current: { provider: 'example', model: 'tokamak-1-preview', reasoningEffort: 'max' }, routable: false, retainedEffort: 'Max' })
    } finally {
      await b.ctx.fiber.dispose()
    }
  })

  it('keeps the composer usable when current catalog models disappear', async () => {
    const b = await bench()
    b.mint('s1')
    const face = b.seat().inject!(sid('s1'))

    expect(b.blockOf('s1')).toBeUndefined()
    face.load()
    await Promise.resolve()
    await Promise.resolve()
    expect(b.blockOf('s1')).toBeUndefined()
    expect(b.calls.models).toBe(1)

    b.setRoutable(false)
    b.remote.emit('settings/document-updated', ['llm-pi-ai', 1])
    await Promise.resolve()
    await Promise.resolve()
    expect(b.blockOf('s1')).toBeUndefined()
    expect(b.calls.models).toBe(2)

    // Recovering clears it without a reload of the surface.
    b.setRoutable(true)
    b.remote.emit('llm/adapters-updated', [])
    await Promise.resolve()
    await Promise.resolve()
    expect(b.blockOf('s1')).toBeUndefined()
    expect(b.calls.models).toBe(3)
  })

  it('retains an unavailable durable selection without replacing or rewriting it', async () => {
    const b = await bench()
    b.mint('s1')
    const face = b.seat().inject!(sid('s1'))
    const intended = { provider: 'example', model: 'unlisted' }
    b.setProjected(sid('s1'), { lastUsed: intended, next: intended })
    await vi.waitFor(() => { expect(face.directory.getSnapshot().status).toBe('ready') })
    expect(face.directory.getSnapshot().current).toEqual(intended)
    expect(b.blockOf('s1')).toBeUndefined()
    expect(b.calls.select).toBe(0)
  })

  it('an unknown session fails loud at the seat inject', async () => {
    const b = await bench()
    expect(() => b.seat().inject!(sid('ghost'))).toThrow(/resolved no scope/)
  })

  it('withholds both model entries from addressed subagent sessions without Agent-bound RPCs', async () => {
    const b = await bench()
    b.mint('child')
    b.address(sid('child'))

    expect(b.contribution().available(projection('child'))).toBe(false)
    await expect(b.popup().options(
      projection('child'),
      new AbortController().signal,
    )).rejects.toThrow(/unavailable for addressed subagent/)

    const face = b.seat().inject!(sid('child'))
    expect(face.available).toBe(false)
    face.load()
    await expect(face.select({ provider: 'tokamak', model: 'tokamak-1-pro' })).resolves.toBeUndefined()
    await expect(b.ctx.modelDirectories.directoryFor(sid('child')).load())
      .rejects.toThrow(/unavailable for addressed subagent/)
    await expect(b.ctx.modelDirectories.directoryFor(sid('child')).select({
      provider: 'tokamak',
      model: 'tokamak-1-pro',
    })).rejects.toThrow(/unavailable for addressed subagent/)
    b.ctx.emit('connection/reset')
    await Promise.resolve()
    expect(b.calls).toEqual({ models: 2, select: 0 })
  })
})


it.each([false, true])('reports accepted switches with blank=%s and no refused switch', async (blank) => {
  const b = await bench('en')
  const scope = b.mint('analytics', blank)
  try {
    const face = b.seat().inject!(sid('analytics'))
    await face.select({ provider: 'example', model: 'tokamak-1-pro', reasoningEffort: ReasoningEffortId('max') })
    expect(b.track).toHaveBeenCalledWith('model_switch', { ...blank ? {} : { session_id: 'analytics' }, switch_from: 'example/tokamak-1-preview', switch_to: 'example/tokamak-1-pro' })
    b.track.mockClear()
    await face.select({ provider: 'example', model: 'tokamak-1-pro', reasoningEffort: 'high' })
    expect(b.track).toHaveBeenCalledExactlyOnceWith('thinking_level_switch', {
      ...blank ? {} : { session_id: 'analytics' }, model_name: 'example/tokamak-1-pro', switch_from: 'max', switch_to: 'high',
    })
    b.track.mockClear()
    b.rejectSelection()
    await face.select({ provider: 'example', model: 'tokamak-1-preview' })
    expect(b.track).not.toHaveBeenCalled()
  } finally { await scope.fiber.dispose(); await b.ctx.fiber.dispose() }
})
