import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { apply } from '../index.mjs'

async function harness(t, { failCreate = false, seed } = {}) {
  const home = await mkdtemp(join(tmpdir(), 'jan-bot-import-'))
  const services = {}, destinations = new Map(), tasks = [], sessions = new Map(), cleanups = [], attempts = []
  const profiles = new Map(), selections = [], listeners = new Map()
  await seed?.(home)
  let handler
  apply({ janHomePath: () => home, logger: { warn: () => {} }, get: () => undefined,
    provide: (name, service) => { services[name] = service }, on: (event, listener) => { listeners.set(event, listener) },
    effect(fn) { const cleanup = fn(); if (typeof cleanup === 'function') cleanups.push(cleanup) },
    webServer: { register(route) { if (route.path === '/jan-api/always-on') handler = route.handler; return () => {} } },
    connection: { requestRejection: () => undefined },
    credentials: { readRecord: async () => undefined },
    workspaceController: { initializeDefault: async () => ({ workspace: { workspaceId: 'default' } }), archiveSession: async () => {} },
    workspaceRegistry: { get: () => ({ title: 'Default' }) },
    agents: { get: () => undefined, turnBoundaryOf: () => ({ openTurnStartSeq: null }) },
    sessionPersistence: { stat: async id => sessions.get(id) },
    agentProfiles: {
      snapshot: () => ({ profiles: [...profiles.values()] }),
      list: async ({ workspaceId }) => ({ profiles: [...profiles.values()].filter(row => row.scope === 'global' || row.workspaceId === workspaceId) }),
      get: async ({ id }) => {
        if (profiles.has(id)) return profiles.get(id)
        throw Object.assign(new Error('No such agent'), { code: 'agent-profiles/not-found' })
      },
      save: async ({ scope, workspaceId, profile }) => {
        const row = { ...profile, scope, workspaceId, writable: true }
        profiles.set(profile.id, row)
        return row
      },
      select: async request => { selections.push(request) },
      remove: async ({ id }) => { profiles.delete(id) },
      profileForSession: session => selections.findLast(row => row.sessionId === session.id)?.id ?? null,
    },
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
        if (failCreate) throw new Error('create failed')
        const row = { ...request, id: `task-${tasks.length + 1}`, status: request.active === false ? 'paused' : 'active' }
        tasks.push(row)
        assert.ok(destinations.has(request.target.sessionId))
        if (row.status === 'active' && request.active !== undefined) {
          const receive = destinations.get(request.target.sessionId)
          await assert.rejects(async () => receive({ id: 'during-import', taskId: row.id, prompt: 'Do not enqueue' }), /bot-import-in-progress/)
          attempts.push(row.id)
        }
        return row
      },
      async edit({ id, action }) {
        if (action !== 'delete') throw new Error('Unexpected Schedule edit during import')
        tasks.splice(tasks.findIndex(row => row.id === id), 1)
        return { id, deleted: true }
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
  return { ...services.janBotImport, tasks, sessions, attempts, rpc, profiles, selections, listeners, home }
}

const packet = {
  name: 'Atlas', role: 'Researcher', description: 'Summarize updates',
  memory: { instructions: 'Think carefully.\n' + '猫'.repeat(12000), memories: ['Past reports'], facts: ['Weekly digest'] },
  routines: [
    { name: 'Daily', prompt: 'Check reports', expression: '0 9 * * *', timeZone: 'America/New_York', paused: false },
    { name: 'Paused daily', prompt: 'Do not run yet', expression: '0 18 * * *', timeZone: 'UTC', paused: true },
  ],
}

test('creates a canonical bot, preserves UTF-8 memory and creates paused routines without editing them', async t => {
  const h = await harness(t)
  assert.deepEqual(h.validateRoutine({ schedule_text: '0 9 * * *' }, 'America/New_York'), { expression: '0 9 * * *', timeZone: 'America/New_York' })
  assert.deepEqual(h.validateRoutine({ schedule_cron: '0 9 * * *', timezone: 'Not/AZone' }, 'UTC'), { reason: 'invalid-time-zone' })
  const result = await h.importBot(packet)
  assert.equal(h.sessions.get(result.sessionId).workspaceId, 'default')
  const agent = h.profiles.get('atlas')
  assert.equal(agent.description, packet.description)
  assert.equal(agent.scope, 'global')
  assert.deepEqual(h.selections, [{ sessionId: result.sessionId, id: 'atlas' }])
  assert.deepEqual(h.tasks.map(({ title, target, timing, status }) => ({ title, target, timing, status })), packet.routines.map(row => ({ title: row.name,
    target: { kind: 'session', sessionId: result.sessionId }, timing: { kind: 'cron', cron: { expression: row.expression, time_zone: row.timeZone } }, status: row.paused ? 'paused' : 'active' })))
  assert.deepEqual(h.attempts, ['task-1'])
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

test('creates, edits and shares a global agent without deleting it when a bot is removed', async t => {
  const h = await harness(t)
  const bot = await h.rpc('create', { name: '  PR Watcher  ', newAgent: { description: 'Pull requests', instructions: 'Watch PRs' } })
  assert.equal(bot.agentProfile, 'pr-watcher')
  assert.deepEqual((await h.rpc('listAgents', {})).map(row => row.id), ['pr-watcher'])
  await h.rpc('edit', { id: bot.id, patch: { agentChanges: { instructions: 'Only check open PRs' } } })
  assert.equal(h.profiles.get(bot.agentProfile).description, 'Pull requests')
  assert.equal((await h.rpc('getAgent', { id: bot.agentProfile })).instructions, 'Only check open PRs')
  assert.equal(h.selections.length, 1, 'an instruction edit does not apply the model again')
  await h.rpc('edit', { id: bot.id, patch: { agentChanges: { model: { provider: 'fixture', model: 'reviewer' } } } })
  assert.deepEqual(h.selections.at(-1), { sessionId: bot.sessionId, id: bot.agentProfile })
  const copy = await h.rpc('duplicate', { id: bot.id, name: 'Another watcher' })
  assert.equal(copy.agentProfile, bot.agentProfile)
  await h.rpc('delete', { id: bot.id })
  assert.equal(h.profiles.get(copy.agentProfile).instructions, 'Only check open PRs')
})

test('requires an explicit copy before editing a foreign agent and preserves its limits', async t => {
  const h = await harness(t)
  h.profiles.set('foreign', { id: 'foreign', scope: 'project', workspaceId: 'default', description: 'Read only',
    source: 'claude', use: 'primary', writable: false, instructions: 'Read PRs', tools: ['read'], disallowedTools: ['bash'] })
  h.profiles.set('child', { id: 'child', scope: 'global', use: 'subagent' })
  assert.deepEqual((await h.rpc('listAgents', {})).map(row => row.id), ['foreign'])
  const bot = await h.rpc('create', { name: 'Reader', agentProfile: 'foreign' })
  await assert.rejects(h.rpc('edit', { id: bot.id, patch: { agentChanges: { instructions: 'Replacement' } } }), /agent-read-only/u)
  assert.equal(h.profiles.get('foreign').instructions, 'Read PRs')
  const copied = await h.rpc('copyAgent', { id: 'foreign' })
  assert.equal(copied.scope, 'project')
  assert.equal(copied.workspaceId, 'default')
  assert.equal(copied.writable, true)
  assert.deepEqual(copied.tools, ['read'])
  assert.deepEqual(copied.disallowedTools, ['bash'])
})

test('backfills an existing bot chat selection once without changing its saved model', async t => {
  const id = '6cc09d56-f69d-457e-af42-000000000000', sessionId = 'session-existing'
  const homeFixture = async home => {
    const data = join(home, 'bots')
    const instructions = 'Watch PRs'
    const personaDigest = createHash('sha256').update(instructions).digest('hex')
    await mkdir(join(data, id), { recursive: true })
    await writeFile(join(data, id, `persona-${personaDigest}.md`), instructions)
    await writeFile(join(data, 'registry.json'), JSON.stringify({ version: 1, migrated: true, bots: [
      { id, sessionId, workspaceId: 'default', name: 'PR Watcher', role: '', personaDigest },
    ] }))
  }
  const h = await harness(t, { seed: homeFixture })
  assert.equal((await h.rpc('list'))[0].agentProfile, 'pr-watcher')
  const notifyCreated = h.listeners.get('agent/created')
  const agent = { id: sessionId, session: { id: sessionId }, ctx: { inject: () => ({ dispose() {} }) } }
  await notifyCreated({ agent })
  // A registry edit queues behind the asynchronous backfill marker write.
  await h.rpc('edit', { id, patch: { name: 'PR Watcher' } })
  assert.equal(JSON.parse(await readFile(join(h.home, 'bots', 'registry.json'), 'utf8')).bots[0].agentSelectionPending, undefined)
  await notifyCreated({ agent })
  assert.deepEqual(h.selections, [{ sessionId, id: 'pr-watcher', keepModel: true }])
})

test('reports a failed routine create without leaving a task or keeping the bot paused', async t => {
  const h = await harness(t, { failCreate: true })
  const result = await h.importBot({ ...packet, routines: [packet.routines[1]] })
  assert.deepEqual(result.routines, [{ name: 'Paused daily', status: 'failed', reason: 'routine-create-failed' }])
  assert.equal(h.tasks.length, 0)
  assert.equal((await h.rpc('detail', { id: result.botId })).paused, false)
})

test('creates a template bot with its agent and localized routines in the user time zone', async t => {
  const h = await harness(t)
  const { templateFor } = await import('../templates.mjs')
  const template = templateFor('weekly-status')
  const bot = await h.rpc('create', { name: 'Status', role: template.copy.de.role, avatar: { ...template.avatar, locked: false },
    newAgent: { description: template.description, instructions: template.instructions },
    template: template.id, timeZone: 'Europe/Berlin', locale: 'de' })
  assert.equal(h.profiles.get(bot.agentProfile).instructions, template.instructions)
  assert.equal(bot.routinesFailed, undefined)
  assert.deepEqual(h.tasks.map(({ title, timing, target }) => ({ title, timing, target })), [
    { title: 'Heute fällig', timing: { kind: 'cron', cron: { expression: '0 9 * * 1-5', time_zone: 'Europe/Berlin' } }, target: { kind: 'session', sessionId: bot.sessionId } },
    { title: 'Wöchentlicher Statusbericht', timing: { kind: 'cron', cron: { expression: '0 15 * * 5', time_zone: 'Europe/Berlin' } }, target: { kind: 'session', sessionId: bot.sessionId } },
  ])
  await h.rpc('create', { name: 'Brief', template: 'chief-of-staff', timeZone: 'Not/AZone' })
  assert.equal(h.tasks.at(-1).timing.cron.time_zone, 'UTC')
  assert.equal(h.tasks.at(-1).title, 'Morning brief')
  await assert.rejects(h.rpc('create', { name: 'Ghost', template: 'no-such-template' }), /template-not-found/)
  assert.equal(h.sessions.size, 2)
})
