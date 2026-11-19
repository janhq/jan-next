import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../index.mjs'
import { mountAgentSettings } from '../../jan-theme/agent-settings.mjs'

async function withImporter(callback) {
  const root = await mkdtemp(join(tmpdir(), 'jan-import-'))
  const source = join(root, 'jan-data')
  const outside = join(root, 'outside.png')
  const threadId = 'sample'
  await mkdir(join(source, 'threads', threadId), { recursive: true })
  await writeFile(outside, 'outside image')
  const thread = { id: threadId, title: 'Images', created_at: 1000 }
  await writeFile(join(source, 'threads', threadId, 'thread.json'), JSON.stringify(thread))
  const saved = []
  const sessions = new Map()
  const failures = { append: 0 }
  const handleFor = id => ({
    get header() { return sessions.get(id).header },
    inheritedEventCount: 0,
    read: async () => ({ events: [...sessions.get(id).events] }),
    append: async events => {
      if (failures.append > 0) { failures.append--; throw new Error('disk full') }
      sessions.get(id).events.push(...events)
    },
    flush: async () => {},
    close: async () => {},
  })
  // Like the real backend: create persists the header before any event arrives.
  const persistence = {
    stat: async id => sessions.has(id) ? { header: sessions.get(id).header, eventCount: sessions.get(id).events.length } : undefined,
    create: async header => { sessions.set(header.id, { header, events: [] }); return handleFor(header.id) },
    open: async id => handleFor(id),
  }
  const workspace = { path: source, attachSession: async () => {} }
  const api = { register: ({ handler }) => { api.handler = handler; return () => {} } }
  const services = Object.create(null)
  const ctx = {
    fiber: {},
    effect: callback => callback(),
    webServer: api,
    connection: { requestRejection: () => undefined },
    sessions: { get: () => undefined, prepare: (id, { meta }) => ({ header: { id, ...meta }, inheritedEventCount: 0 }) },
    sessionPersistence: persistence,
    workspaceRegistry: { initializeDefault: async () => workspace },
    attachments: { saveImage: async image => { saved.push(image); return { id: `image-${saved.length}` } } },
    get: name => services[name],
  }
  apply(ctx)
  const rpc = (method, params) => new Promise((resolve, reject) => {
    const req = { method: 'POST', headers: { 'content-type': 'application/json' }, async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify({ method, params })) } }
    const res = { writeHead(status) { this.status = status }, end(body) { try { resolve({ status: this.status, body: JSON.parse(body) }) } catch (error) { reject(error) } } }
    api.handler(req, res).catch(reject)
  })
  const importImages = async urls => {
    const messages = urls.map((url, index) => ({ id: `u${index}`, role: 'user', created_at: 1000 + index, content: [{ type: 'image_url', image_url: { url } }] }))
    await writeFile(join(source, 'threads', threadId, 'messages.jsonl'), messages.map(message => JSON.stringify(message)).join('\n'))
    return rpc('import', { folder: source, ids: [threadId] })
  }
  try { await callback({ source, outside, saved, sessions, failures, importImages, rpc, services }) }
  finally { await rm(root, { recursive: true, force: true }) }
}

test('imported images are confined to the real legacy data folder', async () => withImporter(async ({ source, outside, saved, importImages }) => {
  const inside = join(source, 'inside.png')
  await writeFile(inside, 'inside image')
  await symlink(outside, join(source, 'escape.png'))
  const { body } = await importImages([inside, outside, `file://${outside}`, '../outside.png', join(source, 'escape.png')])
  assert.equal(body.result.results[0].status, 'imported')
  assert.deepEqual(saved.map(image => image.data.toString()), ['inside image'])
}))

