import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../index.mjs'
import { mountAgentSettings } from '../../jan-theme/agent-settings.mjs'

async function withImporter(callback, { hasDefault = true } = {}) {
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
  const defaultPath = join(root, 'Documents', 'jan', 'default-workspace')
  const placement = { initialized: 0, attached: [] }
  const workspace = { path: defaultPath, attachSession: async id => { placement.attached.push(id) } }
  let defaultWorkspace
  const api = { register: ({ handler }) => { api.handler = handler; return () => {} } }
  const services = Object.create(null)
  const ctx = {
    fiber: {},
    effect: callback => callback(),
    inject: () => {},
    webServer: api,
    connection: { requestRejection: () => undefined },
    sessions: { get: () => undefined, prepare: (id, { meta }) => ({ header: { id, ...meta }, inheritedEventCount: 0 }) },
    sessionPersistence: persistence,
    workspaceRegistry: {
      get defaultWorkspace() { return defaultWorkspace },
      resolveByPath: async path => path === defaultWorkspace?.path ? defaultWorkspace : undefined,
    },
    workspaceController: {
      initializeDefault: async () => {
        placement.initialized++
        if (hasDefault) defaultWorkspace = workspace
      },
    },
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
  try { await callback({ source, outside, defaultPath, placement, saved, sessions, failures, importImages, rpc, services }) }
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

test('Jan chats use the default directory supplied by the workspace controller', async () => withImporter(async ({ defaultPath, placement, sessions, importImages }) => {
  const { body } = await importImages(['https://example.com/image.png'])
  assert.equal(body.result.results[0].status, 'imported')
  assert.equal(sessions.get('jan-sample').header.cwd, defaultPath)
  assert.deepEqual(placement, { initialized: 1, attached: ['jan-sample'] })
}))

test('Jan chats import without project membership when no default is eligible', async () => withImporter(async ({ placement, sessions, importImages }) => {
  const first = await importImages(['https://example.com/image.png'])
  assert.equal(first.body.result.results[0].status, 'imported')
  assert.equal(Object.hasOwn(sessions.get('jan-sample').header, 'cwd'), false)
  const second = await importImages(['https://example.com/image.png'])
  assert.equal(second.body.result.results[0].status, 'already imported')
  assert.deepEqual(placement, { initialized: 1, attached: [] })
}, { hasDefault: false }))

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
  const { folder, scanId } = scan.body.result
  const result = await rpc('import', { folder, scanId, ids: [], mcp: true })
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
    rows: [
      { name: 'local-tool', sourceName: 'local tool', credentials: 1, omitted: [], status: 'imported' },
      { name: 'remote', sourceName: 'remote', credentials: 1, omitted: [], status: 'imported' },
    ],
    skipped: [{ sourceName: 'old', reason: 'unsupported transport' }],
    issues: [],
  })
  assert.deepEqual(progress.body.result.settings.mcp, result.body.result.settings.mcp)
  assert.deepEqual(config.mcpServers, [
    { name: 'local-tool', enabled: false, transport: 'stdio', command: 'node', args: [] },
    { name: 'remote', enabled: false, transport: 'streamable-http', url: 'https://example.com/mcp' },
  ])
  assert.deepEqual(records.get('jan-theme/mcp-local-tool')?.payload, { env: { TOKEN: envToken }, headers: {} })
  assert.deepEqual(records.get('jan-theme/mcp-remote')?.payload, { env: {}, headers: { Authorization: `Bearer ${headerToken}` } })
}))

test('Settings rejects an MCP endpoint changed after its scan even if another form rescanned', async () => withImporter(async ({ source, rpc, services, sessions }) => {
  const path = join(source, 'mcp_config.json')
  const writeEndpoint = url => writeFile(path, JSON.stringify({ mcpServers: {
    remote: { type: 'http', url, headers: { Authorization: 'Bearer local-test-token' } },
  } }))
  await writeFile(join(source, 'threads', 'sample', 'messages.jsonl'), JSON.stringify({
    id: 'user-message', role: 'user', created_at: 1000, content: [{ type: 'text', text: 'Hello' }],
  }))
  const writes = []
  services.janMcpSettings = { importMissing: async servers => { writes.push(servers); return { added: ['remote'] } } }
  await writeEndpoint('https://original.example/mcp')
  const scan = (await rpc('list', { folder: source })).body.result
  assert.deepEqual(scan.settings.mcp.names, ['remote'])
  await writeEndpoint('https://replacement.example/mcp')
  const refreshed = (await rpc('list', { folder: source })).body.result

  const stale = await rpc('import', { folder: scan.folder, scanId: scan.scanId, ids: ['sample'], mcp: true, mcpNames: ['remote'] })
  assert.deepEqual(stale, { status: 400, body: { error: 'The selected MCP configuration changed since the import form opened. Open the form and try again.' } })
  assert.equal(writes.length, 0)
  assert.equal(sessions.size, 0)

  const fresh = await rpc('import', { folder: refreshed.folder, scanId: refreshed.scanId, ids: [], mcp: true, mcpNames: ['remote'] })
  assert.equal(fresh.status, 200)
  assert.equal(fresh.body.result.settings.mcp.imported, 1)
  assert.equal(writes[0].remote.url, 'https://replacement.example/mcp')
}))

test('progress names the run that produced it, so a refused import cannot borrow the previous result', async () => withImporter(async ({ source, rpc, services }) => {
  await writeFile(join(source, 'mcp_config.json'), JSON.stringify({ mcpServers: { remote: { type: 'http', url: 'https://example.com/mcp' } } }))
  services.janMcpSettings = { importMissing: async () => ({ added: ['remote'] }) }
  const scan = (await rpc('list', { folder: source })).body.result
  const done = await rpc('import', { folder: scan.folder, scanId: scan.scanId, ids: [], mcp: true, runId: 'first' })
  assert.equal(done.status, 200)
  const refused = await rpc('import', { folder: scan.folder, scanId: 'evicted-scan', ids: [], mcp: true, runId: 'second' })
  assert.equal(refused.status, 400)
  assert.equal((await rpc('progress')).body.result.runId, 'first')
}))

test('MCP file parse failures do not disclose file contents in legacy import responses', async () => withImporter(async ({ source, rpc, services }) => {
  const secret = 'legacy-token'
  await writeFile(join(source, 'mcp_config.json'), `{"env":${secret}}`)
  services.janMcpSettings = { importMissing: () => assert.fail('invalid JSON must not reach MCP settings') }

  const scan = await rpc('list', { folder: source })
  const { folder, scanId } = scan.body.result
  const result = await rpc('import', { folder, scanId, ids: [], mcp: true })
  const progress = await rpc('progress')
  for (const response of [scan, result, progress]) assert.equal(JSON.stringify(response.body).includes(secret), false)
  const issues = scan.body.result.settings.mcp.issues
  assert.deepEqual(issues, [{ file: 'mcp_config.json', reason: 'Could not read MCP configuration from mcp_config.json. Check the file and try again.' }])
  assert.deepEqual(result.body.result.settings.mcp.issues, issues)
  assert.deepEqual(progress.body.result.settings.mcp.issues, issues)
}))
