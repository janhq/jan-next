import { test } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'
import { createHostLink } from '../link.mjs'

test('aborting an idle federated subscription cancels it on the remote carrier', { timeout: 2000 }, async (t) => {
  const server = createServer((_req, res) => res.writeHead(302, { 'set-cookie': 'jan-auth=owner' }).end())
  const mux = new WebSocketServer({ server })
  const opened = Promise.withResolvers()
  const cancelled = Promise.withResolvers()
  mux.on('connection', socket => socket.on('message', data => {
    const frame = JSON.parse(String(data))
    if (frame.type === 'open') opened.resolve(frame.streamId)
    if (frame.type === 'cancel') cancelled.resolve(frame.streamId)
  }))
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const link = createHostLink({ root: `http://127.0.0.1:${server.address().port}/`, token: 'test' })
  t.after(() => {
    link.close()
    for (const socket of mux.clients) socket.terminate()
    mux.close()
    server.close()
  })
  const abort = new AbortController()
  const next = link.stream('workspace/list', {}, abort.signal).next()
  const streamId = await opened.promise
  abort.abort()
  assert.equal((await next).done, true)
  assert.equal(await cancelled.promise, streamId)
})

test('negotiates local-only federation before opening the workspace stream', { timeout: 2000 }, async (t) => {
  const server = createServer((req, res) => {
    assert.equal(new URL(req.url, 'http://127.0.0.1').searchParams.get('forward'), 'local')
    res.writeHead(302, { 'set-cookie': 'jan-auth=owner' }).end()
  })
  const mux = new WebSocketServer({ server })
  mux.on('connection', socket => socket.once('message', data => {
    const { streamId } = JSON.parse(String(data))
    socket.send(JSON.stringify({ type: 'item', streamId, value: 'ready' }))
    socket.send(JSON.stringify({ type: 'end', streamId }))
  }))
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const link = createHostLink({ root: `http://127.0.0.1:${server.address().port}/`, token: 'test' })
  t.after(() => {
    link.close()
    for (const socket of mux.clients) socket.terminate()
    mux.close()
    server.close()
  })
  const frames = []
  for await (const value of link.stream('workspace/follow', {}, new AbortController().signal)) frames.push(value)
  assert.deepEqual(frames, ['ready'])
})

test('plugin POST signs in again after a 401 and returns the JSON response', { timeout: 2000 }, async (t) => {
  let signIns = 0
  const requests = []
  const server = createServer(async (req, res) => {
    if (req.url.startsWith('/connect?')) {
      return res.writeHead(302, { 'set-cookie': `jan-auth=login-${++signIns}` }).end()
    }
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    requests.push({ path: req.url, method: req.method, cookie: req.headers.cookie, type: req.headers['content-type'], body: Buffer.concat(chunks).toString() })
    if (requests.length === 1) return res.writeHead(401).end()
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ result: { projects: [] } }))
  })
  server.listen(0, '127.0.0.1')
  t.after(() => server.close())
  await once(server, 'listening')
  const link = createHostLink({ root: `http://127.0.0.1:${server.address().port}/`, token: 'test' })
  const body = { method: 'peerProjects', params: {} }
  assert.deepEqual(await link.post('jan-api/orchestration', body), { result: { projects: [] } })
  assert.equal(signIns, 2)
  assert.deepEqual(requests, ['login-1', 'login-2'].map(login => ({
    path: '/jan-api/orchestration', method: 'POST', cookie: `jan-auth=${login}`, type: 'application/json', body: JSON.stringify(body),
  })))
})

test('plugin POST reports a non-2xx HTTP status without decoding the response', { timeout: 2000 }, async (t) => {
  let signIns = 0
  const server = createServer((req, res) => {
    if (req.url.startsWith('/connect?')) {
      signIns++
      return res.writeHead(302, { 'set-cookie': 'jan-auth=owner' }).end()
    }
    res.writeHead(503).end('Unavailable')
  })
  server.listen(0, '127.0.0.1')
  t.after(() => server.close())
  await once(server, 'listening')
  const link = createHostLink({ root: `http://127.0.0.1:${server.address().port}/`, token: 'test' })
  await assert.rejects(async () => link.post('jan-api/orchestration', {}), {
    message: 'The other Jan answered HTTP 503 for jan-api/orchestration.',
  })
  assert.equal(signIns, 1)
})
