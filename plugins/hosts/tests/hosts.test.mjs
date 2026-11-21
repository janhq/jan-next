import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import WebSocket, { WebSocketServer } from 'ws'
import { HostsStore, deviceFor, parseHostUrl, parseSshTarget } from '../store.mjs'
import { startGateway } from '../gateway.mjs'
import { startFailure, testHost } from '../remote.mjs'

async function home(t) {
  const directory = await mkdtemp(join(tmpdir(), 'jan-hosts-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  // A fresh Jan home has no hosts folder; the store creates it on first write.
  return new HostsStore(join(directory, 'hosts'))
}

test('a pasted Jan link keeps its token out of the saved address', async (t) => {
  const store = await home(t)
  const { connection, token } = await store.saveConnection({ name: 'Office', kind: 'url', url: 'http://192.168.1.20:3080/?token=abc' })
  assert.equal(connection.url, 'http://192.168.1.20:3080/')
  assert.equal(token, 'abc')
  assert.doesNotMatch(await readFile(store.connectionsFile, 'utf8'), /abc/)
})

test('names are unique ignoring case and one address is saved once', async (t) => {
  const store = await home(t)
  await store.saveConnection({ name: 'Office', kind: 'url', url: 'http://10.0.0.2:3080' })
  await assert.rejects(store.saveConnection({ name: 'office', kind: 'url', url: 'http://10.0.0.3:3080' }), { code: 'name-taken' })
  await assert.rejects(store.saveConnection({ name: 'Box', kind: 'url', url: 'http://10.0.0.2:3080/' }), { code: 'duplicate' })
})

test('SSH targets that ssh would read as an option are refused', () => {
  assert.deepEqual(parseSshTarget('pi@raspberrypi.local:2222'), { user: 'pi', host: 'raspberrypi.local', port: 2222 })
  assert.throws(() => parseSshTarget('-oProxyCommand=calc@host'), { code: 'ssh' })
  assert.throws(() => parseSshTarget('pi@-host'), { code: 'ssh' })
  assert.throws(() => parseHostUrl('file:///etc/passwd'), { code: 'url' })
})

test('the SSH command and profile cannot carry shell syntax', async (t) => {
  const store = await home(t)
  await assert.rejects(store.saveConnection({ name: 'Pi', kind: 'ssh', ssh: 'pi@pi.local', command: 'jan;rm -rf ~' }), { code: 'command' })
  await assert.rejects(store.saveConnection({ name: 'Pi', kind: 'ssh', ssh: 'pi@pi.local', profile: 'edge $(id)' }), { code: 'command' })
})

test('the devices file holds no usable token', async (t) => {
  const store = await home(t)
  const { token } = await store.pairDevice('Phone')
  assert.doesNotMatch(await readFile(store.devicesFile, 'utf8'), new RegExp(token))
  assert.equal(typeof deviceFor(await store.deviceHashes(), token), 'string')
  assert.equal(deviceFor(await store.deviceHashes(), `${token}x`), undefined)
})

async function upstream(t) {
  const seen = []
  const server = createServer((req, res) => {
    seen.push({ url: req.url, cookie: req.headers.cookie, host: req.headers.host })
    res.writeHead(200, { 'content-type': 'text/plain', 'set-cookie': 'owner=leak' })
    res.end('jan')
  })
  const sockets = new WebSocketServer({ server })
  sockets.on('connection', (socket) => { socket.on('message', data => socket.send(data)) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => { sockets.close(); server.close(resolve) }))
  return { origin: `http://127.0.0.1:${server.address().port}`, seen }
}

async function gatewayFor(t, store) {
  const up = await upstream(t)
  let hashes = await store.deviceHashes()
  const gateway = await startGateway({
    host: '127.0.0.1', port: 0, upstream: up.origin,
    ownerCookie: () => Promise.resolve('jan-auth-x=owner'), hashes: () => hashes, seen: () => { },
    pair: async (label) => { const paired = await store.pairDevice(label); hashes = await store.deviceHashes(); return paired },
  })
  t.after(() => gateway.close())
  return { gateway, up, reload: async () => { hashes = await store.deviceHashes() } }
}

test('the gateway refuses an unpaired device and never hands out the owner login', async (t) => {
  const store = await home(t)
  const { token } = await store.pairDevice('Phone')
  const { gateway, up } = await gatewayFor(t, store)
  const refused = await fetch(`${gateway.url}/`)
  assert.equal(refused.status, 401)
  assert.equal(up.seen.length, 0)

  const paired = await fetch(gateway.pairUrl(token), { redirect: 'manual' })
  assert.equal(paired.status, 303)
  const cookie = paired.headers.get('set-cookie').split(';')[0]
  const page = await fetch(`${gateway.url}/`, { headers: { cookie } })
  assert.equal(await page.text(), 'jan')
  assert.equal(page.headers.get('set-cookie'), null)
  assert.equal(up.seen[0].cookie, 'jan-auth-x=owner')
})

test('removing a device closes its live connection and refuses it afterwards', async (t) => {
  const store = await home(t)
  const { device, token } = await store.pairDevice('Phone')
  const { gateway, reload } = await gatewayFor(t, store)
  const cookie = `jan-device=${token}`
  const socket = new WebSocket(`${gateway.url.replace('http', 'ws')}/api/remote.mux`, { headers: { cookie } })
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject) })
  const echoed = new Promise(resolve => socket.once('message', data => resolve(String(data))))
  socket.send('ping')
  assert.equal(await echoed, 'ping')

  const closed = new Promise(resolve => socket.once('close', resolve))
  await store.revokeDevice(device.id)
  await reload()
  gateway.disconnect(device.id)
  await closed
  assert.equal((await fetch(`${gateway.url}/`, { headers: { cookie } })).status, 401)
})

