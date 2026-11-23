import { once } from 'node:events'
import { createServer } from 'node:net'
import { request } from 'node:http'
import assert from 'node:assert/strict'
import { afterEach, it } from 'node:test'
import WebSocket from 'ws'
import { JanBrowserBridge } from '../bridge.mjs'

const ORIGIN = 'chrome-extension://mkciifcjehgnpaigoiaakdgabbpfppal'
const cleanup = []
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose()
})

async function unopenedBridge(overrides) {
  const reservation = createServer().listen(0, '127.0.0.1')
  await once(reservation, 'listening')
  const { port } = reservation.address()
  const bridge = new JanBrowserBridge({ port, connectTimeoutMs: 500, callTimeoutMs: 1000, ...overrides })
  const origin = `http://127.0.0.1:${port}`
  cleanup.push(() => bridge.dispose(), () => new Promise(resolve => reservation.close(resolve)))
  return { reservation, origin, bridge, url: origin.replace('http:', 'ws:') }
}

async function release(server) {
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
}

function connect(url, origin = ORIGIN) {
  const socket = new WebSocket(url, { origin })
  cleanup.push(async () => {
    if (socket.readyState === WebSocket.CLOSED) return
    const closed = once(socket, 'close')
    socket.terminate()
    await closed
  })
  return socket
}

it('listens lazily and sends a browser call only after the published extension handshake', async () => {
  const { reservation, bridge, origin, url } = await unopenedBridge()
  await release(reservation)
  await assert.rejects(fetch(origin, { method: 'HEAD' }))
  await bridge.listen()
  assert.equal((await fetch(origin, { method: 'HEAD' })).status, 204)
  const extension = connect(`${url}/?pid=work&pl=Work`)
  const hello = JSON.parse((await once(extension, 'message'))[0])
  assert.equal(hello.kind, 'hello')
  assert.equal(hello.activeProfileId, 'work')
  assert.equal(hello.profileCount, 1)
  assert.deepEqual(hello.profiles, [{ id: 'work', label: 'Work', ready: false }])
  const ready = bridge.waitForProfile(AbortSignal.timeout(1000))
  const state = once(extension, 'message')
  extension.send(JSON.stringify({ kind: 'ready', profileId: 'work' }))
  const profile = await ready
  assert.deepEqual(JSON.parse((await state)[0]).profiles, [{ id: 'work', label: 'Work', ready: true }])
  const incoming = once(extension, 'message')
  const operation = bridge.call(profile, 'browser_navigate', { target: 'example.org' }, AbortSignal.timeout(1000))
  const { id, ...request } = JSON.parse((await incoming)[0])
  assert.deepEqual(request, { kind: 'call', tool: 'browser_navigate', params: { target: 'example.org' } })
  const content = [{ type: 'text', text: 'Example Domain' }]
  extension.send(JSON.stringify({ kind: 'result', id, ok: true, content }))
  assert.deepEqual(await operation, { content })
})

it('rejects ordinary websites and tells the user how to install and connect Chrome', async () => {
  const bridge = new JanBrowserBridge({ port: 0, connectTimeoutMs: 30, callTimeoutMs: 1000 })
  cleanup.push(() => bridge.dispose())
  await bridge.listen()
  const socket = connect(`ws://127.0.0.1:${bridge.port}/?pid=web`, 'https://example.com')
  await assert.rejects(once(socket, 'open'), /403/)
  const malformed = request(`http://127.0.0.1:${bridge.port}`, {
    path: '//[',
    headers: { Connection: 'Upgrade', Upgrade: 'websocket', Origin: ORIGIN },
  })
  const response = once(malformed, 'response')
  malformed.end()
  const [denied] = await response
  assert.equal(denied.statusCode, 403)
  denied.resume()
  // A referenced timer keeps Node test alive while the production deadline is unref'd.
  const guard = setTimeout(() => {}, 2000)
  try {
    await assert.rejects(bridge.waitForProfile(AbortSignal.timeout(1000)), /chromewebstore\.google\.com.*click Connect/)
  } finally {
    clearTimeout(guard)
  }
})

it('does not replay an interrupted action or return a result from a newly selected profile', async () => {
  const bridge = new JanBrowserBridge({ port: 0, connectTimeoutMs: 500, callTimeoutMs: 1000 })
  cleanup.push(() => bridge.dispose())
  await bridge.listen()
  const url = `ws://127.0.0.1:${bridge.port}`
  const work = connect(`${url}/?pid=work`)
  await once(work, 'message')
  work.send(JSON.stringify({ kind: 'ready', profileId: 'work' }))
  const profile = await bridge.waitForProfile(AbortSignal.timeout(1000))
  const incoming = once(work, 'message')
  const cancellation = new AbortController()
  const action = bridge.call(profile, 'browser_click', { target: 's1e1' }, cancellation.signal)
  const { id } = JSON.parse((await incoming)[0])
  cancellation.abort()
  await assert.rejects(action, { name: 'AbortError' })
  assert.throws(() => bridge.call(profile, 'browser_tabs', {}, AbortSignal.timeout(1000)), /still running/)
  const other = connect(`${url}/?pid=personal`)
  await once(other, 'message')
  const update = once(work, 'message')
  other.send(JSON.stringify({ kind: 'ready', profileId: 'personal' }))
  await update
  const switched = once(work, 'message')
  other.send(JSON.stringify({ kind: 'activate_profile', profileId: 'personal' }))
  assert.equal(JSON.parse((await switched)[0]).activeProfileId, 'personal')
  work.send(JSON.stringify({ kind: 'result', id, ok: true, content: [{ type: 'text', text: 'Old result' }] }))
  assert.throws(() => bridge.call(profile, 'browser_tabs', {}, AbortSignal.timeout(1000)), /changed or disconnected/)
})
