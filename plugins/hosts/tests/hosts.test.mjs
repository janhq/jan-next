import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { getCACertificates, setDefaultCACertificates } from 'node:tls'
import { dirname, join } from 'node:path'
import WebSocket, { WebSocketServer } from 'ws'
import { HostsStore, deviceFor, parseHostUrl, parseSshTarget } from '../store.mjs'
import { deviceAddressKind, lanAddresses, startGateway } from '../gateway.mjs'
import { openTunnel, startFailure, testHost } from '../remote.mjs'
import { sshArgs } from '../remote-install.mjs'

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

test('an SSH Host is its destination alone, saved once however it is written', async (t) => {
  const store = await home(t)
  const { connection } = await store.saveConnection({ name: 'Pi', kind: 'ssh', ssh: 'pi@Pi.local:2222', command: 'jan;rm -rf ~', profile: 'edge $(id)' })
  assert.deepEqual(Object.keys(connection).sort(), ['addedAt', 'id', 'kind', 'name', 'ssh'])
  assert.equal(connection.ssh, 'pi@pi.local:2222')
  await assert.rejects(store.saveConnection({ name: 'Pi again', kind: 'ssh', ssh: 'pi@PI.LOCAL:2222' }), { code: 'duplicate' })
})

test('saved IPv6 SSH destinations preserve the entire address, with or without a port', async (t) => {
  const store = await home(t)
  const plain = (await store.saveConnection({ name: 'Pi', kind: 'ssh', ssh: 'pi@[2001:db8::42]' })).connection
  const custom = (await store.saveConnection({ name: 'Pi test', kind: 'ssh', ssh: 'pi@[2001:db8::42]:2222' })).connection
  assert.equal(plain.ssh, 'pi@[2001:db8::42]')
  assert.equal(sshArgs(plain.ssh).at(-1), 'pi@2001:db8::42')
  assert.equal(sshArgs(plain.ssh).includes('-p'), false)
  assert.deepEqual(sshArgs(custom.ssh).slice(-3), ['-p', '2222', 'pi@2001:db8::42'])
  assert.equal(sshArgs('pi@2001:db8::42').at(-1), 'pi@2001:db8::42')
  assert.deepEqual(sshArgs('@2001:db8::42:22222').slice(-3), ['-p', '22222', '2001:db8::42'])
})

test('an SSH Host saved without a name is called by its destination; an address still needs one', async (t) => {
  const store = await home(t)
  const { connection } = await store.saveConnection({ name: '  ', kind: 'ssh', ssh: 'pi@Pi.local' })
  assert.equal(connection.name, 'pi@pi.local')
  await assert.rejects(store.saveConnection({ name: '', kind: 'url', url: 'http://10.0.0.2:3080' }), { code: 'name' })
})

test('editing an SSH Host saved by an older Jan drops its command, profile and port', async (t) => {
  const store = await home(t)
  await mkdir(dirname(store.connectionsFile), { recursive: true })
  await writeFile(store.connectionsFile, JSON.stringify({
    version: 1,
    connections: [{ id: 'a', name: 'Old', kind: 'ssh', ssh: 'pi@pi.local', remotePort: 3080, command: 'jan', profile: 'web', addedAt: 1 }],
  }))
  const { connection } = await store.saveConnection({ id: 'a', name: 'Old', kind: 'ssh', ssh: 'pi@pi.local' })
  assert.deepEqual(connection, { id: 'a', name: 'Old', kind: 'ssh', ssh: 'pi@pi.local', addedAt: 1 })
})

test('the devices file holds no usable token', async (t) => {
  const store = await home(t)
  const { token } = await store.pairDevice('Phone')
  assert.doesNotMatch(await readFile(store.devicesFile, 'utf8'), new RegExp(token))
  assert.equal(typeof deviceFor(await store.deviceHashes(), token), 'string')
  assert.equal(deviceFor(await store.deviceHashes(), `${token}x`), undefined)
})

async function upstream(t, status) {
  const seen = []
  const server = createServer((req, res) => {
    seen.push({ url: req.url, cookie: req.headers.cookie, host: req.headers.host })
    res.writeHead(status ?? 200, { 'content-type': 'text/plain', 'set-cookie': 'owner=leak' })
    res.end('jan')
  })
  const sockets = new WebSocketServer({ server })
  sockets.on('connection', (socket) => { socket.on('message', data => socket.send(data)) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => { sockets.close(); server.close(resolve) }))
  return { origin: `http://127.0.0.1:${server.address().port}`, seen }
}

let tlsFixture
async function testTls(store) {
  if (tlsFixture !== undefined) return tlsFixture
  const certFile = join(dirname(dirname(store.devicesFile)), 'cert.pem')
  const keyFile = join(dirname(certFile), 'key.pem')
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', keyFile, '-out', certFile], { stdio: 'ignore' })
  const [cert, key] = await Promise.all([readFile(certFile), readFile(keyFile)])
  return tlsFixture = { cert, key }
}

