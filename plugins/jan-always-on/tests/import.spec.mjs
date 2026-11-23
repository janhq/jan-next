import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { apply } from '../index.mjs'

async function harness(t, { failPause = false, failDelete = false } = {}) {
  const home = await mkdtemp(join(tmpdir(), 'jan-bot-import-'))
  const services = {}, destinations = new Map(), tasks = [], sessions = new Map(), cleanups = [], attempts = []
  let handler
  apply({ janHomePath: () => home, logger: { warn: () => {} }, get: () => undefined,
    provide: (name, service) => { services[name] = service }, on: () => {},
    effect(fn) { const cleanup = fn(); if (typeof cleanup === 'function') cleanups.push(cleanup) },
    webServer: { register(route) { if (route.path === '/jan-api/always-on') handler = route.handler; return () => {} } },
    connection: { requestRejection: () => undefined },
    credentials: { readRecord: async () => undefined },
    workspaceController: { initializeDefault: async () => ({ workspace: { workspaceId: 'default' } }) },
    workspaceRegistry: { get: () => ({ title: 'Default' }) },
    agents: { get: () => undefined },
    sessionPersistence: { stat: async id => sessions.get(id) },
    sessionController: {
      create: async ({ sessionId, workspaceId }) => { sessions.set(sessionId, { workspaceId }); return { sessionId } },
      resolveAgent: async sessionId => ({ agent: { session: { id: sessionId } } }),
      modelCatalog: async () => ({ groups: [] }),
    },
    agentPresets: { defaultFor: () => null }, agentDefaultModel: { currentSelection: () => ({ provider: 'fixture' }) },
    sessions: { flush: async () => true }, systemPrompt: { section() {}, context() {} },
    schedule: {
      registerSessionDestination(sessionId, _owner, receive) { destinations.set(sessionId, receive); return () => destinations.delete(sessionId) },
      registerDestination() { return () => {} }, registerWakeSource() { return { dispose() {}, wake() {} } },
      catalog: async () => tasks,
      async create(request) {
        const row = { ...request, id: `task-${tasks.length + 1}`, status: 'active' }
        tasks.push(row)
        assert.ok(destinations.has(request.target.sessionId))
        if (/Paused/.test(row.title)) {
          const receive = destinations.get(request.target.sessionId)
          await assert.rejects(async () => receive({ id: 'during-import', taskId: row.id, prompt: 'Do not enqueue' }), /bot-import-in-progress/)
          attempts.push(row.id)
        }
        return row
      },
      async edit({ id, action, patch }) {
        const i = tasks.findIndex(row => row.id === id)
        if (action === 'delete') {
          if (failDelete) throw new Error('delete failed')
          tasks.splice(i, 1)
          return { id, deleted: true }
        }
        assert.deepEqual(patch, { active: false })
        if (failPause) throw new Error('pause failed')
        tasks[i].status = 'paused'
        return tasks[i]
      },
    },
  }, { enabled: { get: () => false } })
  t.after(async () => { for (const dispose of cleanups.reverse()) await dispose(); await rm(home, { recursive: true, force: true }) })
  function rpc(method, params) {
    const { promise, resolve, reject } = Promise.withResolvers()
    const req = { method: 'POST', headers: { 'content-type': 'application/json' }, async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify({ method, params })) } }
    const res = { writeHead() {}, end(body) { const value = JSON.parse(body); if (value.error) reject(new Error(value.error)); else resolve(value.result) } }
    handler(req, res).catch(reject)
    return promise
  }
  return { ...services.janBotImport, tasks, sessions, attempts, rpc }
}

const packet = {
  name: 'Atlas', role: 'Researcher', description: 'Summarize updates',
  memory: { instructions: 'Think carefully.\n' + '猫'.repeat(12000), memories: ['Past reports'], facts: ['Weekly digest'] },
  routines: [
    { name: 'Daily', prompt: 'Check reports', expression: '0 9 * * *', timeZone: 'America/New_York', paused: false },
    { name: 'Paused daily', prompt: 'Do not run yet', expression: '0 18 * * *', timeZone: 'UTC', paused: true },
  ],
}

test('creates a canonical bot, preserves full UTF-8 memory and denies delivery while a paused task is being staged', async t => {
  const h = await harness(t)
  assert.deepEqual(h.validateRoutine({ schedule_text: '0 9 * * *' }, 'America/New_York'), { expression: '0 9 * * *', timeZone: 'America/New_York' })
  assert.deepEqual(h.validateRoutine({ schedule_cron: '0 9 * * *', timezone: 'Not/AZone' }, 'UTC'), { reason: 'invalid-time-zone' })
  const result = await h.importBot(packet)
  assert.equal(h.sessions.get(result.sessionId).workspaceId, 'default')
  assert.deepEqual(h.tasks.map(({ title, target, timing, status }) => ({ title, target, timing, status })), packet.routines.map(row => ({ title: row.name,
    target: { kind: 'session', sessionId: result.sessionId }, timing: { kind: 'cron', cron: { expression: row.expression, time_zone: row.timeZone } }, status: row.paused ? 'paused' : 'active' })))
  assert.deepEqual(h.attempts, ['task-2'])
  const detail = await h.rpc('detail', { id: result.botId })
  assert.equal(detail.paused, false)
  assert.deepEqual(detail.events, [])
  const read = path => h.rpc('read', { id: result.botId, path })
  const index = await read('index.md')
  assert.match(index.text, /notes\/imported-memory\.md/)
  const instructions = await read('instructions.md')
  const spill = await read('notes/imported-instructions.md')
  assert.equal((instructions.text + spill.text).replace(/[^猫]/gu, '').length, 12000)
  assert.doesNotMatch(instructions.text + spill.text, /�/u)
  assert.match((await read('notes/imported-memory.md')).text, /Past reports[\s\S]+Weekly digest/)
  await assert.rejects(h.importBot({ ...packet, name: 'atlas' }), /bot-already-here/)
  assert.equal(h.sessions.size, 1)
  assert.equal((await h.rpc('create', { name: 'Another bot' })).paused, false)
})

test('deletes a newly created task when pausing it fails', async t => {
  const h = await harness(t, { failPause: true })
  const result = await h.importBot({ ...packet, routines: [packet.routines[1]] })
  assert.equal(result.routines[0].reason, 'pause-failed-removed')
  assert.equal(h.tasks.length, 0)
  assert.equal((await h.rpc('detail', { id: result.botId })).paused, false)
})

test('keeps the bot paused and reports the remaining task when cleanup fails', async t => {
  const h = await harness(t, { failPause: true, failDelete: true })
  const result = await h.importBot({ ...packet, routines: [packet.routines[1]] })
  assert.equal(result.routines[0].reason, 'pause-cleanup-failed')
  assert.equal(result.routines[0].id, h.tasks[0].id)
  assert.equal((await h.rpc('detail', { id: result.botId })).paused, true)
})
