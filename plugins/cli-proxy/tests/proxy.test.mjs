import assert from 'node:assert/strict'
import { once, EventEmitter } from 'node:events'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { Context } from '@janhq/cordis'
import { createUserMessage, LlmRuntime } from '@janhq/jan-llm'
import { ProxyProcess } from '../process.mjs'
import { SubscriptionProxy } from '../subscriptions.mjs'
import { installBinary } from '../release.mjs'
import { modelRoute } from '../route.mjs'

async function until(read, predicate) {
  const end = Date.now() + 4000
  do {
    const value = read()
    if (predicate(value)) return value
    await sleep(10)
  } while (Date.now() < end)
  assert.fail('Expected subscription state did not arrive')
}

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'jan-cli-proxy-test-'))
  const requests = []
  const reservation = createServer().listen(0, '127.0.0.1')
  await once(reservation, 'listening')
  const callback = `http://127.0.0.1:${reservation.address().port}/auth/callback`
  await new Promise(resolve => reservation.close(resolve))
  const authorize = new URL('https://example.com/sign-in')
  authorize.searchParams.set('redirect_uri', callback)
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  const changes = []
  ctx.on('llm/adapters-updated', () => changes.push(ctx.llm.listProviders().map(provider => provider.id)))
  const workers = []
  let files = [{ name: 'claude.json', provider: 'claude', email: 'casey@example.com' }]
  let signedIn = false
  let cancelled = false
  let wait = false
  let stop
  t.after(async () => { await stop?.(); await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  const process = new ProxyProcess(root, {
    install: async () => 'fake-executable',
    launch: (binary, args, options) => {
      assert.equal(binary, 'fake-executable')
      assert.equal(args[0], '--config')
      assert.equal(options.windowsHide, true)
      const child = new EventEmitter()
      const server = createServer()
      child.kill = () => { server.close(() => child.emit('exit', 0)); server.closeAllConnections(); return true }
      workers.push(child)
      void readFile(args[1], 'utf8').then(async text => {
        const config = JSON.parse(text)
        assert.equal(config.server.host, '127.0.0.1')
        assert.equal(config.server.discovery.enabled, false)
        assert.equal(config.management['allow-remote'], false)
        assert.notEqual(config.management['secret-key'], config.access['api-keys'][0])
        assert.equal(config.oauth['auth-dir'], join(root, 'auth'))
        server.on('request', (req, res) => {
          const url = new URL(req.url, 'http://127.0.0.1')
          requests.push([req.method, url.pathname, url.searchParams])
          if (req.method === 'POST' && url.pathname === '/v1/messages') {
            assert.equal(req.headers['x-api-key'], config.access['api-keys'][0])
            req.resume()
            res.writeHead(200, { 'content-type': 'text/event-stream' })
            for (const frame of [
              { type: 'message_start', message: { id: 'msg_1', role: 'assistant', model: 'claude-sonnet', content: [],
                usage: { input_tokens: 3, output_tokens: 1 } } },
              { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
              { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hello' } },
              { type: 'content_block_stop', index: 0 },
              { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } },
              { type: 'message_stop' },
            ]) res.write(`event: ${frame.type}\ndata: ${JSON.stringify(frame)}\n\n`)
            res.end()
            return
          }
          const key = url.pathname === '/v1/models' ? config.access['api-keys'][0] : config.management['secret-key']
          assert.equal(req.headers.authorization, `Bearer ${key}`)
          let value
          switch (`${req.method} ${url.pathname}`) {
            case 'GET /v1/models':
              value = { data: files.map(file => ({ id: file.provider === 'claude' ? 'claude-sonnet' : 'gpt-6', owned_by: file.provider })) }
              break
            case 'GET /v8/management/credentials': value = { files }; break
            case 'GET /v8/management/oauth/auth-url':
              value = { status: 'ok', url: authorize.href, state: 'codex-state', user_code: 'ABC-12' }; break
            case 'GET /v8/management/oauth/status':
              assert.equal(url.searchParams.get('state'), 'codex-state')
              if (wait || !signedIn) { value = { status: 'wait' }; break }
              if (files.length === 1) files = [...files, { name: 'codex.json', provider: 'codex', label: 'Jordan' }]
              value = { status: 'ok' }; break
            case 'DELETE /v8/management/oauth/session': cancelled = true; value = { cancelled: true }; break
            case 'DELETE /v8/management/credentials':
              files = files.filter(file => file.name !== url.searchParams.get('name')); value = { status: 'ok' }; break
            default: assert.fail(`Unexpected request ${req.method} ${url.pathname}`)
          }
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(value))
        })
        server.listen(config.server.port, config.server.host)
        await once(server, 'listening')
      }).catch(error => child.emit('error', error))
      return child
    },
  })
  const proxy = new SubscriptionProxy(process, modelRoute(ctx), { pollMs: 60 })
  stop = () => proxy.dispose()
  return { proxy, requests, workers, ctx, changes, authorize, callback, complete: () => { signedIn = true },
    hold: () => { wait = true }, cancelled: () => cancelled }
}

test('brings up the authenticated loopback proxy and updates its model route after sign-in and sign-out', async t => {
  const { proxy, ctx, changes, requests, authorize, callback, complete } = await fixture(t)
  await proxy.start()
  const models = async () => (await ctx.llm.listModels('cli-proxy')).map(({ id }) => id)
  assert.deepEqual(await models(), ['claude-sonnet'])
  assert.deepEqual(proxy.state().accounts, [{ id: 'claude.json', provider: 'claude', label: 'casey@example.com' }])
  const chunks = await Array.fromAsync(ctx.llm.stream({ provider: 'cli-proxy', model: 'claude-sonnet', messages: [
    createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Hi' }] }),
  ] }))
  assert.equal(chunks.at(-1)?.reason?.kind, 'stop', JSON.stringify(chunks))
  assert.ok(chunks.some(chunk => chunk.type === 'text-delta' && chunk.text === 'hello'), JSON.stringify(chunks))
  proxy.signIn('codex')
  const pending = await until(() => proxy.state(), state => state.signIn?.url)
  assert.equal(pending.signIn.url, authorize.href)
  assert.equal(pending.signIn.code, 'ABC-12')
  assert.equal((await fetch(`${callback}?code=one-time-code&state=wrong`, { redirect: 'manual' })).status, 404)
  // An unparseable request target is refused; the listener keeps serving the real callback.
  const raw = connect(Number(new URL(callback).port), '127.0.0.1')
  raw.end('GET //[ HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n')
  const [rawReply] = await Promise.all([Array.fromAsync(raw).then(parts => Buffer.concat(parts).toString()), once(raw, 'close')])
  assert.match(rawReply, /^HTTP\/1\.1 404 /)
  const redirect = await fetch(`${callback}?code=one-time-code&state=codex-state`, { redirect: 'manual' })
  assert.equal(new URL(redirect.headers.get('location')).pathname, '/codex/callback')
  complete()
  await until(() => proxy.state(), state => state.signIn === null)
  assert.equal(proxy.state().accounts[1].label, 'Jordan')
  assert.deepEqual(await models(), ['claude-sonnet', 'gpt-6'])
  assert.deepEqual(changes, [['cli-proxy'], ['cli-proxy']])
  assert.equal(requests.find(([, path]) => path.endsWith('auth-url'))[2].get('is_webui'), 'false')
  await proxy.signOut('claude.json')
  await proxy.signOut('codex.json')
  assert.deepEqual(proxy.state().accounts, [])
  assert.deepEqual(ctx.llm.listProviders(), [])
  assert.deepEqual(changes.at(-1), [])
})

test('cancels a pending upstream attempt without changing connected accounts', async t => {
  const { proxy, hold, cancelled } = await fixture(t)
  hold()
  proxy.signIn('codex')
  await until(() => proxy.state(), state => state.signIn?.url)
  await proxy.cancel()
  assert.equal(cancelled(), true)
  assert.equal(proxy.state().signIn, null)
  assert.equal(proxy.state().accounts.length, 1)
})

test('withdraws the model route on child exit and restores it after a restart', async t => {
  const { proxy, ctx, workers } = await fixture(t)
  const count = () => ctx.llm.listProviders().length
  await proxy.start()
  workers[0].kill()
  await until(count, value => value === 0)
  await until(count, value => value === 1)
  assert.equal(workers.length, 2)
})

test('refuses a release with a mismatched checksum before extracting it', async t => {
  const root = await mkdtemp(join(tmpdir(), 'jan-cli-proxy-download-test-'))
  const states = []
  const archive = 'not an upstream release'
  const downloads = { start: input => {
    states.push(input)
    return { update: update => states.push(update), finish: (...result) => states.push(result) }
  } }
  t.after(() => rm(root, { recursive: true, force: true }))
  await assert.rejects(installBinary(root, AbortSignal.timeout(3000), () => {}, {
    downloads,
    fetchAsset: async () => new Response(archive, { headers: { 'content-length': String(archive.length) } }),
    platform: 'darwin', arch: 'arm64',
  }), /checksum/i)
  assert.deepEqual(states[0], { id: 'cli-proxy-api', kind: 'backend', name: 'CLIProxyAPI v8.1.2' })
  assert.deepEqual(states[1], { state: 'downloading' })
  assert.deepEqual(states[2], { receivedBytes: 0, totalBytes: archive.length })
  assert.equal(states.findLast(state => state.receivedBytes !== undefined)?.receivedBytes, archive.length)
  assert.deepEqual(states.at(-1).slice(0, 2), ['failed', 'CLIProxyAPI archive checksum mismatch'])
  await assert.rejects(readFile(join(root, 'v8.1.2', 'cli-proxy-api')), { code: 'ENOENT' })
})

test('settles a cancelled archive fetch without publishing an executable', async t => {
  const root = await mkdtemp(join(tmpdir(), 'jan-cli-proxy-cancel-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const cancellation = new AbortController()
  const fetching = Promise.withResolvers()
  let cancelAction
  let outcome
  const installing = installBinary(root, AbortSignal.timeout(3000), () => {}, {
    platform: 'darwin', arch: 'arm64',
    downloadSignal: cancellation.signal,
    cancel: () => cancellation.abort(),
    downloads: { start: ({ actions }) => {
      cancelAction = actions.cancel
      return { update: () => {}, finish: state => { outcome = state } }
    } },
    fetchAsset: (_url, { signal }) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      fetching.resolve()
    }),
  })
  await fetching.promise
  await cancelAction()
  await assert.rejects(installing, { name: 'AbortError' })
  assert.equal(outcome, 'cancelled')
  await assert.rejects(readFile(join(root, 'v8.1.2', 'cli-proxy-api')), { code: 'ENOENT' })
})

test('does not create an inbox item for a cached proxy executable', async t => {
  const root = await mkdtemp(join(tmpdir(), 'jan-cli-proxy-cache-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const directory = join(root, 'v8.1.2')
  const binary = join(directory, 'cli-proxy-api')
  await mkdir(directory)
  await writeFile(binary, '')
  assert.equal(await installBinary(root, AbortSignal.timeout(3000), () => assert.fail('unexpected progress'), {
    platform: 'darwin', arch: 'arm64',
    fetchAsset: () => assert.fail('unexpected download'),
    downloads: { start: () => assert.fail('unexpected inbox item') },
  }), binary)
})

test('gives each proxy launch its own configuration file and removes it when the child ends', async t => {
  const root = await mkdtemp(join(tmpdir(), 'jan-cli-proxy-config-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const launches = []
  const launch = (_binary, args) => {
    const child = new EventEmitter()
    child.kill = () => true
    // Read what this launch was handed after both Hosts have written theirs, then fail startup.
    launches.push(new Promise(resolve => setImmediate(async () => {
      resolve({ path: args[1], config: JSON.parse(await readFile(args[1], 'utf8')) })
      child.emit('exit', 1)
    })))
    return child
  }
  const start = () => new ProxyProcess(root, { install: async () => 'fake-executable', launch })
    .start(AbortSignal.timeout(3000), () => {}, () => {})
  const results = await Promise.allSettled([start(), start()])
  assert.deepEqual(results.map(({ status }) => status), ['rejected', 'rejected'])
  const [first, second] = await Promise.all(launches)
  assert.notEqual(first.path, second.path)
  assert.notEqual(first.config.access['api-keys'][0], second.config.access['api-keys'][0])
  // Removal runs when each child reports its exit.
  const leftovers = async () => (await readdir(root)).filter(name => name.startsWith('config'))
  for (let tries = 0; (await leftovers()).length > 0 && tries < 100; tries++) await sleep(10)
  assert.deepEqual(await leftovers(), [])
})
