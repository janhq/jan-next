/** Repository-independent ingress to Super Agent's persistent passes, Effects and Outbox. */
import { randomUUID } from 'node:crypto'
import { lstatSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { lockSync } from 'proper-lockfile'
import { Effects } from './app/effects.ts'
import { Outbox } from './app/outbox.ts'
import { Passes } from './app/passes.ts'
import { Store } from './app/store.ts'
import type { OutboundMessage } from './core/index.ts'
import { HealthBoard } from './infra/health.ts'
import { family, record } from './kv.ts'

export { AgentDelivery } from './app/delivery.ts'

export interface QueueInput<T> {
  /** Stable external source identity, used for deduplication across restarts. */
  id: string
  value: T
  readyAt: number
  /** Pending events with different groups run separately (for example, replies to different sessions). */
  group?: string
}
export type QueueOutcome = 'done' | 'deferred' | 'failed'
export interface QueueEvent<T> extends QueueInput<T> {
  status: 'pending' | 'running' | QueueOutcome
  batchId?: string
}
export interface QueueBatch<T> { id: string; events: QueueEvent<T>[] }
export interface QueueOptions<T> {
  directory: string
  run(batch: QueueBatch<T>, signal: AbortSignal): Promise<QueueOutcome>
  send(message: OutboundMessage): Promise<'sent' | 'gone' | 'waiting'>
  /** Minimum time between successful outbox deliveries. */
  sendIntervalMs?: number
  now?(): number
  /** Notify the embedding clock and any management views that queue state changed. */
  changed?(): void
  report?(error: unknown): void
}

const pausedKey = record<boolean>('queue:paused')
const sendKey = record<number>('queue:next-send')
const pendingKey = record<string[]>('queue:pending')
const batchKey = record<string[]>('queue:batch')
const MAX_BATCH = 16

/** Open a dedicated queue directory. A new queue begins paused; the owner drives deadlines through `next` and `deliver`. */
export function openQueue<T>(options: QueueOptions<T>) {
  const { directory, now = Date.now, sendIntervalMs = 0 } = options
  const history = family<QueueEvent<T>>('queue:event:')
  const lifetime = new AbortController()
  let closed = false, closing: Promise<void> | undefined
  let worker: AbortController | undefined
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  if (!lstatSync(directory).isDirectory()) throw new Error('The queue directory must not be a link')
  const unlock = lockSync(directory, { stale: 30_000, onCompromised: error => {
    lifetime.abort(error); worker?.abort(error); options.report?.(error)
  } })
  let opened: Store | undefined
  try {
    const store = opened = new Store(join(directory, 'queue.sqlite'), options.report)
    let paused = store.get(pausedKey) ?? true
    const held = () => closed || lifetime.signal.aborted || paused
    const changed = () => { if (!closed) options.changed?.() }
    const board = new HealthBoard()
    const effects = new Effects(store, board, now, changed)
    const nextSend = () => store.get(sendKey) ?? 0
    const outbox = new Outbox({ store, effects, paused: held, now, nextAllowed: nextSend,
      available: () => true, allowed: () => true,
      async deliver(message) {
        const result = await options.send(message)
        if (result === 'sent' && sendIntervalMs > 0) store.set(sendKey, now() + sendIntervalMs)
        return result
      },
    })
    const load = (ids: string[]) => ids.map(id => store.get(history(id))!)
    const waiting = () => store.get(pendingKey) ?? []
    const nextInbox = () => store.get(batchKey) ? 0 : load(waiting()).reduce((next, item) => Math.min(next, item.readyAt), Infinity)
    const passes = new Passes<QueueInput<T>>({ effects, lifetime: lifetime.signal, health: board.claim('queue'),
      closing: () => closed || lifetime.signal.aborted, configured: () => !held(), engine: {
        receive(input) {
          return store.atomic(() => {
            const key = history(input.id)
            if (store.get(key)) return 'duplicate'
            store.set(key, { ...input, status: 'pending' })
            store.set(pendingKey, [...waiting(), input.id])
            return 'stored'
          })
        },
        evaluateDue() {
          if (!held() && !effects.pending('inbox') && nextInbox() <= now()) effects.enqueue('inbox', 'worker', {})
        },
      },
    })
    effects.handle('inbox', async () => {
      const batch = store.atomic(() => {
        const prior = store.get(batchKey)
        if (prior) {
          const events = load(prior)
          for (const event of events) { event.status = 'running'; store.set(history(event.id), event) }
          return { id: events[0]!.batchId!, events }
        }
        const ids = waiting(), pending = load(ids)
        const first = pending.find(event => event.readyAt <= now())
        if (!first) return
        const id = randomUUID()
        const events = pending.filter(event => event.group === first.group).slice(0, MAX_BATCH)
          .map((event): QueueEvent<T> => ({ ...event, batchId: id, status: 'running' }))
        const selected = new Set(events.map(event => event.id))
        for (const event of events) store.set(history(event.id), event)
        store.set(batchKey, [...selected])
        store.set(pendingKey, ids.filter(value => !selected.has(value)))
        return { id, events }
      })
      if (!batch) return
      const controller = worker = new AbortController()
      let outcome: QueueOutcome = 'failed'
      try {
        changed()
        outcome = await options.run(batch, controller.signal)
      } catch (error) {
        if (!controller.signal.aborted) options.report?.(error)
      } finally {
        worker = undefined
        if (!lifetime.signal.aborted || closed) store.atomic(() => {
          for (const event of batch.events) store.set(history(event.id), { ...event, status: controller.signal.aborted ? 'pending' : outcome })
          if (!controller.signal.aborted) store.delete(batchKey)
        })
      }
    }, { limit: () => held() ? 0 : 1 })
    effects.start()
    const guard = () => { lifetime.signal.throwIfAborted() }
    // Keep changes made by an embedding command atomic with enqueuing its event; wake only after commit.
    const touch = () => store.afterCommit(changed)
    return {
      get paused() { return paused },
      atomic<R>(work: () => R): R { guard(); return store.atomic(work) },
      get<V>(key: string): V | undefined { guard(); return store.get<V>(`extension:${key}`) },
      set<V>(key: string, value: V): void { guard(); store.set(`extension:${key}`, value); touch() },
      enqueue(input: QueueInput<T>): boolean { guard(); const stored = passes.receive(input) === 'stored'; if (stored) touch(); return stored },
      async setPaused(value: boolean): Promise<void> {
        guard()
        if (paused !== value) { store.set(pausedKey, value); paused = value; changed() }
        if (value) { worker?.abort(); await effects.idle('inbox') }
      },
      next(): number | undefined {
        if (held()) return
        const inbox = worker ? Infinity : effects.next('inbox') ?? nextInbox()
        const reply = Math.max(effects.next('reply') ?? Infinity, nextSend())
        const next = Math.min(inbox, reply)
        return Number.isFinite(next) ? next : undefined
      },
      async deliver(_now: number): Promise<void> { await passes.pump() },
      async idle(): Promise<void> { await passes.idle() },
      events(limit = 100): QueueEvent<T>[] { guard(); return store.recent(history, limit) },
      message(id: string) { guard(); return store.receipts.get(id) },
      messages(limit = 100) { guard(); return store.receipts.list(limit) },
      send(message: OutboundMessage): boolean { guard(); const added = outbox.send(message); if (added) touch(); return added },
      close(): Promise<void> {
        if (closing) return closing
        closed = true; lifetime.abort(); worker?.abort()
        return closing = Promise.allSettled([passes.stop(), effects.drain()]).then(() => { try { store.close() } finally { unlock() } })
      },
    }
  } catch (error) {
    try { opened?.close() } finally { unlock() }
    throw error
  }
}
