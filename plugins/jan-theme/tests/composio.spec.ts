import { expect, it, onTestFinished, vi } from 'vitest'
import { mountAgentSettings } from '../agent-settings.mjs'

const key = 'composio-test-project-key'
const endpoint = 'https://backend.composio.dev/api/v3.1/tool_router/session/session-test/mcp'
const session = (url = endpoint) => Response.json({ session_id: 'session-test', mcp: { type: 'http', url } }, { status: 201 })

interface Row {
  name: string
  enabled: boolean
  transport: string
  url?: string
  connector?: string
  userId?: string
  credentialRef?: string
}

interface Reply {
  result?: unknown
  error?: string
}

type Config = { mcpServers: Row[]; skillDirectories?: string[] }
type Handler = (req: AsyncIterable<Buffer> & { method: 'POST'; headers: Record<string, string> }, res: { writeHead(): void; end(body: string): void }) => Promise<void>

function fixture(rows: Row[] = []) {
  const secrets = new Map<string, string>()
  const launches: object[] = []
  const warnings: string[] = []
  let config: Config = { mcpServers: rows }
  let handler: Handler
  let dispose: (() => void) | undefined
  const start = vi.fn(async (_config: object) => {})
  const fetch = vi.fn(async (_url: string, _init: RequestInit): Promise<Response> => session())
  vi.stubGlobal('fetch', fetch)
  onTestFinished(() => { dispose?.(); vi.unstubAllGlobals() })
  const edit = vi.fn(async (_entry: object, update: (current: Config) => Config) => { config = update(config) })
  const credentials = {
    set: async (ref: string, value: string) => { secrets.set(ref, value) },
    unset: async (ref: string) => { secrets.delete(ref) },
    describe: async (ref: string) => ({ configured: secrets.has(ref), writable: true }),
    readRecord: async () => undefined,
  }
  return {
    fetch, start, edit, secrets, launches, warnings, config: () => config,
    async mount() {
      dispose?.()
      const services = { configEditor: { edit }, credentials }
      await mountAgentSettings({
        fiber: { entry: {} }, tools: { definitions: () => [] }, skills: { snapshot: async () => [] },
        get: (name: keyof typeof services) => services[name], provide: () => {},
        effect: (effect: () => () => void, label: string) => {
          const cleanup = effect()
          if (label.endsWith('startup audit')) dispose = cleanup
        },
        plugin: (_plugin: unknown, value: object) => { launches.push(value); return start(value) },
        connection: { requestRejection: () => undefined }, logger: { warn: (message: string) => warnings.push(message) },
        webServer: { register: (route: { handler: Handler }) => { handler = route.handler; return () => {} } },
      }, config)
    },
    async call(method: string, params: object = {}): Promise<Reply> {
      const req = { method: 'POST' as const, headers: { 'content-type': 'application/json' }, async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify({ method, params })) } }
      const { promise, resolve } = Promise.withResolvers<Reply>()
      await handler(req, { writeHead() {}, end: body => resolve(JSON.parse(body)) })
      return promise
    },
  }
}

