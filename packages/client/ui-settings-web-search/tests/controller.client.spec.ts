import { describe, expect, it, vi } from 'vitest'
import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import { RemoteError, stubConfigForm, type StubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import { WebSearchCardController, type WebProviderSelection } from '../src/client/web-search-card-controller.ts'

/** Make the stub behave like a Host that accepts every write. */
function acceptWrites<T>(host: StubConfigForm<T>): void {
  const section = (): Record<string, unknown> => ({ ...host.scope.getSnapshot().value as object })
  const layer = (): Record<string, unknown> => ({ ...host.scope.getSnapshot().user as object })
  host.mutate.mockImplementation((ops: readonly SettingsPathOpView[]) => {
    const value = { ...section() }
    const user = { ...layer() }
    for (const op of ops) {
      const field = op.path[0]!
      if (op.op === 'set') {
        value[field] = op.value
        user[field] = op.value
      } else {
        Reflect.deleteProperty(user, field)
        value[field] = (host.scope.getSnapshot().base as Record<string, unknown> | undefined)?.[field]
      }
    }
    host.publish({ value: value as T, user })
    return Promise.resolve(true)
  })
}

/** The card plugin's context, scripted down to the namespaces a card reaches. */
function ctxWith(namespaces: object) {
  return { remote: namespaces } as never
}

/** Providers the shipped composition registers, in registration order. */
const SHIPPED_PROVIDERS = {
  search: [{ id: 'exa' }],
  fetch: [{ id: 'exa' }, { id: 'http' }],
}

type ProviderEntry = { id: string; title?: string; description?: { en: string; [locale: string]: string } }
type ProviderList = { search: ProviderEntry[]; fetch: ProviderEntry[] }
type ProviderResponse = { ok: true; value: ProviderList } | { ok: false; error: RemoteError }

function remoteApi() {
  const listProviders = vi.fn((): Promise<ProviderResponse> => Promise.resolve({ ok: true, value: SHIPPED_PROVIDERS }))
  return { ctx: ctxWith({ web: { listProviders } }), listProviders }
}

/** The shipped composition's selection: Exa search and local HTTP fetch. */
const SHIPPED_SELECTION = { searchProvider: 'exa', fetchProvider: 'http' }

/**
 * Mount the controller over a stub selection scope.
 * @param options - whether the Host accepts writes, and a replacement context.
 * @returns the scope, the controller, its face, and a state reader.
 */
function bench(options: { accept?: boolean; ctx?: never } = {}) {
  const web = stubConfigForm<WebProviderSelection>()
  if (options.accept === true) acceptWrites(web)
  const remote = remoteApi()
  const controller = new WebSearchCardController({ web: web.scope }, options.ctx ?? remote.ctx)
  const face = controller.inject()
  return { web, remote, controller, face, state: () => face.hooks.webSearchCard.getSnapshot() }
}

/** Selection layers a scenario overrides. */
type SelectionLayers = { value?: WebProviderSelection; base?: WebProviderSelection; user?: WebProviderSelection }

/** Serve the selection, shipped unless one is given, with no user layer. */
function serve(b: ReturnType<typeof bench>, selection: SelectionLayers = {}): void {
  b.web.publish({ status: 'ready', writable: true, value: SHIPPED_SELECTION, base: SHIPPED_SELECTION, user: {}, ...selection })
}

/** The shipped providers plus the plugin providers `brave` (Search) and `jina` (Fetch). */
const WITH_PLUGINS = {
  search: [...SHIPPED_PROVIDERS.search, { id: 'brave' }],
  fetch: [...SHIPPED_PROVIDERS.fetch, { id: 'jina' }],
}

describe('WebSearchCardController providers', () => {
  it('lists local fetch first and every other provider in Host order', async () => {
    const b = bench()
    try {
      b.remote.listProviders.mockResolvedValue({
        ok: true,
        value: { search: [{ id: 'exa' }, { id: 'brave' }], fetch: [{ id: 'jina' }, { id: 'exa' }, { id: 'http' }] },
      })
      b.controller.refreshProviders()
      serve(b, { value: { searchProvider: 'perplexity', fetchProvider: 'http' } })
      await vi.waitFor(() => { expect(b.state().search.options).toHaveLength(3) })
      expect(b.state().search.options).toEqual([
        { id: 'exa', missing: false }, { id: 'brave', missing: false }, { id: 'perplexity', missing: true },
      ])
      expect(b.state().fetch.options.map(option => option.id)).toEqual(['http', 'jina', 'exa'])
    } finally { b.controller.dispose() }
  })

  it('omits local fetch from the fixed order while the Host does not register it', async () => {
    const b = bench()
    try {
      b.remote.listProviders.mockResolvedValue({ ok: true, value: { search: [{ id: 'exa' }], fetch: [{ id: 'jina' }] } })
      b.controller.refreshProviders()
      serve(b, { value: { searchProvider: 'exa', fetchProvider: 'jina' } })
      await vi.waitFor(() => { expect(b.state().fetch.options.map(option => option.id)).toEqual(['jina']) })
    } finally { b.controller.dispose() }
  })

  it('resolves a provider description through the locale service', () => {
    const { listProviders } = remoteApi()
    const resolveText = vi.fn(() => 'resolved')
    const b = bench({ ctx: { remote: { web: { listProviders } }, locale: { resolveText } } as never })
    try {
      const description = { en: 'English.', zh: '中文' }
      expect(b.face.resolveText(description)).toBe('resolved')
      expect(resolveText).toHaveBeenCalledExactlyOnceWith(description)
    } finally { b.controller.dispose() }
  })

  it('shows a plugin selection with its registered title and description', async () => {
    const b = bench()
    try {
      b.remote.listProviders.mockResolvedValue({
        ok: true, value: { search: [{ id: 'exa', title: 'Exa', description: { en: 'Exa search.', zh: 'Exa 搜索' } }], fetch: SHIPPED_PROVIDERS.fetch },
      })
      b.controller.refreshProviders()
      serve(b)
      await vi.waitFor(() => { expect(b.state().search.kind).toBe('plugin') })
      expect(b.state().search).toMatchObject({
        selected: 'exa', options: [{ id: 'exa', title: 'Exa', description: { en: 'Exa search.', zh: 'Exa 搜索' }, missing: false }],
      })
      expect(b.state().fetch).toMatchObject({ selected: 'http', kind: 'local' })
      b.remote.listProviders.mockResolvedValue({ ok: true, value: WITH_PLUGINS })
      b.controller.refreshProviders()
      b.face.selectProvider('fetchProvider', 'jina')
      await vi.waitFor(() => { expect(b.state().fetch).toMatchObject({ selected: 'jina', kind: 'plugin' }) })
    } finally { b.controller.dispose() }
  })

  it('adds a selected provider the Host does not register without changing the selection', async () => {
    const b = bench()
    try {
      serve(b, { value: { searchProvider: 'perplexity', fetchProvider: 'jina' } })
      await vi.waitFor(() => { expect(b.remote.listProviders).toHaveBeenCalled() })
      await vi.waitFor(() => { expect(b.state().search.options).toHaveLength(2) })
      expect(b.state().search).toMatchObject({ selected: 'perplexity', kind: 'none', options: [{}, { id: 'perplexity', missing: true }] })
      expect(b.state().fetch).toMatchObject({ selected: 'jina', kind: 'none', options: [{}, {}, { id: 'jina', missing: true }] })
      expect(b.state().dirty).toBe(false)
    } finally { b.controller.dispose() }
  })

  it('treats local fetch as not loaded while the Host does not register it', async () => {
    const b = bench()
    try {
      b.remote.listProviders.mockResolvedValue({ ok: true, value: { search: [{ id: 'exa' }], fetch: [] } })
      b.controller.refreshProviders()
      serve(b)
      await vi.waitFor(() => { expect(b.state().fetch.options).toEqual([{ id: 'http', missing: true }]) })
      expect(b.state().fetch.kind).toBe('none')
    } finally { b.controller.dispose() }
  })

  it('keeps the last list when a provider read fails', async () => {
    const b = bench()
    try {
      b.remote.listProviders.mockResolvedValue({ ok: true, value: WITH_PLUGINS })
      serve(b)
      await vi.waitFor(() => { expect(b.state().search.options).toHaveLength(2) })
      b.remote.listProviders.mockResolvedValueOnce({ ok: false, error: new RemoteError('gateway/internal', 'down', {}) })
      b.controller.refreshProviders()
      await vi.waitFor(() => { expect(b.remote.listProviders).toHaveBeenCalledTimes(3) })
      await vi.waitFor(() => { expect(b.state().providersFailed).toBe(true) })
      expect(b.state().search.options.map(option => option.id)).toEqual(['exa', 'brave'])
      b.face.retryProviders()
      await vi.waitFor(() => { expect(b.state().providersFailed).toBe(false) })
      expect(b.remote.listProviders).toHaveBeenCalledTimes(4)
    } finally { b.controller.dispose() }
  })

  it('reports a failed first read without claiming the menu is complete, and recovers on retry', async () => {
    const b = bench()
    try {
      b.remote.listProviders.mockResolvedValue({ ok: false, error: new RemoteError('gateway/internal', 'down', {}) })
      b.controller.refreshProviders()
      serve(b)
      await vi.waitFor(() => { expect(b.state().providersFailed).toBe(true) })
      expect(b.state().search).toMatchObject({ options: [{ id: 'exa', missing: false }], kind: 'none' })
      expect(b.state().fetch).toMatchObject({ options: [{ id: 'http', missing: false }], kind: 'local' })
      b.remote.listProviders.mockResolvedValue({ ok: true, value: WITH_PLUGINS })
      b.face.retryProviders()
      await vi.waitFor(() => { expect(b.state()).toMatchObject({ providersFailed: false, search: { kind: 'plugin' } }) })
      expect(b.state().search.options).toHaveLength(2)
    } finally { b.controller.dispose() }
  })

  it('ignores a failure answered for a superseded read', async () => {
    const stale = Promise.withResolvers<ProviderResponse>()
    const b = bench()
    try {
      serve(b)
      b.remote.listProviders.mockImplementationOnce(() => stale.promise)
      b.controller.refreshProviders()
      b.face.retryProviders()
      await vi.waitFor(() => { expect(b.state().fetch.options).toHaveLength(2) })
      stale.resolve({ ok: false, error: new RemoteError('gateway/internal', 'down', {}) })
      await Promise.resolve()
      expect(b.state().providersFailed).toBe(false)
    } finally { b.controller.dispose() }
  })

  it('renders an unread list as the selected id alone', () => {
    const listProviders = vi.fn(() => new Promise<ProviderResponse>(() => {}))
    const b = bench({ ctx: ctxWith({ web: { listProviders } }) })
    try {
      serve(b)
      expect(b.state().search).toMatchObject({ options: [{ id: 'exa', missing: false }], kind: 'none' })
      expect(b.state().fetch).toMatchObject({ options: [{ id: 'http', missing: false }], kind: 'local' })
      b.web.publish({ value: { fetchProvider: 'jina' } })
      expect(b.state().search).toMatchObject({ selected: '', options: [], kind: 'none' })
      expect(b.state().fetch).toMatchObject({ options: [{ id: 'jina', missing: false }], kind: 'none' })
    } finally { b.controller.dispose() }
  })

  it('publishes only the latest provider read', async () => {
    const stale = Promise.withResolvers<ProviderResponse>()
    const b = bench()
    try {
      serve(b)
      b.remote.listProviders.mockImplementationOnce(() => stale.promise)
      b.controller.refreshProviders()
      b.remote.listProviders.mockResolvedValueOnce({ ok: true, value: { search: [{ id: 'brave' }], fetch: [] } })
      b.controller.refreshProviders()
      await vi.waitFor(() => { expect(b.state().search.options.map(option => option.id)).toEqual(['brave', 'exa']) })
      stale.resolve({ ok: true, value: SHIPPED_PROVIDERS })
      await Promise.resolve()
      expect(b.state().search.options.map(option => option.id)).toEqual(['brave', 'exa'])
    } finally { b.controller.dispose() }
  })

  it('re-reads the providers when the Host starts serving the selection', async () => {
    const b = bench()
    try {
      await Promise.resolve()
      expect(b.remote.listProviders).toHaveBeenCalledTimes(1)
      serve(b)
      expect(b.remote.listProviders).toHaveBeenCalledTimes(2)
      serve(b)
      expect(b.remote.listProviders).toHaveBeenCalledTimes(2)
      b.web.publish({ status: 'unavailable' })
      b.web.publish({ status: 'ready' })
      expect(b.remote.listProviders).toHaveBeenCalledTimes(3)
    } finally { b.controller.dispose() }
  })

  it('discards late answers and refreshes after disposal', async () => {
    const providers = Promise.withResolvers<ProviderResponse>()
    const b = bench()
    const publish = vi.fn()
    const off = b.face.hooks.webSearchCard.subscribe(publish)
    try {
      serve(b)
      b.remote.listProviders.mockImplementationOnce(() => providers.promise)
      b.controller.refreshProviders()
      b.controller.dispose()
      const listed = b.remote.listProviders.mock.calls.length
      publish.mockClear()
      providers.resolve({ ok: true, value: { search: [], fetch: [] } })
      await Promise.resolve()
      await Promise.resolve()
      expect(publish).not.toHaveBeenCalled()
      b.controller.refreshProviders()
      await Promise.resolve()
      expect(b.remote.listProviders).toHaveBeenCalledTimes(listed)
    } finally {
      off()
      providers.resolve({ ok: true, value: { search: [], fetch: [] } })
      await providers.promise
    }
  })
})

describe('WebSearchCardController provider selection', () => {
  it('selects Search and Fetch independently and clears a selection back to the composed default', async () => {
    const b = bench({ accept: true })
    try {
      b.remote.listProviders.mockResolvedValue({ ok: true, value: WITH_PLUGINS })
      serve(b)
      await vi.waitFor(() => { expect(b.state().search.options).toHaveLength(2) })
      expect(b.state()).toMatchObject({ search: { selected: 'exa', kind: 'plugin' }, fetch: { selected: 'http', kind: 'local' } })
      b.face.selectProvider('searchProvider', 'brave')
      expect(b.state()).toMatchObject({ dirty: true, search: { selected: 'brave', kind: 'plugin' }, fetch: { selected: 'http' } })
      expect(b.web.mutate).not.toHaveBeenCalled()
      b.face.discard()
      expect(b.state().search.selected).toBe('exa')
      b.face.selectProvider('searchProvider', 'brave')
      b.face.save()
      await vi.waitFor(() => { expect(b.state().dirty).toBe(false) })
      expect(b.web.mutate).toHaveBeenLastCalledWith([{ op: 'set', path: ['searchProvider'], value: 'brave' }], undefined)
      b.face.selectProvider('fetchProvider', 'jina')
      b.face.save()
      await vi.waitFor(() => { expect(b.state().dirty).toBe(false) })
      expect(b.web.mutate).toHaveBeenLastCalledWith([{ op: 'set', path: ['fetchProvider'], value: 'jina' }], undefined)
      b.face.selectProvider('searchProvider', 'exa')
      b.face.selectProvider('fetchProvider', 'http')
      b.face.save()
      await vi.waitFor(() => { expect(b.state().dirty).toBe(false) })
      expect(b.web.mutate).toHaveBeenLastCalledWith([
        { op: 'unset', path: ['searchProvider'] },
        { op: 'unset', path: ['fetchProvider'] },
      ], undefined)
    } finally { b.controller.dispose() }
  })

  it('keeps the selection staged and blocks provider changes when the Host refuses its save', async () => {
    const b = bench()
    serve(b)
    b.web.mutate.mockImplementation(() => Promise.resolve(false))
    b.face.selectProvider('fetchProvider', 'jina')
    b.face.save()
    await vi.waitFor(() => { expect(b.state().failed).toBe(true) })
    expect(b.state()).toMatchObject({ fetch: { selected: 'jina' }, dirty: true, selectionBlocked: true })
    b.controller.dispose()
  })

  it('saves nothing before the selection is served, while it is unchanged, or while a save runs', async () => {
    const b = bench({ accept: true })
    b.face.save()
    expect(b.state().available).toBe(false)
    serve(b)
    b.face.save()
    await Promise.resolve()
    expect(b.web.mutate).not.toHaveBeenCalled()
    let release: (accepted: boolean) => void = () => {}
    b.web.mutate.mockImplementation(() => new Promise<boolean>((resolve) => { release = resolve }))
    b.face.selectProvider('fetchProvider', 'jina')
    b.face.save()
    await vi.waitFor(() => { expect(b.state().saving).toBe(true) })
    b.face.save()
    release(true)
    await vi.waitFor(() => { expect(b.state().saving).toBe(false) })
    expect(b.web.mutate).toHaveBeenCalledTimes(1)
    b.controller.dispose()
  })

  it('releases every subscription on dispose', () => {
    const b = bench()
    serve(b)
    b.controller.dispose()
    expect(b.web.listenerCount()).toBe(0)
  })
})

describe('WebSearchCardController automatic selection', () => {
  it('offers automatic selection only where the deployment composes no provider, and returns to it', async () => {
    const b = bench({ accept: true })
    try {
      serve(b, { value: { fetchProvider: 'http' }, base: { fetchProvider: 'http' } })
      expect(b.state()).toMatchObject({ search: { selected: '', auto: true }, fetch: { selected: 'http', auto: false } })
      b.face.selectProvider('searchProvider', 'exa')
      b.face.selectProvider('searchProvider', '')
      expect(b.state()).toMatchObject({ dirty: false, search: { selected: '' } })
      b.face.selectProvider('searchProvider', 'exa')
      b.face.save()
      await vi.waitFor(() => { expect(b.state().dirty).toBe(false) })
      expect(b.web.mutate).toHaveBeenLastCalledWith([{ op: 'set', path: ['searchProvider'], value: 'exa' }], undefined)
      expect(b.state().search).toMatchObject({ selected: 'exa', auto: true })
      b.face.selectProvider('searchProvider', '')
      expect(b.state()).toMatchObject({ dirty: true, search: { selected: '', kind: 'none' } })
      b.face.save()
      await vi.waitFor(() => { expect(b.state().dirty).toBe(false) })
      expect(b.web.mutate).toHaveBeenLastCalledWith([{ op: 'unset', path: ['searchProvider'] }], undefined)
      expect(b.state().search).toMatchObject({ selected: '', auto: true })
    } finally { b.controller.dispose() }
  })
})
