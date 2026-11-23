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