it('provisions once, stores only a credential reference, and reloads the saved MCP endpoint', async () => {
  const app = fixture()
  await app.mount()
  expect(await app.call('list')).toMatchObject({ result: { recommended: expect.arrayContaining([
    expect.objectContaining({ id: 'composio', setup: 'project-key', installed: false }),
    expect.objectContaining({ id: 'openmotion', setup: 'local-install' }),
  ]) } })
  expect(await app.call('connectComposio', { apiKey: ` ${key} ` })).toEqual({ result: { saved: true } })
  const [row] = app.config().mcpServers
  expect(row).toEqual({ name: 'composio', connector: 'composio', enabled: true, transport: 'streamable-http', url: endpoint,
    userId: expect.stringMatching(/^jan_[\da-f-]{36}$/), credentialRef: expect.stringMatching(/^COMPOSIO_API_KEY_[\da-f]{32}$/i) })
  expect(app.fetch).toHaveBeenCalledExactlyOnceWith('https://backend.composio.dev/api/v3.1/tool_router/session', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key },
    body: JSON.stringify({ user_id: row.userId }), redirect: 'error', signal: expect.any(AbortSignal),
  })
  expect([...app.secrets]).toEqual([[row.credentialRef, key]])
  expect(JSON.stringify(app.config())).not.toContain(key)

  await app.mount()
  expect(app.fetch).toHaveBeenCalledTimes(1)
  expect(app.launches).toEqual([{
    transport: 'streamable-http', serverName: 'composio', url: endpoint,
    headers: { 'x-api-key': `\${credential:${row.credentialRef}}` }, expandTemplates: true, followRedirects: false, failOnStartupError: true,
  }])
  const list = await app.call('list')
  expect(list).toMatchObject({ result: { servers: [{ connector: 'composio', secretConfigured: true }], recommended: expect.arrayContaining([
    expect.objectContaining({ id: 'composio', installed: true }),
  ]) } })
  const publicCopy = JSON.stringify(list)
  for (const secret of [row.userId, row.credentialRef, key]) expect(publicCopy).not.toContain(secret)
})

it.each([
  [401, 'composio-invalid-key'],
  [403, 'composio-permissions'],
  [503, 'composio-unavailable'],
])('reports Composio HTTP %s without exposing the key or provider body', async (status, error) => {
  const app = fixture()
  app.fetch.mockImplementationOnce(async () => Response.json({ error: `provider echoed ${key}` }, { status }))
  await app.mount()
  expect(await app.call('connectComposio', { apiKey: key })).toEqual({ error })
  expect(app.edit).not.toHaveBeenCalled()
  expect(app.secrets.size).toBe(0)
})

it('redacts transport exceptions and rejects malformed API keys before fetching', async () => {
  const app = fixture()
  app.fetch.mockRejectedValueOnce(new Error(`transport echoed ${key}`))
  await app.mount()
  expect(await app.call('connectComposio', { apiKey: 'two words' })).toEqual({ error: 'composio-invalid-key' })
  expect(app.fetch).not.toHaveBeenCalled()
  expect(await app.call('connectComposio', { apiKey: key })).toEqual({ error: 'composio-unavailable' })
  expect(app.edit).not.toHaveBeenCalled()
  expect(app.secrets.size).toBe(0)
})

it.each([
  'http://backend.composio.dev/mcp',
  'https://backend.composio.dev.example.com/mcp',
  'https://backend.composio.dev:8443/mcp',
  'https://user:secret@backend.composio.dev/mcp',
  'https://backend.composio.dev/mcp?token=secret',
  'https://backend.composio.dev/mcp#secret',
])('never saves or launches an unsafe Composio endpoint (%s)', async url => {
  const app = fixture()
  app.fetch.mockImplementationOnce(async () => session(url))
  await app.mount()
  expect(await app.call('connectComposio', { apiKey: key })).toEqual({ error: 'composio-invalid-response' })
  expect(app.edit).not.toHaveBeenCalled()
  expect(app.secrets.size).toBe(0)
  app.config().mcpServers.push({ name: 'composio', connector: 'composio', transport: 'streamable-http', enabled: true,
    userId: 'jan_00000000-0000-4000-8000-000000000000', credentialRef: `COMPOSIO_API_KEY_${'A'.repeat(32)}`, url })
  await app.mount()
  expect(app.launches).toEqual([])
  expect(app.warnings).toHaveLength(1)
  expect(app.warnings[0]).not.toContain(url)
})

it.each([
  () => new Response('not JSON'),
  () => Response.json({ session_id: ' ', mcp: { type: 'http', url: endpoint } }),
  () => Response.json({ session_id: 'session-test', mcp: { type: 'sse', url: endpoint } }),
])('rejects malformed Composio sessions before storing a key', async response => {
  const app = fixture()
  app.fetch.mockImplementationOnce(async () => response())
  await app.mount()
  expect(await app.call('connectComposio', { apiKey: key })).toEqual({ error: 'composio-invalid-response' })
  expect(app.edit).not.toHaveBeenCalled()
  expect(app.secrets.size).toBe(0)
})

