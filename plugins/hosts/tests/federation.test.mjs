import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createFederation, mapIds, qualifyId, splitQualifiedId } from '../federation.mjs'
import { createHostLink } from '../link.mjs'

const HOST = '9d695f7d-0373-4cd5-b196-f3aeead173bc'
const logger = { warn() { } }

/** A connected Jan that answers unary calls from `answers` and streams from `streams`. */
function fakeLink({ answers = {}, streams = {} } = {}) {
  const calls = []
  return {
    calls,
    state: 'live',
    async callWire(endpoint, payload) {
      calls.push({ endpoint, payload })
      return answers[endpoint]?.(payload.args) ?? { ok: false, error: { code: 'x', message: `no ${endpoint}`, details: {} } }
    },
    async call(endpoint, args) {
      const result = await this.callWire(endpoint, { args })
      return result.value
    },
    async *stream(endpoint, _payload, signal) {
      for (const item of streams[endpoint] ?? []) yield item
      await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }))
    },
    close() { },
  }
}

async function take(iterable, count) {
  const out = []
  for await (const item of iterable) {
    out.push(item)
    if (out.length === count) break
  }
  return out
}

function localStream(items) {
  return async () => (async function*() {
    for (const item of items) yield item
    await new Promise(() => { })
  })()
}

test('qualified ids round-trip and leave plain ids alone', () => {
  const id = qualifyId(HOST, 'session-1')
  assert.deepEqual(splitQualifiedId(id), { hostId: HOST, id: 'session-1' })
  assert.equal(splitQualifiedId('session-1'), undefined)
  assert.deepEqual(
    mapIds({ sessionId: 'a', address: { kind: 'subagent', parentSessionId: 'p', childSessionId: 'c' }, projections: { kind: 'sequenced', asOfSeq: 1, values: {} }, title: 'a' }, id => `h~${id}`),
    { sessionId: 'h~a', address: { kind: 'subagent', parentSessionId: 'h~p', childSessionId: 'h~c' }, projections: { kind: 'sequenced', asOfSeq: 1, values: {} }, title: 'a' },
  )
})

test('a call naming another computer\'s chat goes there with the plain id and comes back qualified', async () => {
  const federation = createFederation({ logger })
  const link = fakeLink({ answers: { 'session/rename': args => ({ ok: true, value: { sessionId: args.request.sessionId, title: 'x' } }) } })
  federation.attach(HOST, 'homelab', link)
  let local = 0
  const result = await federation.forwarder.call(
    { endpoint: 'session/rename', payload: { args: { request: { sessionId: qualifyId(HOST, 'session-9'), title: 'x' } } }, signal: new AbortController().signal },
    async () => { local++; return { ok: true } },
  )
  assert.equal(local, 0)
  assert.deepEqual(link.calls[0].payload.args, { request: { sessionId: 'session-9', title: 'x' } })
  assert.deepEqual(result, { ok: true, value: { sessionId: qualifyId(HOST, 'session-9'), title: 'x' } })
})

test('a call with only this computer\'s ids stays here', async () => {
  const federation = createFederation({ logger })
  const link = fakeLink()
  federation.attach(HOST, 'homelab', link)
  const result = await federation.forwarder.call(
    { endpoint: 'session/rename', payload: { args: { request: { sessionId: 'session-1' } } }, signal: new AbortController().signal },
    async () => ({ ok: true, value: 'local' }),
  )
  assert.deepEqual(result, { ok: true, value: 'local' })
  assert.equal(link.calls.length, 0)
})

test('creating a project on another computer adopts the folder there', async () => {
  const federation = createFederation({ logger })
  const link = fakeLink({ answers: { 'workspace/create': args => ({ ok: true, value: { created: true, workspace: { workspaceId: 'w1', path: args.request.path, sessionIds: [] } } }) } })
  federation.attach(HOST, 'homelab', link)
  const result = await federation.forwarder.call(
    { endpoint: 'workspace/create', payload: { args: { request: { path: '/home/me/x', hostId: HOST } } }, signal: new AbortController().signal },
    async () => { throw new Error('must not run here') },
  )
  assert.deepEqual(link.calls[0].payload.args, { request: { path: '/home/me/x' } })
  assert.equal(result.value.workspace.workspaceId, qualifyId(HOST, 'w1'))
  assert.equal(result.value.workspace.hostName, 'homelab')
})