test('a chat whose events failed to save is finished on the next import, not reported as imported', async () => withImporter(async ({ source, sessions, failures, importImages }) => {
  const image = join(source, 'inside.png')
  await writeFile(image, 'inside image')
  failures.append = 1
  const first = await importImages([image])
  assert.equal(first.body.result.results[0].status, 'failed')
  assert.equal(sessions.get('jan-sample').events.length, 0)
  const second = await importImages([image])
  assert.equal(second.body.result.results[0].status, 'imported')
  assert.ok(sessions.get('jan-sample').events.some(event => event.type === 'user/message'))
  const third = await importImages([image])
  assert.equal(third.body.result.results[0].status, 'already imported')
}))

test('legacy MCP import keeps env and header values off the wire and stores them on the Host', async () => withImporter(async ({ source, rpc, services }) => {
  const envToken = 'legacy-env-token'
  const headerToken = 'legacy-header-token'
  await writeFile(join(source, 'mcp_config.json'), JSON.stringify({ mcpServers: {
    'local tool': { command: 'node', active: true, env: { TOKEN: envToken } },
    remote: { type: 'http', url: 'https://example.com/mcp', headers: { Authorization: `Bearer ${headerToken}` } },
    old: { type: 'sse', url: 'https://example.com/sse' },
  } }))
  const records = new Map()
  let config = { mcpServers: [] }
  services.credentials = {
    readRecord: async key => records.get(key),
    modifyRecord: async (key, update) => records.set(key, update(records.get(key))),
  }
  services.configEditor = { edit: async (_entry, update) => { config = update(config) } }
  await mountAgentSettings({
    fiber: { entry: {} },
    get: name => services[name],
    provide: (name, value) => { services[name] = value },
    effect: effect => effect(),
    webServer: { register: () => () => {} },
  }, config)

  const old = await rpc('mcpDocument', { folder: source })
  const scan = await rpc('list', { folder: source })
  const result = await rpc('import', { folder: source, ids: [], mcp: true })
  const progress = await rpc('progress')
  for (const response of [old, scan, result, progress]) {
    const serialized = JSON.stringify(response.body)
    assert.equal(serialized.includes(envToken), false, 'the RPC response must not include the env value')
    assert.equal(serialized.includes(headerToken), false, 'the RPC response must not include the header value')
  }
  assert.equal(old.status, 404)
  assert.equal(scan.status, 200)
  assert.deepEqual(scan.body.result.settings.mcp.names, ['local-tool', 'remote'])
  assert.equal(result.status, 200)
  assert.deepEqual(result.body.result.settings.mcp, {
    imported: 2, already: 0, names: ['local-tool', 'remote'],
    skipped: [{ sourceName: 'old', reason: 'unsupported transport' }],
  })
  assert.deepEqual(progress.body.result.settings.mcp, result.body.result.settings.mcp)
  assert.deepEqual(config.mcpServers, [
    { name: 'local-tool', enabled: false, transport: 'stdio', command: 'node', args: [] },
    { name: 'remote', enabled: false, transport: 'streamable-http', url: 'https://example.com/mcp' },
  ])
  assert.deepEqual(records.get('jan-theme/mcp-local-tool')?.payload, { env: { TOKEN: envToken }, headers: {} })
  assert.deepEqual(records.get('jan-theme/mcp-remote')?.payload, { env: {}, headers: { Authorization: `Bearer ${headerToken}` } })
}))

test('MCP file parse failures do not disclose file contents in legacy import responses', async () => withImporter(async ({ source, rpc, services }) => {
  const secret = 'legacy-token'
  await writeFile(join(source, 'mcp_config.json'), `{"env":${secret}}`)
  services.janMcpSettings = { importMissing: () => assert.fail('invalid JSON must not reach MCP settings') }

  const scan = await rpc('list', { folder: source })
  const result = await rpc('import', { folder: source, ids: [], mcp: true })
  const progress = await rpc('progress')
  for (const response of [scan, result, progress]) assert.equal(JSON.stringify(response.body).includes(secret), false)
  assert.equal(scan.body.result.settings.error, 'Could not read Jan’s MCP configuration. Check mcp_config.json and try again.')
  assert.equal(result.body.result.settings.mcp.error, scan.body.result.settings.error)
  assert.equal(progress.body.result.settings.mcp.error, scan.body.result.settings.error)
}))
