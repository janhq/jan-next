import assert from 'node:assert/strict'
import { test } from 'node:test'
import { imported, mountAgentSettings } from '../agent-settings.mjs'

test('a paste from any MCP client becomes disabled Jan servers', () => {
  const stdio = (name, args, extra = {}) => ({ name, enabled: false, transport: 'stdio', command: 'npx', args, env: {}, ...extra })
  // Claude Desktop / Cursor, with Cursor-only fields.
  assert.deepEqual(imported('{"mcpServers":{"github":{"command":"npx","args":["-y","@modelcontextprotocol/server-github"],"env":{"GITHUB_TOKEN":"t"},"autoApprove":[]}}}'),
    [stdio('github', ['-y', '@modelcontextprotocol/server-github'], { env: { GITHUB_TOKEN: 't' } })])
  // VS Code mcp.json with a comment and a trailing comma, plus a remote server.
  assert.deepEqual(imported('{ // mine\n "servers": { "my.docs": { "type": "http", "url": "https://docs.example.com/mcp", }, }, }'),
    [{ name: 'my-docs', enabled: false, transport: 'streamable-http', url: 'https://docs.example.com/mcp', headers: {} }])
  // Zed context_servers with the nested command.
  assert.deepEqual(imported('{"context_servers":{"fs":{"source":"custom","command":{"path":"npx","args":["-y","fs"]}}}}'), [stdio('fs', ['-y', 'fs'])])
  // A fragment copied out of a larger file, a lone server, a command line, a URL.
  assert.deepEqual(imported('"time": { "command": "npx", "args": ["t"] },'), [stdio('time', ['t'])])
  assert.deepEqual(imported('{"command":"npx","args":["-y","@modelcontextprotocol/server-everything"]}'), [stdio('everything', ['-y', '@modelcontextprotocol/server-everything'])])
  assert.deepEqual(imported('npx -y "@playwright/mcp@latest"'), [stdio('playwright', ['-y', '@playwright/mcp@latest'])])
  assert.equal(imported('https://mcp.linear.app/mcp')[0].name, 'linear')
  assert.throws(() => imported('{"mcpServers":{"old":{"type":"sse","url":"https://x.example/sse"}}}'), /SSE/)
  assert.throws(() => imported('{"theme":"dark"}'), /No MCP servers/)
})

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
  assert.deepEqual(services.janMcpSettings.configuredNames(), ['existing'])
  const summary = await services.janMcpSettings.importMissing({
    existing: { command: 'replacement', env: { TOKEN: 'replacement-token' } },
    local: { command: 'node', env: { TOKEN: 'legacy-env-token' } },
    remote: { type: 'http', url: 'https://example.com/mcp', headers: { Authorization: 'Bearer legacy-header-token' } },
  })
  assert.deepEqual(summary, { imported: 2, already: 1, names: ['existing', 'local', 'remote'], added: ['local', 'remote'] })
  assert.deepEqual(config.mcpServers, [
    existing,
    { name: 'local', enabled: false, transport: 'stdio', command: 'node', args: [] },
    { name: 'remote', enabled: false, transport: 'streamable-http', url: 'https://example.com/mcp' },
  ])
  assert.deepEqual(records.get('jan-theme/mcp-existing'), existingSecret)
  assert.deepEqual(records.get('jan-theme/mcp-local')?.payload, { env: { TOKEN: 'legacy-env-token' }, headers: {} })
  assert.deepEqual(records.get('jan-theme/mcp-remote')?.payload, { env: {}, headers: { Authorization: 'Bearer legacy-header-token' } })
})

test('list skips invalid profile rows and returns public fields without secrets', async () => {
  const warnings = []
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
    logger: { warn: message => warnings.push(message) },
    webServer: { register: route => { handler = route.handler; return () => {} } },
  }, { mcpServers: [
    null,
    { name: 'invalid', enabled: true, transport: 'stdio', command: 1, env: { TOKEN: 'bad-secret' } },
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
  assert.equal(warnings.length, 2)
  assert.match(warnings[0], /MCP.*1/)
  assert.match(warnings[1], /MCP.*2/)
  assert.equal(warnings.join(' ').includes('bad-secret'), false)
})
