import assert from 'node:assert/strict'
import { chmod, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { setTimeout } from 'node:timers/promises'
import { join } from 'node:path'
import test from 'node:test'
import { fakeHost } from './tools.test.mjs'

async function eventually(predicate, ms = 2000) {
  const signal = AbortSignal.timeout(ms)
  while (!await predicate()) await setTimeout(5, undefined, { signal })
}

async function pair(t) {
  const addresses = new Map()
  const calls = []
  let offline = false
  let refuseStop = false
  let loseStartReply = false
  let beforeAck
  const auth = 'Bearer federation-test'
  async function host(id, peerId, kind) {
    let handler
    const server = createServer((req, res) => {
      if (handler && req.url === '/jan-api/orchestration') return handler(req, res)
      res.writeHead(404).end()
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    addresses.set(id, `http://127.0.0.1:${server.address().port}/jan-api/orchestration`)
    t.after(() => { server.closeAllConnections(); server.close() })
    const value = await fakeHost(t, { name: `control-${id}`, register: entry => {
      handler = entry.handler
      return () => { handler = undefined }
    }, peers: {
      peers: async () => [{ id: peerId, name: `Host ${peerId.toUpperCase()}`, kind, state: 'connected' }],
      async callPlugin(target, feature, method, params, signal) {
        assert.equal(target, peerId)
        assert.equal(feature, 'orchestration')
        calls.push([id, method])
        if (offline && id === 'a' && (method === 'peerPull' || method === 'peerStop')) throw new Error('Peer is offline.')
        if (refuseStop && method === 'peerStop') throw Object.assign(new Error('Unknown remote worker dispatch.'), { code: 'rejected' })
        if (id === 'a' && method === 'peerAck' && beforeAck) await beforeAck(signal)
        const response = await fetch(addresses.get(target), { method: 'POST',
          headers: { 'content-type': 'application/json', authorization: auth }, body: JSON.stringify({ method, params }), signal })
        const body = await response.json()
        if (loseStartReply && method === 'peerStart') throw new Error('socket hang up')
        // Like Hosts' callPlugin: a 4xx is a refusal, a 5xx a temporary failure.
        if (body.error) throw Object.assign(new Error(body.error), response.status < 500 ? { code: 'rejected' } : {})
        assert.equal(response.status, 200)
        return body.result
      },
    } })
    value.ctx.connection.requestRejection = req => req.headers.authorization === auth ? undefined : 401
    await value.start()
    return value
  }
  const b = await host('b', 'a', 'url')
  const a = await host('a', 'b', 'ssh')
  const start = async () => {
    const { tasks: [task] } = await a.call('start', { tasks: [{ title: 'Draft', spec: 'Write the notes.', host: 'host b', worktree: 'current' }] })
    return { task, worker: b.agents.get(task.sessionId) }
  }
  const inbox = () => a.notifications.filter(update => update.id === a.coordinator.id)
  const state = async host => JSON.parse(await readFile(join(host.home, 'orchestration', 'state.json'), 'utf8'))
  const outbox = async () => (await state(b)).outbox
  return { a, b, start, inbox, outbox, state, auth, calls, blockAck: fn => { beforeAck = fn },
    setOffline: value => { offline = value }, setRefuseStop: value => { refuseStop = value }, setLoseStartReply: value => { loseStartReply = value } }
}

test('delivers sends and ordered reports between two Hosts, then clears the outbox', async t => {
  const { a, b, start, inbox, outbox, auth } = await pair(t)
  const { task, worker } = await start()
  assert.equal(task.status, 'dispatched')
  assert.equal((await a.call('targets', {})).hosts[1].projects[0].title, 'Project control-b')
  assert.deepEqual((await a.request('uiTasks', { coordinatorSessionId: a.coordinator.id }, { authorization: auth })).tasks[0].dispatch, {
    id: task.dispatchId, host: 'b', status: 'running', sessionId: worker.id, qualifiedSessionId: `b~${worker.id}`,
  })
  await a.call('send', { to: task.taskId, message: 'First draft only.' })
  assert.deepEqual(b.notifications.at(-1), { id: worker.id, mode: 'followup', text: '[Coordinator] First draft only.' })
  await b.call('report', { message: 'Draft ready.' }, worker)
  await b.call('done', { outcome: 'succeeded', summary: 'Notes written.' }, worker)
  await eventually(() => inbox().length === 2)
  assert.match(inbox()[0].text, /STATUS: Draft ready\./)
  assert.match(inbox()[1].text, /DONE: Notes written\.\nOutcome: succeeded/)
  await eventually(async () => (await outbox()).length === 0)
  assert.equal((await a.call('tasks', {})).tasks[0].status, 'completed')
})

test('resumes after a crash between delivery and ack without re-delivering a terminal message', async t => {
  const { a, b, start, inbox, outbox, state, calls, blockAck } = await pair(t)
  const { worker } = await start()
  const ackRequested = Promise.withResolvers()
  let failFlush = true
  a.ctx.sessionPersistence.flush = async () => {
    if (failFlush && inbox().length) {
      failFlush = false
      throw new Error('Interrupted after enqueue but before delivery was marked.')
    }
  }
  blockAck(async signal => {
    ackRequested.resolve()
    await setTimeout(60_000, undefined, { signal })
  })
  await b.call('done', { outcome: 'succeeded', summary: 'Completed before acknowledgement.' }, worker)
  const timeout = AbortSignal.timeout(2000)
  await Promise.race([ackRequested.promise, once(timeout, 'abort').then(() => { throw timeout.reason })])
  assert.equal(inbox().length, 1)
  assert.equal((await a.call('tasks', {})).tasks[0].undelivered, 1)
  assert.equal((await outbox()).length, 1)
  await a.dispose()
  blockAck(undefined)
  await a.start()
  await eventually(async () => (await outbox()).length === 0)
  assert.equal(inbox().length, 1)
  assert.equal((await a.call('tasks', {})).tasks[0].status, 'completed')
  assert.equal((await a.call('tasks', {})).tasks[0].undelivered, 0)
  await eventually(async () => {
    const { peerCursors, peerAcks } = await state(a)
    return peerAcks?.b === peerCursors.b
  })
  assert.equal(calls.filter(([id, method]) => id === 'a' && method === 'peerAck').length, 2)
  await a.dispose()
  calls.length = 0
  await a.start()
  assert.deepEqual(calls, [])
  await a.emit('jan-hosts/removed', 'b')
  const forgotten = await state(a)
  assert.deepEqual(forgotten.peerCursors, {})
  assert.deepEqual(forgotten.peerAcks, {})
})

test('retries a temporarily offline peer while a worker is still active', async t => {
  const { b, start, inbox, outbox, calls, setOffline } = await pair(t)
  setOffline(true)
  const { worker } = await start()
  await eventually(() => calls.some(([id, method]) => id === 'a' && method === 'peerPull'))
  await b.call('done', { outcome: 'succeeded', summary: 'Finished while offline.' }, worker)
  assert.equal(inbox().length, 0)
  assert.equal((await outbox()).length, 1)
  setOffline(false)
  await eventually(() => inbox().length === 1)
  assert.match(inbox()[0].text, /Finished while offline/)
  await eventually(async () => (await outbox()).length === 0)
})

test('stops a task whose Host is offline and delivers the stop once it is back', async t => {
  const { a, b, start, calls, state, setOffline } = await pair(t)
  setOffline(true)
  const { task } = await start()
  const result = await a.call('stop', { task: task.taskId })
  assert.equal(result.stopped, true)
  assert.match(result.note, /Host B is not reachable: Peer is offline\. The worker there stops/)
  assert.equal((await a.call('tasks', {})).tasks[0].status, 'stopped')
  assert.equal((await state(b)).dispatches[task.dispatchId].status, 'running')
  setOffline(false)
  await eventually(async () => (await state(b)).dispatches[task.dispatchId].status === 'stopped', 10_000)
  await eventually(async () => (await state(a)).dispatches[task.dispatchId].remoteStop === undefined)
  assert.ok(calls.some(([id, method]) => id === 'a' && method === 'peerStop'))
})

test('drops a stop the returning Host refuses and keeps receiving its other updates', async t => {
  const { a, b, inbox, state, setOffline, setRefuseStop } = await pair(t)
  setOffline(true)
  const draft = { spec: 'Write the notes.', host: 'host b', worktree: 'current' }
  const { tasks: [first, second] } = await a.call('start', { tasks: [{ title: 'First', ...draft }, { title: 'Second', ...draft }] })
  await a.call('stop', { task: first.taskId })
  setRefuseStop(true)
  setOffline(false)
  await eventually(async () => (await state(a)).dispatches[first.dispatchId].remoteStop === undefined, 10_000)
  await b.call('done', { outcome: 'succeeded', summary: 'Second finished.' }, b.agents.get(second.sessionId))
  await eventually(() => inbox().some(update => /Second finished/.test(update.text)), 30_000)
})

test('records a stop the remote Host refuses without retrying it', async t => {
  const { a, start, state, setRefuseStop } = await pair(t)
  const { task } = await start()
  setRefuseStop(true)
  const result = await a.call('stop', { task: task.taskId })
  assert.match(result.note, /Host B refused: Unknown remote worker dispatch\. The task is stopped here\./)
  assert.equal((await state(a)).dispatches[task.dispatchId].remoteStop, undefined)
  assert.equal((await a.call('tasks', {})).tasks[0].status, 'stopped')
})

test('stops a worker whose start reply was lost', async t => {
  const { a, b, state, setLoseStartReply } = await pair(t)
  setLoseStartReply(true)
  const { tasks: [task] } = await a.call('start', { tasks: [{ title: 'Draft', spec: 'Write the notes.', host: 'host b', worktree: 'current' }] })
  setLoseStartReply(false)
  await eventually(async () => (await a.call('tasks', {})).tasks[0].status === 'failed')
  await eventually(async () => (await state(a)).dispatches[task.dispatchId].remoteStop === undefined, 10_000)
  assert.equal((await state(b)).dispatches[task.dispatchId].status, 'stopped')
  assert.equal(b.removals.length, 1)
})

test('retries a remote stop whose save failed there, after cancelling the worker', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, async t => {
  const { a, b, start, state } = await pair(t)
  const { task, worker } = await start()
  const directory = join(b.home, 'orchestration')
  await chmod(directory, 0o500)
  let result
  try {
    result = await a.call('stop', { task: task.taskId })
  } finally {
    await chmod(directory, 0o700)
  }
  assert.match(result.note, /Could not save orchestration state/)
  assert.deepEqual(b.removals, [worker.id])
  await eventually(async () => (await state(a)).dispatches[task.dispatchId].remoteStop === undefined, 10_000)
  assert.equal((await state(b)).dispatches[task.dispatchId].status, 'stopped')
})

test('refuses worker operations from a Host other than the coordinator that started it', async t => {
  const { b, start, auth, state } = await pair(t)
  const { task } = await start()
  const other = '00000000-0000-4000-8000-000000000000'
  for (const [method, params] of [['peerRead', {}], ['peerStop', {}], ['peerSend', { message: { id: 'msg_aaaaaaaaaa', type: 'message', body: 'Hi' } }]]) {
    await assert.rejects(b.request(method, { ref: other, dispatchId: task.dispatchId, ...params }, { authorization: auth }), /Unknown remote worker dispatch/)
    await assert.rejects(b.request(method, { dispatchId: task.dispatchId, ...params }, { authorization: auth }), /Unknown remote worker dispatch/)
  }
  assert.equal((await state(b)).dispatches[task.dispatchId].status, 'running')
})
