import assert from 'node:assert/strict'
import { chmod, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { apply } from '../index.mjs'

/** Host service fake shared by the tool and protocol suites. The real AgentDelivery reads its session history. */
export async function fakeHost(t, { home, name = 'control', peers, register } = {}) {
  if (!home) {
    home = await mkdtemp(join(tmpdir(), 'jan-orch-host-'))
    t.after(() => rm(home, { recursive: true, force: true }))
  }
  const agents = new Map(), tools = new Map(), listeners = new Map(), effects = []
  const notifications = []
  const removals = []
  let route, nextSession = 0
  const sessionEvents = (session, event) => {
    for (const handler of listeners.get('session/event') ?? []) handler(session, event)
  }
  const emit = async (event, ...args) => {
    for (const handler of listeners.get(event) ?? []) await handler(...args)
  }
  function agent(id, events = [], header = {}) {
    const session = { header, snapshotEvents: () => events }
    function receive(mode, message) {
      const event = { type: 'user/message', data: message, seq: events.length + 1 }
      events.push(event)
      notifications.push({ id, mode, text: message.content[0].text })
      sessionEvents(session, event)
    }
    const value = { id, session, inbox: { nextTurn: [], nextStep: [] },
      followup: message => receive('followup', message), steer: message => receive('steer', message),
      cancel: () => removals.push(id) }
    agents.set(id, value)
    return value
  }
  const coordinator = agent(name)
  const services = new Map([['sessionTitle', {}]])
  if (peers) services.set('janHosts', peers)
  const ctx = {
    get: key => services.get(key),
    janHomePath: () => home,
    logger: { warn() {} },
    agents: { get: id => agents.get(id), withoutInitiator: fn => fn() },
    sessionController: {
      create: async () => ({ sessionId: agent(`worker-${++nextSession}`).id }),
      resolveAgent: async id => agents.has(id) ? { agent: agents.get(id) }
        : { error: Object.assign(new Error(`session "${id}" not found`), { code: 'session/not-found' }) },
      rename: async ({ sessionId, title }) => { agents.get(sessionId).title = title },
    },
    sessionPersistence: {
      async flush() {},
      async open(id) {
        return { async read(offset, count) { return { events: agents.get(id).session.snapshotEvents().slice(offset, offset + count) } },
          async [Symbol.asyncDispose]() {} }
      },
    },
    workspaceRegistry: { list: () => [{ title: `Project ${name}`, path: home, id: name, sessionIds: [name] }], archivedSessionIds: [] },
    workingDirectory: { ensure: async () => home },
    webServer: { register: entry => { route = entry.handler; return register?.(entry) ?? (() => { route = undefined }) } },
    connection: { requestRejection: () => undefined },
    tools: { register: (def, { when }) => { tools.set(def.name, { def, when }); return () => tools.delete(def.name) } },
    on(event, listener) {
      const handlers = listeners.get(event) ?? new Set()
      handlers.add(listener)
      listeners.set(event, handlers)
      const off = () => handlers.delete(listener)
      effects.push(off)
      return off
    },
    effect(callback) { effects.push(callback()) },
  }
  let open = false
  async function start() { open = true; await apply(ctx) }
  async function dispose() {
    if (!open) return
    open = false
    for (const off of effects.splice(0).reverse()) await off()
  }
  async function call(tool, args, from = coordinator) {
    const { def } = tools.get(`orchestration_${tool}`)
    return JSON.parse(await def.execute(args, { agent: from, signal: new AbortController().signal }))
  }
  const request = async (method, params, headers) => {
    const req = Object.assign((async function* () { yield Buffer.from(JSON.stringify({ method, params })) })(), {
      method: 'POST', headers: { 'content-type': 'application/json', ...headers },
    })
    let body
    await route(req, { writeHead() {}, end: value => { body = JSON.parse(value) } })
    if (body.error) throw new Error(body.error)
    return body.result
  }
  t.after(dispose)
  return { agents, tools, notifications, removals, coordinator, call, request, start, dispose, home, ctx, agent, emit }
}

const task = (title, extra) => ({ title, spec: `Write ${title}.`, worktree: 'current', ...extra })

// federation.test.mjs uses the fixture without registering this file's own tests twice.
if (process.argv[1] === import.meta.filename) {
  test('starts ready workers and dispatches their dependents after a successful report', async t => {
    const host = await fakeHost(t)
    await host.start()
    const { tasks: [a, b] } = await host.call('start', { tasks: [task('A'), task('B', { depends_on: ['A'] })] })
    assert.equal(a.status, 'dispatched')
    assert.equal(b.status, 'pending')
    assert.equal(host.agents.size, 2)
    const worker = host.agents.get(a.sessionId)
    await host.call('done', { outcome: 'succeeded', summary: 'Wrote A.', files_modified: ['A.txt'] }, worker)
    const { tasks } = await host.call('tasks', {})
    assert.deepEqual(tasks.map(item => item.status), ['completed', 'dispatched'])
    assert.deepEqual(tasks[0].result, { outcome: 'succeeded', summary: 'Wrote A.', filesModified: ['A.txt'] })
    assert.equal(host.agents.size, 3)
    assert.match(host.notifications.find(item => item.id === host.coordinator.id).text, /DONE: Wrote A\.\nOutcome: succeeded/)
    await assert.rejects(host.call('done', { outcome: 'succeeded', summary: 'Again' }, worker), /already sent for this dispatch/)
  })

  test('rejects a dependency cycle without creating tasks', async t => {
    const host = await fakeHost(t)
    await host.start()
    await assert.rejects(host.call('start', { tasks: [task('A', { depends_on: ['B'] }), task('B', { depends_on: ['A'] })] }), /cycle/)
    assert.deepEqual(await host.call('tasks', {}), { tasks: [] })
    assert.equal(host.agents.size, 1)
  })

  test('only exposes the applicable tools and enforces the same role at execution', async t => {
    const host = await fakeHost(t)
    await host.start()
    const { tasks: [a] } = await host.call('start', { tasks: [task('A')] })
    const worker = host.agents.get(a.sessionId)
    const subagent = host.agent('child', [], { origin: 'subagent' })
    const available = agent => [...host.tools].filter(([, tool]) => tool.when({ agent })).map(([name]) => name.replace('orchestration_', ''))
    assert.deepEqual(available(host.coordinator), ['targets', 'start', 'tasks', 'send', 'read', 'stop'])
    assert.deepEqual(available(worker), ['report', 'ask', 'done'])
    assert.deepEqual(available(subagent), [])
    await assert.rejects(host.call('report', { message: 'Wrong role' }), /worker chats/)
    await assert.rejects(host.call('start', { tasks: [task('B')] }, worker), /coordinator chats/)
  })

  test('lists the panel contract and stops and retries through the same task record', async t => {
    const host = await fakeHost(t)
    await host.start()
    const { tasks: [a] } = await host.call('start', { tasks: [task('A')] })
    assert.deepEqual(await host.request('uiTasks', { coordinatorSessionId: host.coordinator.id }), { tasks: [{
      taskId: a.taskId, title: 'A', status: 'dispatched', hostName: 'This computer', isolation: { kind: 'shared', reason: 'requested' },
      undelivered: 0, dispatch: { id: a.dispatchId, status: 'running', sessionId: a.sessionId, host: 'local' },
    }] })
    assert.deepEqual(await host.request('uiStop', { taskId: a.taskId }), { stopped: true })
    assert.deepEqual(host.removals, [a.sessionId])
    await assert.rejects(host.call('send', { to: a.taskId, message: 'Go' }), /is stopped; start a retry/)
    const { tasks: [retry] } = await host.call('start', { tasks: [task('A', { retry_of: a.taskId })] })
    assert.equal(retry.taskId, a.taskId)
    assert.notEqual(retry.dispatchId, a.dispatchId)
    assert.notEqual(retry.sessionId, a.sessionId)
  })

  test('retains messages for an archived coordinator and re-delivers them on startup', async t => {
    const host = await fakeHost(t)
    await host.start()
    const { tasks: [a] } = await host.call('start', { tasks: [task('A')] })
    host.ctx.workspaceRegistry.archivedSessionIds.push(host.coordinator.id)
    await host.call('report', { message: 'Draft ready.' }, host.agents.get(a.sessionId))
    assert.equal(host.notifications.filter(item => item.id === host.coordinator.id).length, 0)
    const { tasks: [before] } = await host.call('tasks', {})
    assert.equal(before.undelivered, 1)
    await host.dispose()
    host.ctx.workspaceRegistry.archivedSessionIds.length = 0
    await host.start()
    const { tasks: [after] } = await host.call('tasks', {})
    assert.equal(after.undelivered, 0)
    assert.match(host.notifications.find(item => item.id === host.coordinator.id).text, /STATUS: Draft ready\./)
  })

  test('retires reports for a deleted coordinator so retention can reclaim them', async t => {
    const host = await fakeHost(t)
    await host.start()
    const { tasks: [a] } = await host.call('start', { tasks: [task('A')] })
    host.agents.delete(host.coordinator.id)
    await host.call('report', { message: 'Draft ready.' }, host.agents.get(a.sessionId))
    const { tasks: [after] } = await host.call('tasks', {})
    assert.equal(after.undelivered, 0)
    assert.equal(host.notifications.filter(item => item.id === host.coordinator.id).length, 0)
  })

  test('delivers a report and starts dependents once a failed save succeeds', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, async t => {
    const host = await fakeHost(t)
    await host.start()
    const { tasks: [a] } = await host.call('start', { tasks: [task('A'), task('B', { depends_on: ['A'] })] })
    const worker = host.agents.get(a.sessionId)
    const directory = join(host.home, 'orchestration')
    t.mock.timers.enable({ apis: ['setTimeout'] })
    await chmod(directory, 0o500)
    try {
      await assert.rejects(host.call('done', { outcome: 'succeeded', summary: 'Wrote A.' }, worker), /Could not save orchestration state/)
    } finally {
      await chmod(directory, 0o700)
    }
    assert.equal(host.notifications.filter(item => item.id === host.coordinator.id).length, 0)
    t.mock.timers.tick(5000)
    t.mock.timers.reset()
    for (let turn = 0; turn < 100 && host.agents.size < 3; turn++) await new Promise(setImmediate)
    const { tasks } = await host.call('tasks', {})
    assert.deepEqual(tasks.map(item => item.status), ['completed', 'dispatched'])
    assert.match(host.notifications.find(item => item.id === host.coordinator.id).text, /DONE: Wrote A\./)
    await host.dispose()
  })

  test('cancels a local worker even when saving its stop fails', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, async t => {
    const host = await fakeHost(t)
    await host.start()
    const { tasks: [a] } = await host.call('start', { tasks: [task('A')] })
    const directory = join(host.home, 'orchestration')
    await chmod(directory, 0o500)
    try {
      await assert.rejects(host.call('stop', { task: a.taskId }), /Could not save orchestration state/)
    } finally {
      await chmod(directory, 0o700)
    }
    assert.deepEqual(host.removals, [a.sessionId])
    await host.dispose()
  })

  test('stops a local worker that is still being created without orphaning its chat', async t => {
    const host = await fakeHost(t)
    await host.start()
    const create = host.ctx.sessionController.create
    let release, entered
    const creating = new Promise(resolve => { entered = resolve })
    host.ctx.sessionController.create = async params => {
      entered()
      await new Promise(resolve => { release = resolve })
      return create(params)
    }
    const starting = host.call('start', { tasks: [task('A')] })
    await creating
    const { tasks: [pending] } = await host.call('tasks', {})
    const stopping = host.call('stop', { task: pending.taskId })
    release()
    await Promise.all([starting, stopping])
    const { tasks: [stopped] } = await host.call('tasks', {})
    assert.equal(stopped.status, 'stopped')
    assert.ok(stopped.dispatch.sessionId)
    assert.deepEqual(host.removals, [stopped.dispatch.sessionId])
  })
}
