import { createHash } from 'node:crypto'
import { openQueue } from '@janhq/dsh-superagent/queue'
const APPROVALS = 'approvals'
const BATCH_MS = 250
const SEND_MS = 60_000

/** Bind Jan's session metadata to the durable Super Agent queue. */
export function openBackground({ directory, now = Date.now, changed, activityChanged, run, notify, approvalPending, report }) {
  let current, lastRun = null, lastDelivery
  const queue = openQueue({ directory, now, changed, report, sendIntervalMs: SEND_MS,
    async send(message) {
      const result = await notify(message)
      if (result === 'sent') lastDelivery = now()
      return result
    },
    async run(batch, signal) {
      const events = batch.events.map(event => ({ id: event.id, ...event.value }))
      const first = events[0]
      const job = { runId: batch.id, sessionId: first.sessionId ?? `session-always-on-${batch.id}`, events,
        approval: first.approvalId === undefined ? undefined : (queue.get(APPROVALS) ?? {})[first.approvalId] }
      current = { job, signal, phase: 'thinking' }
      try {
        const outcome = await run(job, signal, phase => {
          if (current?.job !== job || signal.aborted || current.phase === phase) return
          current.phase = phase
          activityChanged()
        })
        if (!signal.aborted) lastRun = outcome
        return outcome
      } catch (error) {
        if (!signal.aborted) lastRun = 'failed'
        throw error
      } finally { current = undefined }
    },
  })
  function enqueue({ id, ...value }, stamp = now()) {
    return queue.enqueue({ id, value, readyAt: stamp + BATCH_MS, group: value.approvalId ?? value.sessionId })
  }
  function assertActive(job, signal) {
    signal?.throwIfAborted()
    if (current?.job !== job || current.signal.aborted) throw new Error('inactive-run')
  }
  return {
    get paused() { return queue.paused },
    setPaused: queue.setPaused,
    close: queue.close,
    idle: queue.idle,
    enqueue,
    isActive(job) { return current?.job === job && !current.signal.aborted },
    awaiting(job) { return Object.hasOwn(queue.get(APPROVALS) ?? {}, job.runId) },
    memoryChanged: changed,
    snapshot() {
      return { paused: queue.paused,
        activeRun: current?.phase ?? null, lastRun,
        lastDeliveryAgeMs: lastDelivery === undefined ? null : Math.max(0, now() - lastDelivery),
        events: queue.events().map(({ id, status, batchId, readyAt, value }) => ({ id, status, runId: batchId, createdAt: readyAt - BATCH_MS, ...value })),
        approvals: Object.values(queue.get(APPROVALS) ?? {}).filter(item => item.decision === undefined),
        outbox: queue.messages().map(({ id, text, status, channel }) => ({ id, text, status, ...channel.address })),
      }
    },
    defer(job, id, changes, signal) {
      assertActive(job, signal)
      const records = queue.get(APPROVALS) ?? {}
      if (Object.hasOwn(records, id)) return
      queue.set(APPROVALS, { ...records, [id]: { id, sessionId: job.sessionId, changes, createdAt: now() } })
      approvalPending?.(id)
    },
    answer(id, decision) {
      if (decision !== 'allowed-once' && decision !== 'rejected') throw new Error('invalid-decision')
      return queue.atomic(() => {
        const records = queue.get(APPROVALS) ?? {}
        const item = Object.hasOwn(records, id) ? records[id] : undefined
        if (!item || item.decision !== undefined) return false
        queue.set(APPROVALS, { ...records, [id]: { ...item, decision } })
        return enqueue({ id: `approval:${id}`, kind: 'approval', sessionId: item.sessionId, approvalId: id })
      })
    },
    send(job, key, text, signal) {
      assertActive(job, signal)
      const id = createHash('sha256').update(key).digest('hex')
      return queue.send({ id, text, kind: 'notice', channel: { source: 'desktop', thread: 'always-on',
        address: { sessionId: job.sessionId, createdAt: String(now()) } } })
    },
    reply(id, text, sourceId) {
      const message = queue.message(id)
      if (message?.status !== 'sent') return false
      return enqueue({ id: `reply:${sourceId}`, kind: 'reply', sessionId: message.channel.address.sessionId, text })
    },
    next: queue.next,
    deliver: queue.deliver,
  }
}
