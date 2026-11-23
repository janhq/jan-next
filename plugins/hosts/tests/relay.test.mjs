import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { connect, createServer as createTcpServer } from 'node:net'
import { authorized, connectTarget, startRelay } from '../relay.mjs'

async function listening(server) {
  const { promise, resolve } = Promise.withResolvers()
  server.listen(0, '127.0.0.1', resolve)
  await promise
  return server.address().port
}

function basic(password) {
  return `Basic ${Buffer.from(`jan:${password}`).toString('base64')}`
}

/** Send one raw CONNECT and read the status line plus whatever the tunnel echoes. */
async function rawConnect(relayPort, target, header, payload) {
  const socket = connect(relayPort, '127.0.0.1')
  const { promise, resolve } = Promise.withResolvers()
  let data = ''
  socket.on('data', (chunk) => {
    data += chunk
    if (payload === undefined || data.includes(payload)) { socket.destroy(); resolve(data) }
  })
  socket.on('close', () => resolve(data))
  socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n${header === undefined ? '' : `Proxy-Authorization: ${header}\r\n`}\r\n`)
  if (payload !== undefined) socket.write(payload)
  return promise
}

test('a tunnel opens only with the relay password and carries bytes both ways', async (t) => {
  const echo = createTcpServer(socket => socket.pipe(socket))
  const echoPort = await listening(echo)
  const relay = await startRelay()
  t.after(async () => { await relay.close(); echo.close() })
  const ok = await rawConnect(relay.port, `127.0.0.1:${echoPort}`, basic(relay.password), 'ping-through-tunnel')
  assert.match(ok, /^HTTP\/1\.1 200 /)
  assert.match(ok, /ping-through-tunnel/)
  assert.match(await rawConnect(relay.port, `127.0.0.1:${echoPort}`, undefined), /^HTTP\/1\.1 407 /)
  assert.match(await rawConnect(relay.port, `127.0.0.1:${echoPort}`, basic('wrong')), /^HTTP\/1\.1 407 /)
})

test('a plain http request through the relay reaches the target without the proxy header', async (t) => {
  const seen = []
  const target = createServer((req, res) => { seen.push(req.headers); res.end('from target') })
  const targetPort = await listening(target)
  const relay = await startRelay()
  t.after(async () => { await relay.close(); target.close() })
  const { request } = await import('node:http')
  const answer = await new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: relay.port, path: `http://127.0.0.1:${targetPort}/x`, headers: { 'proxy-authorization': basic(relay.password) } }, (res) => {
      let body = ''
      res.on('data', chunk => { body += chunk })
      res.on('end', () => resolve({ status: res.statusCode, body }))
    })
    req.once('error', reject)
    req.end()
  })
  assert.deepEqual(answer, { status: 200, body: 'from target' })
  assert.equal(seen[0]['proxy-authorization'], undefined)
})

test('an unreachable provider is a 502, not a hang', async (t) => {
  const closed = createTcpServer()
  const port = await listening(closed)
  await new Promise(resolve => closed.close(resolve))
  const relay = await startRelay()
  t.after(() => relay.close())
  assert.match(await rawConnect(relay.port, `127.0.0.1:${port}`, basic(relay.password)), /^HTTP\/1\.1 502 /)
})

test('proxy credentials and CONNECT targets are parsed strictly', () => {
  assert.equal(authorized(basic('s3cret'), 's3cret'), true)
  assert.equal(authorized(basic('s3cret'), 's3cre'), false)
  assert.equal(authorized('Bearer s3cret', 's3cret'), false)
  assert.equal(authorized(undefined, 's3cret'), false)
  assert.deepEqual(connectTarget('api.openai.com:443'), { host: 'api.openai.com', port: 443 })
  assert.deepEqual(connectTarget('[::1]:8080'), { host: '::1', port: 8080 })
  assert.equal(connectTarget('api.openai.com'), undefined)
  assert.equal(connectTarget('host:0'), undefined)
  assert.equal(connectTarget('a b:443'), undefined)
})

test('the remote proxy URL carries the password for the forwarded port', async (t) => {
  const relay = await startRelay()
  t.after(() => relay.close())
  const url = new URL(relay.proxyUrl(41000))
  assert.equal(url.host, '127.0.0.1:41000')
  assert.equal(url.username, 'jan')
  assert.equal(url.password, relay.password)
})