test('the setup link pairs exactly one device', async (t) => {
  const store = await home(t)
  const { gateway } = await gatewayFor(t, store)
  const setup = gateway.setupUrl()
  assert.equal((await fetch(setup, { redirect: 'manual' })).status, 303)
  assert.equal((await fetch(setup, { redirect: 'manual' })).status, 401)
  assert.equal(gateway.setupUrl(), undefined)
  assert.equal((await store.devices()).length, 1)
})

// A Host from before the 2026-11-16 rename answers with its old product name over the same wire.
function fakeHost(t, sentence) {
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x')
    if (url.pathname === '/connect' && url.searchParams.get('token') === 'good') {
      res.writeHead(302, { location: './api/remote.mux', 'set-cookie': 'x-auth=1; HttpOnly' }).end()
      return
    }
    res.writeHead(401, { 'content-type': 'text/plain' }).end(sentence)
  })
  const sockets = new WebSocketServer({ server })
  t.after(() => { sockets.close(); server.close() })
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}/`)))
}

test('a Host from before the rename to Jan still tests as reachable', async (t) => {
  const old = await fakeHost(t, 'dsh web authentication required; reopen the URL printed by dsh web.\n')
  assert.equal((await testHost(old, 'good')).websocket, 'ok')
  assert.equal((await testHost(old, undefined)).http, 'login-needed')
  const other = await fakeHost(t, 'Unauthorized')
  assert.equal((await testHost(other, 'good')).http, 'not-jan')
})

test('a remote Jan that stops early reports its own reason, not the Node footer', () => {
  const crash = [
    'file:///srv/jan/app-boot/lib/index.js:1850',
    "    if (template === void 0) throw new Error(...)",
    '',
    `Error: dsh: profile "edge" does not exist; create it with 'dsh plugin --profile edge add <package>'`,
    '    at boot (file:///srv/jan/app-boot/lib/index.js:1850:9)',
    '',
    'Node.js v20.19.4',
  ].join('\n')
  assert.match(startFailure(crash), /no "edge" profile.*older release/)
  assert.match(startFailure('zsh:1: command not found: jan'), /not installed there/)
  assert.equal(startFailure('Error: EADDRINUSE: address already in use 127.0.0.1:3080\nNode.js v24'), 'Error: EADDRINUSE: address already in use 127.0.0.1:3080')
})
