import { randomUUID } from 'node:crypto'
import type { DownloadAction, DownloadActions, DownloadItem, DownloadSnapshot, DownloadStore } from './types.ts'

const PUBLISH_INTERVAL = 150
const RATE_WINDOW = 4_000
const BYTE_ACTIONS = ['cancel', 'pause', 'resume', 'retry', 'open', 'reveal'] as const
interface Entry {
  item: DownloadItem
  actions: DownloadActions
  samples: Array<{ at: number; bytes: number }>
  finishSequence?: number
  runningAction?: DownloadAction
}

const active = (item: DownloadItem): boolean => item.state === 'queued' || item.state === 'downloading'
const finished = (item: DownloadItem): boolean => item.state === 'done' || item.state === 'failed' || item.state === 'cancelled'
const actionsOf = (actions: DownloadActions): DownloadAction[] => BYTE_ACTIONS.filter(action => actions[action] !== undefined)

/**
 * Owns one Host session of transfer history and throttles byte-only publications.
 * @param clock - Monotonic millisecond source for the rolling rate window.
 * @returns A producer service with a read/action interface for the inbox.
 */
export function createDownloadStore(clock: () => number = () => performance.now()): DownloadStore {
  const entries = new Map<string, Entry>()
  const listeners = new Set<() => void>()
  let cached: DownloadSnapshot | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let sequence = 0
  let seen = 0
  let disposed = false

  function publish(immediately: boolean): void {
    cached = undefined
    if (disposed || listeners.size === 0) return
    if (immediately) {
      clearTimeout(timer)
      timer = undefined
      for (const listener of listeners) listener()
    } else if (timer === undefined) {
      timer = setTimeout(() => {
        timer = undefined
        for (const listener of listeners) listener()
      }, PUBLISH_INTERVAL)
    }
  }

  return {
    start({ id = randomUUID(), name, kind, totalBytes, actions = {} }) {
      const entry: Entry = { item: { id, name, kind, state: 'queued', actions: actionsOf(actions), ...(totalBytes === undefined ? {} : { totalBytes }) }, actions, samples: [] }
      entries.delete(id)
      entries.set(id, entry)
      publish(true)
      return {
        update({ state = entry.item.state, receivedBytes, totalBytes = entry.item.totalBytes, percent, bytesPerSecond, actions }) {
          if (disposed || entries.get(id) !== entry || finished(entry.item)) return
          const stateChanged = state !== entry.item.state
          if (actions !== undefined) entry.actions = actions
          const lastBytes = receivedBytes ?? entry.item.receivedBytes
          let rate = state === 'downloading' ? entry.item.bytesPerSecond : undefined
          if (stateChanged && state !== 'downloading') entry.samples.length = 0
          if (state === 'downloading' && receivedBytes !== undefined) {
            const at = clock()
            const previous = entry.samples.at(-1)
            if (previous !== undefined && previous.bytes > receivedBytes) { entry.samples.length = 0; rate = undefined }
            for (let next = entry.samples[1]; next !== undefined && at - next.at >= RATE_WINDOW; next = entry.samples[1]) {
              entry.samples.shift()
            }
            const base = entry.samples[0]
            const latest = entry.samples.at(-1)
            if (latest === undefined || at - latest.at >= PUBLISH_INTERVAL) entry.samples.push({ at, bytes: receivedBytes })
            if (base !== undefined && at - base.at >= 500) rate = (receivedBytes - base.bytes) * 1000 / (at - base.at)
            else rate ??= bytesPerSecond
          } else if (state === 'downloading' && bytesPerSecond !== undefined) rate = bytesPerSecond
          const fraction = totalBytes !== undefined && totalBytes > 0 && lastBytes !== undefined
            ? lastBytes * 100 / totalBytes : percent ?? entry.item.percent
          entry.item = {
            id, name, kind, state, actions: actions === undefined ? entry.item.actions : actionsOf(actions),
            ...(lastBytes === undefined ? {} : { receivedBytes: lastBytes }),
            ...(totalBytes === undefined ? {} : { totalBytes }),
            ...(fraction === undefined ? {} : { percent: Math.max(0, Math.min(100, Math.floor(fraction))) }),
            ...(rate === undefined ? {} : { bytesPerSecond: rate }),
          }
          publish(stateChanged || actions !== undefined)
        },
        finish(state, error, actions = {}) {
          if (disposed || entries.get(id) !== entry || finished(entry.item)) return
          entry.samples.length = 0
          entry.actions = actions
          const { bytesPerSecond: _rate, ...previous } = entry.item
          entry.item = { ...previous, state, actions: actionsOf(actions), ...(state === 'done' ? { percent: 100 } : {}), ...(error === undefined ? {} : { error }) }
          if (state !== 'cancelled') entry.finishSequence = ++sequence
          publish(true)
        },
      }
    },
    snapshot() {
      if (cached !== undefined) return cached
      const items: DownloadItem[] = []
      let count = 0, weight = 0, received = 0, percentage = 0, weighted = 0, described = 0, unseenSequence = 0, failed = false
      for (const { item, finishSequence } of entries.values()) {
        items.push(item)
        if (active(item)) {
          count++
          if (item.totalBytes !== undefined && item.totalBytes > 0 && (item.receivedBytes !== undefined || item.state === 'queued')) {
            weight += item.totalBytes
            received += Math.min(item.totalBytes, item.receivedBytes ?? 0)
            weighted++
          }
          if (item.percent !== undefined || (item.state === 'queued' && item.totalBytes !== undefined)) {
            percentage += item.percent ?? 0
            described++
          }
        }
        if (finishSequence !== undefined && finishSequence > seen) {
          unseenSequence = Math.max(unseenSequence, finishSequence)
          failed ||= item.state === 'failed'
        }
      }
      const percent = count === 0 || described < count ? null
        : weighted === count ? Math.floor(received * 100 / weight) : Math.floor(percentage / count)
      cached = { items, active: { count, percent }, unseen: unseenSequence ? { sequence: unseenSequence, failed } : null }
      return cached
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    markSeen(target) {
      if (target <= seen) return
      seen = Math.min(target, sequence)
      publish(true)
    },
    clearFinished() {
      for (const [id, { item }] of entries) if (finished(item)) entries.delete(id)
      publish(true)
    },
    async act(id, action) {
      const entry = entries.get(id)
      const invoke = entry?.actions[action]
      if (entry === undefined || invoke === undefined || entry.runningAction !== undefined) {
        throw new Error('This download action is no longer available.')
      }
      entry.runningAction = action
      try { await invoke() }
      finally { delete entry.runningAction }
    },
    dispose() {
      disposed = true
      clearTimeout(timer)
      listeners.clear()
      entries.clear()
      cached = undefined
    },
  }
}
