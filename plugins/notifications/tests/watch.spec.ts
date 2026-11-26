// @vitest-environment jsdom
import { beforeAll, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

type Status = { running: boolean | undefined; pendingInteraction: { key: string; kind?: string } | undefined }
type Event = { kind: 'finished' | 'failed' | 'waiting' | 'input'; sessionId: string }
type Watcher = { observe(snapshot: ReadonlyMap<string, Status>): void; error(sessionId: string): void }
type End = { seq: number; kind: string }
type Factory = (options: {
  tracked: (sessionId: string) => boolean
  emit: (event: Event) => void
  readOutcome: (sessionId: string) => Promise<End | undefined>
}) => Watcher
type ClientRequire = ((id: string) => object) & { async(id: string): Promise<object> }
type ClientFactory = (require: ClientRequire) => { apply(ctx: object): void }
type SavedPreferences = { waiting?: boolean; input?: boolean }

let createStatusWatcher: Factory
let createNotifications: ClientFactory
beforeAll(async () => {
  // The browser modules register through the client module loader, so install it before importing them.
  const previous = Object.getOwnPropertyDescriptor(window, '__ModuleLoader__')
  Object.defineProperty(window, '__ModuleLoader__', { configurable: true, value: {
    load({ factory }: { factory: () => { createStatusWatcher: Factory } }) { createStatusWatcher = factory().createStatusWatcher },
  } })
  try {
    await import('../client.watch.js')
    Object.defineProperty(window, '__ModuleLoader__', { configurable: true, value: {
      load({ factory }: { factory: ClientFactory }) { createNotifications = factory },
    } })
    await import('../client.js')
  } finally {
    if (previous === undefined) Reflect.deleteProperty(window, '__ModuleLoader__')
    else Object.defineProperty(window, '__ModuleLoader__', previous)
  }
})

function setup(tracked: (sessionId: string) => boolean = () => true) {
  const readOutcome = vi.fn<() => Promise<End | undefined>>(async () => undefined)
  const events: Event[] = []
  const watcher = createStatusWatcher({ tracked, emit: (event) => { events.push(event) }, readOutcome })
  const status = (entries: Record<string, Partial<Status>>) => new Map(Object.entries(entries).map(([id, value]) =>
    [id, { running: undefined, pendingInteraction: undefined, ...value }] as const))
  return { events, watcher, status, readOutcome }
}

it('treats the first snapshot as a baseline', () => {
  const f = setup()
  f.watcher.observe(f.status({ a: { running: false }, b: { running: true, pendingInteraction: { key: 'k1' } } }))
  expect(f.events).toEqual([])
})

it('does not replay an interaction that was already pending when a Session first appears', () => {
  const f = setup()
  f.watcher.observe(f.status({}))
  f.watcher.observe(f.status({ a: { running: true, pendingInteraction: { key: 'k1' } } }))
  expect(f.events).toEqual([])
})

it('reports a completed turn once, and not again if a later run records no new outcome', async () => {
  const f = setup()
  f.readOutcome.mockResolvedValue({ seq: 5, kind: 'completed' })
  f.watcher.observe(f.status({ a: { running: false } }))
  f.watcher.observe(f.status({ a: { running: true } }))
  f.watcher.observe(f.status({ a: { running: false } }))
  f.watcher.observe(f.status({ a: { running: false } }))
  await Promise.resolve()
  f.watcher.observe(f.status({ a: { running: true } }))
  f.watcher.observe(f.status({ a: { running: false } }))
  await Promise.resolve()
  expect(f.events).toEqual([{ kind: 'finished', sessionId: 'a' }])
})

it('reports a failed run once when an error arrives before the Session stops', async () => {
  const f = setup()
  f.readOutcome.mockResolvedValueOnce({ seq: 5, kind: 'error' }).mockResolvedValueOnce({ seq: 10, kind: 'completed' })
  f.watcher.observe(f.status({ a: { running: true } }))
  f.watcher.error('a')
  f.watcher.observe(f.status({ a: { running: false } }))
  await Promise.resolve()
  f.watcher.observe(f.status({ a: { running: true } }))
  f.watcher.observe(f.status({ a: { running: false } }))
  await Promise.resolve()
  expect(f.events).toEqual([{ kind: 'failed', sessionId: 'a' }, { kind: 'finished', sessionId: 'a' }])
})

it('does not report a stopped turn as finished, even without an error event', async () => {
  const f = setup()
  f.readOutcome.mockResolvedValueOnce({ seq: 5, kind: 'aborted' }).mockResolvedValueOnce({ seq: 10, kind: 'error' })
  f.watcher.observe(f.status({ a: { running: true } }))
  f.watcher.observe(f.status({ a: { running: false } }))
  await Promise.resolve()
  expect(f.events).toEqual([])
  f.watcher.observe(f.status({ a: { running: true } }))
  f.watcher.observe(f.status({ a: { running: false } }))
  await Promise.resolve()
  expect(f.events).toEqual([{ kind: 'failed', sessionId: 'a' }])
})

it('does not announce a delayed outcome after that session starts running again', async () => {
  const f = setup()
  const read = Promise.withResolvers<End>()
  f.readOutcome.mockReturnValueOnce(read.promise)
  f.watcher.observe(f.status({ a: { running: true } }))
  f.watcher.observe(f.status({ a: { running: false } }))
  f.watcher.observe(f.status({ a: { running: true } }))
  read.resolve({ seq: 5, kind: 'completed' })
  await read.promise
  expect(f.events).toEqual([])
})

it('reports an error outside a run, such as a failed activation, at once', () => {
  const f = setup()
  f.watcher.observe(f.status({ a: { running: false } }))
  f.watcher.error('a')
  expect(f.events).toEqual([{ kind: 'failed', sessionId: 'a' }])
})

it('reports each new pending interaction key once', () => {
  const f = setup()
  f.watcher.observe(f.status({ a: { running: true } }))
  f.watcher.observe(f.status({ a: { running: true, pendingInteraction: { key: 'k1' } } }))
  f.watcher.observe(f.status({ a: { running: true, pendingInteraction: { key: 'k1' } } }))
  f.watcher.observe(f.status({ a: { running: true, pendingInteraction: { key: 'k2' } } }))
  f.watcher.observe(f.status({ a: { running: true } }))
  f.watcher.observe(f.status({ a: { running: true, pendingInteraction: { key: 'k1' } } }))
  expect(f.events.map(event => event.kind)).toEqual(['waiting', 'waiting', 'waiting'])
})

it('reports a question as needing input and an approval or plan review as needing action', () => {
  const f = setup()
  f.watcher.observe(f.status({ a: { running: true } }))
  f.watcher.observe(f.status({ a: { running: true, pendingInteraction: { key: 'q', kind: 'question' } } }))
  f.watcher.observe(f.status({ a: { running: true, pendingInteraction: { key: 'p', kind: 'approval' } } }))
  f.watcher.observe(f.status({ a: { running: true, pendingInteraction: { key: 'r', kind: 'plan-review' } } }))
  expect(f.events.map(event => event.kind)).toEqual(['input', 'waiting', 'waiting'])
})

it('ignores Sessions that are not tracked, such as subagents', () => {
  const f = setup(sessionId => sessionId !== 'child')
  f.watcher.observe(f.status({ child: { running: true } }))
  f.watcher.error('child')
  f.watcher.observe(f.status({ child: { running: false, pendingInteraction: { key: 'k' } } }))
  expect(f.events).toEqual([])
})

it('forgets a removed Session so a later Session with the same id starts clean', () => {
  const f = setup()
  f.watcher.observe(f.status({ a: { running: true } }))
  f.watcher.error('a')
  f.watcher.observe(f.status({}))
  f.watcher.observe(f.status({ a: { running: false } }))
  expect(f.events).toEqual([])
})

async function withNotifications(test: (options: {
  bridge: { show: Mock<() => Promise<void>> }
  setPanel(panelId: string | null): void
  observeInteraction(interaction: NonNullable<Status['pendingInteraction']>): void
}) => void | Promise<void>, user: SavedPreferences = {}) {
  const bridge = { show: vi.fn(async () => {}), windowActive: async () => true, subscribe: () => () => {} }
  vi.stubGlobal('janDesktop', { notifications: bridge })
  const disposers: (() => void)[] = []
  const require = Object.assign(() => ({}), {
    async: async (id: string) => id === './client.watch.js' ? { createStatusWatcher } : { dictionaries: {} },
  })
  const ready = Promise.withResolvers<() => void>()
  let pendingInteraction: Status['pendingInteraction']
  let activePanelId: string | null = 'model-hub'
  const defaults = { enabled: true, finished: true, failed: true, waiting: true, input: true }
  const ctx = {
    effect: (start: () => (() => void) | undefined) => { const dispose = start(); if (dispose) disposers.push(dispose) },
    logger: () => ({ error: ready.reject }),
    configForms: { get: () => ({ getSnapshot: () => ({
      status: 'ready', value: { ...defaults, ...user }, base: defaults, user, revision: 0, writable: true,
    }) }) },
    locale: { register: () => {}, bind: () => (key: string) => key },
    slots: { inject: () => {} },
    sessions: { list: { getSnapshot: () => ({ byId: { chat: { title: 'My chat', retainedBy: { mainView: 1 } } } }) } },
    layout: { panelInfo: { getSnapshot: () => ({ activePanelId }) } },
    uiSession: { sessionStatus: {
      getSnapshot: () => new Map([['chat', { running: true, pendingInteraction }]]),
      subscribe: (sync: () => void) => { ready.resolve(sync); return () => {} },
    } },
    remote: { $on: () => () => {} },
  }
  try {
    createNotifications(require).apply(ctx)
    const observe = await ready.promise
    await test({
      bridge,
      setPanel: panelId => { activePanelId = panelId },
      observeInteraction: interaction => { pendingInteraction = interaction; observe() },
    })
  } finally {
    for (const dispose of disposers.reverse()) dispose()
    vi.unstubAllGlobals()
  }
}

it('notifies while a global panel hides the retained chat, but not while that chat is open and focused', async () => {
  await withNotifications(async ({ bridge, setPanel, observeInteraction }) => {
    observeInteraction({ key: 'first-approval' })
    expect(bridge.show).toHaveBeenCalledWith({ id: 'waiting:1', title: 'waiting.title', body: 'waiting.body' })

    setPanel(null)
    observeInteraction({ key: 'second-approval' })
    await Promise.resolve()
    expect(bridge.show).toHaveBeenCalledTimes(1)
  })
})

it.each([
  { name: 'keeps questions disabled after upgrading with approvals disabled', preferences: { waiting: false }, notifies: false },
  { name: 'honors an explicit question opt-in', preferences: { waiting: false, input: true }, notifies: true },
  { name: 'honors an explicit question opt-out', preferences: { waiting: true, input: false }, notifies: false },
  { name: 'enables question notifications by default', preferences: {}, notifies: true },
])('$name', async ({ preferences, notifies }) => {
  await withNotifications(({ bridge, observeInteraction }) => {
    observeInteraction({ key: 'question', kind: 'question' })
    if (notifies) {
      expect(bridge.show).toHaveBeenCalledExactlyOnceWith({ id: 'input:1', title: 'input.title', body: 'input.body' })
    } else {
      expect(bridge.show).not.toHaveBeenCalled()
    }
  }, preferences)
})
