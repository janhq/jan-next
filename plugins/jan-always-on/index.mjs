import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import schema from '@janhq/schemastery'
import { registerApi } from '@janhq/jan-plugin-api'

export const name = 'jan-always-on'
export const inject = ['janHomePath', 'webServer', 'connection', 'schedule', 'agents', 'agentDefaultModel', 'permissionPresets', 'approval',
  'sessions', 'sessionPersistence', 'tools', 'settings']
export const Config = schema.object({ enabled: schema.boolean().default(false).volatile() })
const EMPTY = { paused: true, activeRun: null, lastRun: null, lastDeliveryAgeMs: null, events: [], approvals: [], outbox: [] }
const EMPTY_MEMORY = ['index.md', 'instructions.md', 'reported.md']

function text(value, limit) {
  if (typeof value !== 'string' || !value.trim() || value.length > limit) throw new Error('invalid-input')
  return value.trim()
}

/** Mount only registration on a fresh profile; opening the queue is an explicit opt-in. */
export function apply(ctx, config) {
  let opening, runtime, memory, clock, unregisterDestination, storeError, stopped = false
  let revision = 0
  const watchers = new Set()
  const emit = event => {
    const line = `${JSON.stringify(event)}\n`
    for (const res of watchers) {
      if (res.writableNeedDrain) res.destroy()
      else res.write(line)
    }
  }
  function activityChanged() {
    if (watchers.size) emit({ kind: 'changed', revision: ++revision })
  }
  function changed() {
    clock?.wake()
    activityChanged()
  }
  function report(error) { ctx.logger.warn('always-on: %s', String(error)) }
  async function activate() {
    if (opening) return opening
    opening = Promise.all([import('./background.mjs'), import('./memory.mjs'), import('./agent.mjs'), import('@janhq/dsh-superagent/queue')])
      .then(([{ openBackground }, { memoryAt }, { runWithJan }, { AgentDelivery }]) => {
        if (stopped) return
        const home = ctx.janHomePath()
        const localMemory = memoryAt(home)
        const directory = join(home, 'always-on')
        const delivery = new AgentDelivery(ctx)
        const run = runWithJan(ctx, localMemory, delivery, () => runtime, directory, schedule)
        const queue = openBackground({ directory, changed, activityChanged, run, report,
          approvalPending: id => { if (watchers.size) emit({ kind: 'approval', id }) },
          async notify(message) {
            if (!watchers.size) return 'waiting'
            emit({ kind: 'notification', id: message.id, text: message.text })
            return 'sent'
          },
        })
        runtime = queue
        memory = localMemory
        clock = ctx.schedule.registerWakeSource(queue)
        unregisterDestination = ctx.schedule.registerDestination(name, ({ id, prompt, payload }) => {
          active().enqueue({ id: `timer:${id}`, kind: payload === undefined ? 'task' : 'follow-up',
            text: prompt, ...(payload === undefined ? {} : { progressPath: payload }) })
        })
        storeError = undefined
        changed()
      }).catch(error => { storeError = error; opening = undefined; changed(); throw error })
    return opening
  }

  function active() {
    if (storeError) throw storeError
    if (!runtime) throw new Error('not-enabled')
    return runtime
  }

  function schedule({ key = randomUUID(), title, prompt, delay, repeat = false, progressPath }, signal) {
    const timing = repeat ? { kind: 'every', every_seconds: delay } : { kind: 'after', after_seconds: delay }
    return ctx.schedule.createPluginTask({ title, prompt, timing }, { owner: name, key, payload: progressPath }, signal)
  }
  ctx.effect(() => ctx.on('schedule/changed', activityChanged), 'always-on Scheduled changes')
  ctx.effect(() => registerApi(ctx, 'always-on', {
    async state() {
      if (opening) await opening
      if (storeError) throw storeError
      const enabled = config.enabled.get()
      const timers = enabled ? (await ctx.schedule.catalog()).filter(task => task.target.kind === 'plugin' && task.target.owner === name) : []
      return { ...(runtime?.snapshot() ?? EMPTY), enabled, timers, files: memory ? await memory.index() : EMPTY_MEMORY }
    },
    async setPaused({ paused }) {
      if (typeof paused !== 'boolean') throw new Error('invalid-input')
      if (!paused && !config.enabled.get()) await ctx.settings.update(ctx.fiber.entry.options.id, { enabled: true })
      if (config.enabled.get() || !paused) await activate()
      if (runtime) await runtime.setPaused(paused)
    },
    schedule({ title, prompt, delay, repeat }) {
      if (delay > 31_536_000) throw new Error('invalid-input')
      if (!Number.isSafeInteger(delay) || delay < 1 || typeof repeat !== 'boolean') throw new Error('invalid-input')
      active()
      return schedule({ title: text(title, 120), prompt: text(prompt, 4000), delay, repeat })
    },
    async cancel({ id }) {
      active()
      const task = await ctx.schedule.view({ id: text(id, 120) })
      if ('code' in task || task.target.kind !== 'plugin' || task.target.owner !== name) return false
      const result = await ctx.schedule.edit({ id: task.id, action: 'delete' })
      return 'deleted' in result && result.deleted === true
    },
    read({ path }) {
      if (!memory && EMPTY_MEMORY.includes(path)) return { text: '', truncated: false }
      active()
      return memory.read(path)
    },
    answer({ id, decision }) { return active().answer(text(id, 120), decision) },
    reply({ id, prompt, sourceId }) { return active().reply(text(id, 120), text(prompt, 4000), text(sourceId, 120)) },
  }), 'always-on management')

  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/jan-api/always-on/feed', handler(req, res) {
    const rejection = ctx.connection.requestRejection(req)
    if (rejection !== undefined) { res.writeHead(rejection); res.end(); return }
    if (req.method !== 'GET') { res.writeHead(405, { allow: 'GET' }); res.end(); return }
    res.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' })
    res.once('close', () => watchers.delete(res))
    watchers.add(res)
    clock?.wake()
    res.write(`${JSON.stringify({ kind: 'changed', revision })}\n`)
  } }), 'always-on notifications')

  // Restore only an opted-in queue. A fresh profile never opens SQLite or the memory directory.
  if (config.enabled.get()) void activate().catch(report)
  ctx.effect(() => async () => {
    stopped = true
    for (const res of watchers) res.end()
    watchers.clear()
    await opening?.catch(report)
    unregisterDestination?.()
    clock?.dispose()
    await runtime?.close()
  }, 'always-on shutdown')
}