async function gatewayFor(t, store, options = {}) {
  const up = await upstream(t, options.upstreamStatus)
  const tls = await testTls(store)
  const trust = getCACertificates('default')
  setDefaultCACertificates([...trust, tls.cert.toString()])
  t.after(() => setDefaultCACertificates(trust))
  let hashes = await store.deviceHashes()
  const upsert = async (label) => {
    const paired = await store.pairDevice(label)
    hashes = await store.deviceHashes()
    return paired
  }
  const gateway = await startGateway({
    host: '127.0.0.1', port: 0, upstream: up.origin, tls,
    ownerCookie: options.ownerCookie ?? (() => Promise.resolve('jan-auth-x=owner')), hashes: () => hashes, seen: () => { },
    pair: options.pair === undefined ? upsert : label => options.pair(label, upsert),
  })
  t.after(() => gateway.close())
  return { gateway, up, reload: async () => { hashes = await store.deviceHashes() } }
}

test('the gateway refuses an unpaired device and never hands out the owner login', async (t) => {
  const store = await home(t)
  const { gateway, up } = await gatewayFor(t, store)
  const refused = await fetch(`${gateway.url}/`)
  assert.equal(refused.status, 401)
  assert.equal(up.seen.length, 0)

  const link = gateway.pairUrl('Phone')
  const paired = await fetch(link, { redirect: 'manual' })
  assert.equal(paired.status, 303)
  const cookie = paired.headers.get('set-cookie').split(';')[0]
  const page = await fetch(`${gateway.url}/`, { headers: { cookie } })
  assert.equal((await fetch(link, { redirect: 'manual' })).status, 401)
  assert.equal((await fetch(`${gateway.url}/`, { headers: { cookie: `jan-device=${new URL(link).searchParams.get('t')}` } })).status, 401)
  assert.equal((await store.devices()).length, 1)
  assert.equal(await page.text(), 'jan')
  assert.equal(page.headers.get('set-cookie'), null)
  assert.equal(up.seen[0].cookie, 'jan-auth-x=owner')
})

test('the gateway rejects invalid request-target forms before checking pairing', async (t) => {
  const { gateway, up } = await gatewayFor(t, await home(t))
  const url = new URL(gateway.url)
  for (const path of ['//[', 'https://example.com/', '/path#fragment']) {
    const status = await new Promise((resolve, reject) => {
      httpsRequest(url, { path }, res => { res.resume(); resolve(res.statusCode) }).once('error', reject).end()
    })
    assert.equal(status, 400)
  }
  assert.equal(up.seen.length, 0)
})

test('the gateway refuses a rebound Host or a foreign Origin before rewriting them to loopback', async (t) => {
  const store = await home(t)
  const { token } = await store.pairDevice('Phone')
  const { gateway, up } = await gatewayFor(t, store)
  const cookie = `jan-device=${token}`
  const url = new URL(gateway.url)
  // The certificate covers the gateway's IP; a rebound page's Host is checked after the handshake.
  const status = headers => new Promise((resolve, reject) => {
    httpsRequest(url, { path: '/', headers: { cookie, ...headers }, checkServerIdentity: () => undefined }, res => { res.resume(); resolve(res.statusCode) }).once('error', reject).end()
  })
  assert.equal(await status({ host: `attacker.example:${url.port}` }), 403)
  assert.equal(await status({ origin: 'https://attacker.example' }), 403)
  assert.equal(await status({ 'sec-fetch-site': 'cross-site' }), 403)
  const opened = new WebSocket(`${gateway.url.replace('http', 'ws')}/api/remote.mux`, { headers: { cookie }, origin: 'https://attacker.example' })
  await assert.rejects(new Promise((resolve, reject) => { opened.once('open', resolve); opened.once('error', reject) }))
  assert.equal(up.seen.length, 0)

  assert.equal(await status({ origin: url.origin }), 200)
  assert.equal(up.seen.length, 1)
})

test('automatic gateway selection excludes public, link-local and loopback interfaces', () => {
  const ipv4 = (address, internal = false) => [{ family: 'IPv4', address, internal }]
  const ipv6 = (address, internal = false) => [{ family: 'IPv6', address, internal }]
  const found = lanAddresses({
    public: ipv4('8.8.8.8'), link: ipv4('169.254.1.2'), lo: ipv4('127.0.0.1', true),
    tailnet: ipv4('100.64.1.3'), ethernet: ipv4('172.20.0.1'), wifi: ipv4('192.168.1.10'),
    tailnetV6: ipv6('fd7a:115c:a1e0::42'), otherV6: ipv6('fd7a:115c:a1e1::42'),
  })
  assert.deepEqual(found.map(item => item.interface), ['wifi', 'ethernet', 'tailnet', 'tailnetV6'])
  assert.deepEqual(lanAddresses({ public: ipv4('8.8.8.8') }), [])
})