test('a raw upload for another computer\'s chat is staged on that computer', async (t) => {
  // The other Jan: signs the link in, then stages the upload under its own Session id.
  const received = []
  const remote = createServer((req, res) => {
    const url = new URL(req.url, 'http://remote')
    if (url.pathname === '/connect') { res.writeHead(302, { 'set-cookie': 'jan-auth=t; Path=/', location: '/' }).end(); return }
    const chunks = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => {
      received.push({ path: url.pathname, sessionId: url.searchParams.get('sessionId'), name: url.searchParams.get('name'), cookie: req.headers.cookie, body: Buffer.concat(chunks).toString() })
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, value: { receiptId: 'r1', file: { name: 'a.txt' } } }))
    })
  })
  await new Promise(resolve => remote.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => remote.close(resolve)))
  const link = createHostLink({ root: `http://127.0.0.1:${remote.address().port}/`, token: 'secret' })
  t.after(() => link.close())
  const federation = createFederation({ logger })
  federation.attach(HOST, 'homelab', link)
  // This Jan's upload route: the federation answers another computer's upload, the rest falls through.
  let local = 0
  const here = createServer(async (req, res) => {
    if (!await federation.upload(req, res)) { local++; req.resume(); res.writeHead(204).end() }
  })
  await new Promise(resolve => here.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => here.close(resolve)))
  const post = sessionId => fetch(`http://127.0.0.1:${here.address().port}/api/session/uploadFileBinary?${new URLSearchParams({ sessionId, name: 'a.txt' })}`, {
    method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: 'hello there',
  })

  const response = await post(qualifyId(HOST, 'session-9'))
  assert.deepEqual(await response.json(), { ok: true, value: { receiptId: 'r1', file: { name: 'a.txt' } } })
  assert.deepEqual(received, [{ path: '/api/session/uploadFileBinary', sessionId: 'session-9', name: 'a.txt', cookie: 'jan-auth=t', body: 'hello there' }])
  assert.equal((await post('session-1')).status, 204)
  assert.equal(local, 1)
})

test('the sidebar stream lists this computer\'s projects, then the connected computer\'s', async () => {
  const federation = createFederation({ logger })
  const view = (workspaceId, sessionIds) => ({ workspaceId, path: `/${workspaceId}`, title: workspaceId, sessionIds, createdAt: '', updatedAt: '' })
  federation.attach(HOST, 'homelab', fakeLink({
    streams: { 'workspace/follow': [{ type: 'baseline', value: { items: [view('w-remote', ['session-r'])], archivedSessionIds: [], pinnedSessionIds: ['session-r'] } }] },
  }))
  const controller = new AbortController()
  const stream = await federation.forwarder.stream(
    { endpoint: 'workspace/follow', payload: { args: {} }, signal: controller.signal },
    localStream([{ type: 'baseline', value: { items: [view('w-local', ['session-l'])], archivedSessionIds: [], pinnedSessionIds: [] } }]),
  )
  const [first, second] = await take(stream, 2)
  controller.abort()
  assert.equal(first.type, 'baseline')
  assert.equal(second.type, 'replace')
  assert.deepEqual(second.value.items.map(item => [item.workspaceId, item.hostName, item.sessionIds]), [
    ['w-local', undefined, ['session-l']],
    [qualifyId(HOST, 'w-remote'), 'homelab', [qualifyId(HOST, 'session-r')]],
  ])
  assert.deepEqual(second.value.pinnedSessionIds, [qualifyId(HOST, 'session-r')])
})

test('a sidebar opened before any computer connects takes in one connected later', { timeout: 2_000 }, async () => {
  const federation = createFederation({ logger })
  const view = { workspaceId: 'w', path: '/w', title: 'w', sessionIds: [], createdAt: '', updatedAt: '' }
  const controller = new AbortController()
  const stream = await federation.forwarder.stream(
    { endpoint: 'workspace/follow', payload: { args: {} }, signal: controller.signal },
    localStream([{ type: 'baseline', value: { items: [], archivedSessionIds: [], pinnedSessionIds: [] } }]),
  )
  const iterator = stream[Symbol.asyncIterator]()
  assert.equal((await iterator.next()).value.type, 'baseline')
  federation.attach(HOST, 'homelab', fakeLink({ streams: { 'workspace/follow': [{ type: 'baseline', value: { items: [view], archivedSessionIds: [], pinnedSessionIds: [] } }] } }))
  let frame
  do frame = (await iterator.next()).value
  while (frame.value.items.length === 0)
  controller.abort()
  assert.deepEqual(frame.value.items.map(item => [item.workspaceId, item.hostState]), [[qualifyId(HOST, 'w'), 'live']])
})

test('a disconnected computer\'s projects stay listed as offline', async () => {
  const federation = createFederation({ logger })
  const view = { workspaceId: 'w', path: '/w', title: 'w', sessionIds: [], createdAt: '', updatedAt: '' }
  federation.attach(HOST, 'homelab', fakeLink({ streams: { 'workspace/follow': [{ type: 'baseline', value: { items: [view], archivedSessionIds: [], pinnedSessionIds: [] } }] } }))
  const controller = new AbortController()
  const stream = await federation.forwarder.stream(
    { endpoint: 'workspace/follow', payload: { args: {} }, signal: controller.signal },
    localStream([{ type: 'baseline', value: { items: [], archivedSessionIds: [], pinnedSessionIds: [] } }]),
  )
  const iterator = stream[Symbol.asyncIterator]()
  await iterator.next()
  await iterator.next()
  federation.detach(HOST)
  let frame
  do frame = (await iterator.next()).value
  while (frame.value.items[0]?.hostState !== 'lost')
  controller.abort()
  assert.equal(frame.value.items[0].hostName, 'homelab')
  const refused = await federation.forwarder.call(
    { endpoint: 'session/create', payload: { args: { request: { workspaceId: qualifyId(HOST, 'w') } } }, signal: controller.signal },
    async () => { throw new Error('must not run here') },
  )
  assert.equal(refused.ok, false)
})
