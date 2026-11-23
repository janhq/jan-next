// @vitest-environment jsdom
import { beforeAll, expect, it, vi } from 'vitest'

type Status = { running: boolean | undefined; pendingInteraction: { key: string } | undefined }
type Event = { kind: 'finished' | 'failed' | 'waiting'; sessionId: string }
type Watcher = { observe(snapshot: ReadonlyMap<string, Status>): void; error(sessionId: string): void }
type End = { seq: number; kind: string }
type Factory = (options: {
  tracked: (sessionId: string) => boolean
  emit: (event: Event) => void
  readOutcome: (sessionId: string) => Promise<End | undefined>
}) => Watcher

let createStatusWatcher: Factory
beforeAll(async () => {
  // The shipped chunk registers through the client module loader, not a native ESM export.
  const previous = Object.getOwnPropertyDescriptor(window, '__ModuleLoader__')
  Object.defineProperty(window, '__ModuleLoader__', { configurable: true, value: {
    load({ factory }: { factory: () => { createStatusWatcher: Factory } }) { createStatusWatcher = factory().createStatusWatcher },
  } })
  try {
    await import('../client.watch.js')
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