test('only loopback and the exact tailnet ranges qualify for HTTP without consent', () => {
  for (const ip of ['127.0.0.1', '0:0:0:0:0:0:0:1']) assert.equal(deviceAddressKind(ip), 'loopback')
  for (const ip of ['100.64.0.1', '100.127.255.254', 'FD7A:115C:A1E0:0:1::42']) assert.equal(deviceAddressKind(ip), 'tailnet')
  for (const ip of ['100.63.255.255', '100.128.0.0', 'fd7a:115c:a1e1::1', '203.0.113.1', '::']) assert.equal(deviceAddressKind(ip), 'other')
  assert.equal(deviceAddressKind('192.168.1.10'), 'lan')
})

test('an unused QR link expires after ten minutes', async (t) => {
  const store = await home(t)
  const { gateway } = await gatewayFor(t, store)
  let now = Date.now()
  t.mock.method(Date, 'now', () => now)
  const link = gateway.pairUrl('Phone')
  now += 10 * 60_000
  assert.equal((await fetch(link, { redirect: 'manual' })).status, 401)
  assert.equal((await store.devices()).length, 0)
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

test('a pairing write failure leaves the one-use setup link available', async (t) => {
  const store = await home(t)
  let fail = true
  const { gateway } = await gatewayFor(t, store, { pair(label, upsert) {
    if (fail) { fail = false; throw new Error('Device write failed') }
    return upsert(label)
  } })
  const setup = gateway.setupUrl()
  assert.equal((await fetch(setup, { redirect: 'manual' })).status, 502)
  assert.equal(gateway.setupUrl(), setup)
  const attempts = await Promise.all([fetch(setup, { redirect: 'manual' }), fetch(setup, { redirect: 'manual' })])
  assert.deepEqual(attempts.map(result => result.status).sort(), [303, 401])
  assert.equal((await store.devices()).length, 1)
})

test('a gateway sign-in retry that fails returns 502 to the device', async (t) => {
  const store = await home(t)
  const { token } = await store.pairDevice('Phone')
  let signIns = 0
  const { gateway } = await gatewayFor(t, store, { upstreamStatus: 401, async ownerCookie() {
    if (signIns++ > 0) throw new Error('Sign-in failed')
    return 'jan-auth-x=owner'
  } })
  const result = await fetch(`${gateway.url}/`, { headers: { cookie: `jan-device=${token}` } })
  assert.equal(result.status, 502)
})

test('the gateway uses HTTPS and sets a Secure cookie when pairing a device', async (t) => {
  const store = await home(t)
  const { gateway } = await gatewayFor(t, store)
  const url = new URL(gateway.pairUrl('Phone'))
  assert.equal(url.protocol, 'https:')
  const response = await new Promise((resolve, reject) => {
    httpsRequest(url, res => { res.resume(); resolve(res) }).once('error', reject).end()
  })
  assert.equal(response.statusCode, 303)
  assert.match(response.headers['set-cookie'][0], /; HttpOnly; SameSite=Lax;/)
  assert.match(response.headers['set-cookie'][0], /; Secure(?:;|$)/)
})

test('the SSH tunnel waits for a complete startup line on one stream', { skip: process.platform === 'win32' }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'jan-hosts-ssh-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  await writeFile(join(directory, 'ssh'), '#!/bin/sh\nprintf "jan web: http://"\nprintf "ssh diagnostic\\n" >&2\nsleep 0.1\nprintf "127.0.0.1:3080/?token=whole\\r\\n"\nexec sleep 30\n', { mode: 0o755 })
  const path = process.env.PATH
  process.env.PATH = `${directory}:${path}`
  t.after(() => { process.env.PATH = path })
  const tunnel = await openTunnel({ ssh: ['box'], command: () => 'jan', log() { } })
  t.after(() => { tunnel.close(); return tunnel.exited })
  assert.equal(tunnel.token, 'whole')
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
  assert.equal(startFailure(crash), `Error: dsh: profile "edge" does not exist; create it with 'dsh plugin --profile edge add <package>'`)
  assert.match(startFailure('node: /lib/x86_64-linux-gnu/libc.so.6: version `GLIBC_2.28\' not found (required by node)'), /glibc 2\.28 or newer/)
  assert.match(startFailure('sh: 1: /home/pi/.jan/hosts-runtime/current/node/bin/node: No such file or directory'), /incomplete.*Connect again/)
  assert.equal(startFailure('Error: EADDRINUSE: address already in use 127.0.0.1:3080\nNode.js v24'), 'Error: EADDRINUSE: address already in use 127.0.0.1:3080')
})
