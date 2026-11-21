import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mountAgentSettings } from '../agent-settings.mjs'

test('the Host imports missing MCP servers disabled and keeps their credentials separate', async () => {
  const existing = { name: 'existing', enabled: false, transport: 'stdio', command: 'original', args: [] }
  const existingSecret = { kind: 'grant', payload: { env: { TOKEN: 'original-token' }, headers: {} } }
  const records = new Map([['jan-theme/mcp-existing', existingSecret]])
  const credentials = {
    readRecord: async key => records.get(key),
    modifyRecord: async (key, update) => records.set(key, update(records.get(key))),
  }
  let config = { mcpServers: [existing] }
  const entry = {}
  const configEditor = { edit: async (_entry, update) => { config = update(config) } }
  const services = { configEditor, credentials }
  await mountAgentSettings({
    fiber: { entry },
    get: name => services[name],
    provide: (name, value) => { services[name] = value },
    effect: effect => effect(),
    webServer: { register: () => () => {} },
  }, config)

  assert.ok(services.janMcpSettings, 'agent settings must provide a Host-only MCP import service')
  const summary = await services.janMcpSettings.importMissing({
    existing: { command: 'replacement', env: { TOKEN: 'replacement-token' } },
    local: { command: 'node', env: { TOKEN: 'legacy-env-token' } },
    remote: { type: 'http', url: 'https://example.com/mcp', headers: { Authorization: 'Bearer legacy-header-token' } },
  })
  assert.deepEqual(summary, { imported: 2, already: 1, names: ['existing', 'local', 'remote'] })
  assert.deepEqual(config.mcpServers, [
    existing,
    { name: 'local', enabled: false, transport: 'stdio', command: 'node', args: [] },
    { name: 'remote', enabled: false, transport: 'streamable-http', url: 'https://example.com/mcp' },
  ])
  assert.deepEqual(records.get('jan-theme/mcp-existing'), existingSecret)
  assert.deepEqual(records.get('jan-theme/mcp-local')?.payload, { env: { TOKEN: 'legacy-env-token' }, headers: {} })
  assert.deepEqual(records.get('jan-theme/mcp-remote')?.payload, { env: {}, headers: { Authorization: 'Bearer legacy-header-token' } })
})

test('list only returns public connector fields even when profile rows contain secrets', async () => {
  const services = {
    configEditor: {},
    credentials: { readRecord: async () => undefined },
    tools: { definitions: () => [] },
    skills: { snapshot: async () => [] },
  }
  let handler
  await mountAgentSettings({
    fiber: { entry: {} },
    ...services,
    get: name => services[name],
    provide: () => {},
    effect: effect => effect(),
    connection: { requestRejection: () => undefined },
    webServer: { register: route => { handler = route.handler; return () => {} } },
  }, { mcpServers: [
    { name: 'local', enabled: false, transport: 'stdio', command: 'node', args: [], env: { TOKEN: 'config-secret' } },
    { name: 'remote', enabled: false, transport: 'streamable-http', url: 'https://example.com/mcp', headers: { Authorization: 'config-secret' } },
  ] })
  const response = await new Promise((resolve, reject) => {
    const req = { method: 'POST', headers: { 'content-type': 'application/json' }, async *[Symbol.asyncIterator]() { yield Buffer.from('{"method":"list","params":{}}') } }
    const res = { writeHead() {}, end: body => resolve(JSON.parse(body)) }
    handler(req, res).catch(reject)
  })
  assert.deepEqual(response.result.servers.map(({ name, secretConfigured }) => ({ name, secretConfigured })), [
    { name: 'local', secretConfigured: false }, { name: 'remote', secretConfigured: false },
  ])
  assert.equal(JSON.stringify(response).includes('config-secret'), false)
})