it('does not claim a custom server named composio or run Composio as a local installer', async () => {
  const custom = { name: 'composio', enabled: false, transport: 'streamable-http', url: 'https://example.com/mcp' }
  const app = fixture([custom])
  await app.mount()
  expect(await app.call('connectComposio', { apiKey: key })).toEqual({ error: 'composio-name-conflict' })
  expect(await app.call('installRecommended', { id: 'composio', confirmed: true })).toEqual({ error: 'Choose a recommended connector.' })
  expect(app.fetch).not.toHaveBeenCalled()
  expect(app.config().mcpServers).toEqual([custom])
  expect(app.secrets.size).toBe(0)
})

it('replaces the key without changing the Composio user, then unsets it on removal', async () => {
  const app = fixture()
  await app.mount()
  await app.call('connectComposio', { apiKey: key })
  const [before] = app.config().mcpServers
  await app.mount()
  await app.call('toggle', { name: 'composio', enabled: false })
  await app.mount()
  const replacement = `${endpoint}/replacement`
  app.fetch.mockImplementationOnce(async () => session(replacement))
  expect(await app.call('connectComposio', { apiKey: 'replacement-project-key' })).toEqual({ result: { saved: true } })
  const [after] = app.config().mcpServers
  expect(after).toMatchObject({ userId: before.userId, url: replacement, enabled: false })
  expect(app.fetch.mock.calls[1][1].body).toBe(JSON.stringify({ user_id: before.userId }))
  expect(after.credentialRef).not.toBe(before.credentialRef)
  expect([...app.secrets]).toEqual([[after.credentialRef, 'replacement-project-key']])

  await app.mount()
  expect(await app.call('remove', { name: 'composio', confirmed: true })).toEqual({ result: { saved: true } })
  expect(app.config().mcpServers).toEqual([])
  expect(app.secrets.size).toBe(0)
})

it('rolls back only the fresh key if a replacement loses a concurrent settings edit', async () => {
  const app = fixture()
  await app.mount()
  await app.call('connectComposio', { apiKey: key })
  const [before] = app.config().mcpServers
  await app.mount()
  expect(await app.call('toggle', { name: 'composio', enabled: false })).toEqual({ result: { saved: true } })
  expect(await app.call('connectComposio', { apiKey: 'stale-project-key' })).toEqual({ error: 'composio-save-failed' })
  expect(app.config().mcpServers).toEqual([{ ...before, enabled: false }])
  expect([...app.secrets]).toEqual([[before.credentialRef, key]])
})

it('keeps saved Composio authentication isolated from generic MCP settings and errors', async () => {
  const app = fixture()
  await app.mount()
  await app.call('connectComposio', { apiKey: key })
  const [row] = app.config().mcpServers
  app.start.mockRejectedValueOnce(new Error(`401 from transport: ${key}`))
  await app.mount()
  const list = await app.call('list')
  expect(list).toMatchObject({ result: { servers: [{ connector: 'composio', state: 'failed', signedIn: false, statusCode: 'composio-invalid-key' }] } })
  expect(JSON.stringify(list)).not.toContain(key)
  expect(await app.call('signIn', { name: 'composio' })).toEqual({ error: 'composio-use-project-key' })
  expect(await app.call('useToken', { name: 'composio', token: 'generic-token' })).toEqual({ error: 'composio-use-project-key' })
  expect(await app.call('saveServer', { originalName: 'composio', value: { ...row, url: 'https://example.com/mcp' } })).toEqual({ error: 'composio-use-project-key' })
  expect(app.fetch).toHaveBeenCalledTimes(1)
  expect(app.config().mcpServers).toEqual([row])
  expect([...app.secrets]).toEqual([[row.credentialRef, key]])
})
