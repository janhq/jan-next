import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../index.mjs'
import { PROBE_BEGIN, PROBE_END } from '../install-target.mjs'

async function mountedHosts(t, config = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'jan-hosts-api-'))
  const records = new Map()
  const disposers = []
  const writes = []
  const settings = { ...config.saved }
  let volatileUpdate
  let route
  let janHosts
  const server = createServer((req, res) => {
    if (req.url === '/') { res.writeHead(303, { 'set-cookie': 'owner=test' }).end(); return }
    return route.handler(req, res)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const root = `http://127.0.0.1:${server.address().port}`
  t.after(async () => {
    for (const dispose of disposers.reverse()) await dispose()
    await new Promise(resolve => server.close(resolve))
    await rm(directory, { recursive: true, force: true })
  })
  apply({
    janHomePath: () => directory,
    typertGateway: { registerForwarder: () => () => {} },
    logger: { warn() {}, info() {} },
    fiber: { entry: { options: { id: 'jan-hosts', config: settings } } },
    settings: {
      async update(_ns, patch) {
        writes.push(patch)
        const changed = Object.entries(patch).some(([key, value]) => (settings[key] ?? false) !== value)
        Object.assign(settings, patch)
        if (changed) volatileUpdate()
      },
    },
    provide(name, service) { if (name === 'janHosts') janHosts = service },
    get: () => undefined,
    credentials: {
      readRecord: async key => records.get(key),
      modifyRecord: async (key, change) => { records.set(key, await change(records.get(key))) },
      deleteRecord: async key => { records.delete(key) },
    },
    connection: { requestRejection: () => undefined, authenticatedUrl: url => url },
    webServer: { getOrigin: () => root, register: value => { route = value; return () => {} } },
    effect: start => { disposers.push(start()) },
    on: (event, callback) => {
      if (event === 'loader/volatile-update') volatileUpdate = callback
      return () => {}
    },
  }, {
    ...config,
    gatewayEnabled: { get: () => settings.gatewayEnabled ?? false },
    gatewayAllowInsecureLan: { get: () => settings.gatewayAllowInsecureLan ?? false },
  })
  return {
    records,
    directory,
    writes,
    janHosts,
    async call(method, params) {
      const result = await fetch(`${root}/jan-api/hosts`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method, params }),
      })
      const body = await result.json()
      if (!result.ok) throw new Error(body.error)
      return body.result
    },
  }
}

test('an Address Host keeps its login for the same normalized URL but never sends it to a replacement', async (t) => {
  const { call, records } = await mountedHosts(t)
  const { id } = await call('save', { name: 'Office', kind: 'url', url: 'https://example.com/?token=old' })
  const save = url => call('save', { id, name: 'Office', kind: 'url', url })
  const open = async () => (await call('open', { id })).url
  assert.equal((await save('https://EXAMPLE.com:443')).signedIn, true)
  assert.equal(await open(), 'https://example.com/?token=old')
  assert.equal((await save('https://example.com/other')).signedIn, false)
  assert.equal(await open(), 'https://example.com/other/')
  assert.equal(records.size, 0)
  await save('https://example.net/?token=new')
  assert.equal(await open(), 'https://example.net/?token=new')
})

test('janHosts lists saved peers and reuses Address Host sign-in until the login or URL changes', async (t) => {
  const { call, janHosts } = await mountedHosts(t)
  const signIns = []
  const peer = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    if (url.pathname.endsWith('/connect')) {
      const token = url.searchParams.get('token')
      signIns.push([url.pathname, token])
      return res.writeHead(302, { 'set-cookie': `jan-auth=${token}` }).end()
    }
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const { method, params } = JSON.parse(Buffer.concat(chunks).toString())
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
      result: { path: url.pathname, method, params, cookie: req.headers.cookie },
    }))
  })
  await new Promise(resolve => peer.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => peer.close(resolve)))
  const address = `http://127.0.0.1:${peer.address().port}`
  const { id } = await call('save', { name: 'Office', kind: 'url', url: `${address}/?token=first` })
  const ssh = await call('save', { name: 'Server', kind: 'ssh', ssh: 'server' })
  const request = () => janHosts.callPlugin(id, 'orchestration', 'peerRead', { limit: 1 })
  assert.deepEqual(await janHosts.peers(), [
    { id, name: 'Office', kind: 'url', state: 'connected' },
    { id: ssh.id, name: 'Server', kind: 'ssh', state: 'offline' },
  ])
  assert.deepEqual(signIns, [])
  assert.deepEqual(await request(), {
    path: '/jan-api/orchestration', method: 'peerRead', params: { limit: 1 }, cookie: 'jan-auth=first',
  })
  await request()
  assert.deepEqual(signIns, [['/connect', 'first']])
  const save = url => call('save', { id, name: 'Office', kind: 'url', url })
  await save(`${address}/?token=second`)
  assert.equal((await request()).cookie, 'jan-auth=second')
  await save(`${address}/new/`)
  assert.equal((await janHosts.peers())[0].state, 'offline')
  const unavailable = { code: 'not-connected', message: 'That computer is not connected. Connect it in Settings, Hosts.' }
  await assert.rejects(request, unavailable)
  await save(`${address}/new/?token=second`)
  assert.equal((await request()).path, '/new/jan-api/orchestration')
  await call('remove', { id })
  await assert.rejects(request, unavailable)
  assert.deepEqual(signIns, [['/connect', 'first'], ['/connect', 'second'], ['/new/connect', 'second']])
})

