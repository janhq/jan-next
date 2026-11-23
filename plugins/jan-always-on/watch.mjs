import { fetchNew, sourceKey } from './sources.mjs'

const STATE = 'watch'
const TICK_MS = 30_000
const MAX_BACKOFF_MS = 6 * 60 * 60_000

/**
 * Poll one bot's sources and turn each new item into an inbox event. Polling never
 * calls the model: a quiet check ends here, and only new items wake the bot, batched
 * into one run by the inbox. Cursors live in the inbox's own store, outside memory.
 */
export function openWatch({ queue, sources, token, fetch = globalThis.fetch, now = Date.now, changed = () => {}, report = () => {} }) {
  const running = new Set()
  let timer, closed = false
  const state = () => queue.get(STATE) ?? {}
  const save = (key, value) => queue.set(STATE, { ...state(), [key]: { ...state()[key], ...value } })

  async function check(source, signal) {
    const key = sourceKey(source)
    if (running.has(key)) return
    running.add(key)
    const previous = state()[key] ?? { failures: 0 }
    try {
      const secret = await token(source.kind)
      const { items, cursor } = await fetchNew(source, previous.cursor, { token: secret, fetch, signal })
      if (closed) return
      let found = 0
      // Enqueue before moving the cursor: a crash between the two re-reads the same
      // items, and the inbox drops the duplicates by their stable IDs.
      for (const item of items) {
        if (queue.enqueue({ id: `source:${key}:${item.id}`, kind: 'source', text: item.text })) found++
      }
      save(key, { cursor, failures: 0, lastCheckAt: now(), nextCheckAt: now() + source.everyMinutes * 60_000,
        lastError: null, lastFound: found })
    } catch (error) {
      if (closed || signal?.aborted) return
      const failures = previous.failures + 1
      const backoff = Math.min(MAX_BACKOFF_MS, source.everyMinutes * 60_000 * 2 ** Math.min(failures - 1, 5))
      save(key, { failures, lastCheckAt: now(), nextCheckAt: now() + Math.max(error.retryAfterMs ?? 0, backoff),
        lastError: error.message, lastFound: 0 })
      if (failures === 1) report(`source ${key}: ${error.message}`)
    } finally {
      running.delete(key)
      changed()
    }
  }

  async function tick({ force = false, signal } = {}) {
    if (closed || queue.paused && !force) return
    const at = now()
    await Promise.all(sources().filter(source => force || (state()[sourceKey(source)]?.nextCheckAt ?? 0) <= at)
      .map(source => check(source, signal)))
  }

  return {
    start() {
      timer ??= setInterval(() => void tick().catch(report), TICK_MS)
      timer.unref?.()
      void tick().catch(report)
    },
    tick,
    /** @returns Per-source status for the details panel, never a token. */
    status() {
      const all = state()
      return sources().map(source => {
        const entry = all[sourceKey(source)] ?? {}
        return { ...source, lastCheckAt: entry.lastCheckAt ?? null, nextCheckAt: entry.nextCheckAt ?? null,
          lastError: entry.lastError ?? null, lastFound: entry.lastFound ?? 0 }
      })
    },
    close() { closed = true; clearInterval(timer) },
  }
}