test('janHosts surfaces the remote plugin operation error', async (t) => {
  const { call, janHosts } = await mountedHosts(t)
  const peer = createServer((req, res) => {
    if (req.url.startsWith('/connect?')) return res.writeHead(302, { 'set-cookie': 'jan-auth=test' }).end()
    res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'Worker is already stopped.' }))
  })
  await new Promise(resolve => peer.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => peer.close(resolve)))
  const { id } = await call('save', { name: 'Office', kind: 'url', url: `http://127.0.0.1:${peer.address().port}/?token=test` })
  await assert.rejects(janHosts.callPlugin(id, 'orchestration', 'peerStop', {}), { message: 'Worker is already stopped.' })
})

test('editing a connected SSH destination closes its tunnel instead of reusing it', { skip: process.platform === 'win32' }, async (t) => {
  const { call, directory } = await mountedHosts(t, { relay: false })
  const path = process.env.PATH
  process.env.PATH = `${directory}:${path}`
  t.after(() => { process.env.PATH = path })
  const sha256 = 'a'.repeat(64)
  await writeFile(join(directory, 'jan-host-runtime-1-linux-x64.tar.gz'), '')
  await writeFile(join(directory, 'jan-host-runtime-1-linux-x64.tar.gz.sha256'), sha256)
  await writeFile(join(directory, 'ssh'), `#!/bin/sh
if [ "$1" = -tt ]; then
  echo 'jan web: http://127.0.0.1:3080/?token=ssh-token'
  exec sleep 30
fi
cat <<'PROBE'
${PROBE_BEGIN}
os=Linux
arch=x86_64
home=/home/example
libc=glibc 2.34
tool=tar
tool=gzip
tool=sha256sum
installed=1+${sha256.slice(0, 12)}
${PROBE_END}
PROBE
`, { mode: 0o755 })
  const previous = process.env.JAN_HOST_RUNTIME_DIR
  process.env.JAN_HOST_RUNTIME_DIR = directory
  t.after(() => {
    if (previous === undefined) delete process.env.JAN_HOST_RUNTIME_DIR
    else process.env.JAN_HOST_RUNTIME_DIR = previous
  })
  const { id } = await call('save', { name: 'Office', kind: 'ssh', ssh: 'one' })
  assert.ok((await call('connect', { id })).tunnel)
  assert.ok((await call('save', { id, name: 'New name', kind: 'ssh', ssh: 'one' })).tunnel)
  assert.equal((await call('save', { id, name: 'New name', kind: 'ssh', ssh: 'two' })).tunnel, undefined)
  await assert.rejects(call('open', { id }), /Connect first/)
})

test('loopback device access works without opting into cleartext LAN access', async (t) => {
  const { call, writes } = await mountedHosts(t, { gatewayHost: '127.0.0.1' })
  await call('enableGateway', { enabled: true })
  const { gateway } = await call('state')
  assert.equal(gateway.running, true)
  assert.equal(gateway.secure, false)
  assert.equal(gateway.allowInsecureLan, false)
  assert.match(gateway.url, /^http:\/\//)
  assert.deepEqual(writes, [{ gatewayEnabled: true, gatewayAllowInsecureLan: false }])
})

test('new device access on private LAN does not opt into cleartext', async (t) => {
  const { call, writes } = await mountedHosts(t, { gatewayHost: '192.168.112.217' })
  const initial = (await call('state')).gateway
  assert.equal(initial.lanAvailable, true)
  assert.equal(initial.allowInsecureLan, false)
  await call('enableGateway', { enabled: true })
  const { gateway } = await call('state')
  assert.equal(gateway.running, false)
  assert.match(gateway.error, /allow unencrypted LAN access/i)
  assert.deepEqual(writes, [{ gatewayEnabled: true, gatewayAllowInsecureLan: false }])
})

test('an enabled LAN gateway saved before the opt-in existed stays off until cleartext is allowed', async (t) => {
  const { call, writes } = await mountedHosts(t, { saved: { gatewayEnabled: true }, gatewayHost: '192.168.112.217' })
  const before = (await call('state')).gateway
  assert.equal(before.allowInsecureLan, false)
  assert.equal(before.running, false)
  assert.match(before.error, /allow unencrypted LAN access/i)
  assert.deepEqual(writes, [])
  await call('allowInsecureLan', { allowed: true })
  assert.equal((await call('state')).gateway.allowInsecureLan, true)
  assert.deepEqual(writes, [{ gatewayAllowInsecureLan: true }])
})

test('incomplete device TLS configuration does not fall back to cleartext', async (t) => {
  const { call } = await mountedHosts(t, { gatewayHost: '127.0.0.1', gatewayTlsCertFile: 'cert.pem' })
  await call('enableGateway', { enabled: true })
  const { gateway } = await call('state')
  assert.equal(gateway.running, false)
  assert.match(gateway.error, /both gatewayTlsCertFile and gatewayTlsKeyFile/)
})
