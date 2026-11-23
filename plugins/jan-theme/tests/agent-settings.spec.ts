import { expect, it, onTestFinished, vi } from 'vitest'
import { imported, mountAgentSettings } from '../agent-settings.mjs'
import { startOAuthMcpFixture } from './oauth-mcp-fixture.mjs'

it('preserves quoted arguments, environment values and headers in JSONC imports', () => {
  const value = 'https://example.com/a//b/* literal */ \\"quoted" items,] map,}'
  const quoted = JSON.stringify(value)
  const [local, remote] = imported(`/* copied from an editor */ { "servers": {
    "local": { "command": "npx", "args": [${quoted},], "env": { "TEST": ${quoted}, }, },
    // A second connector.
    "remote": { "url": "https://example.com/mcp", "headers": { "X-Test": ${quoted}, }, },
  }, }`)
  expect(local).toMatchObject({ args: [value], env: { TEST: value } })
  expect(remote).toMatchObject({ headers: { 'X-Test': value } })
})

type Request = AsyncIterable<Buffer> & { method: 'POST'; headers: { 'content-type': string } }
type Response = { writeHead(status: number): void; end(body: string): void }
type Connector = { url: string; headers: Record<string, string> }
type Grant = { kind: 'grant'; payload: { endpoint?: string; expiresAt?: number; tokens: { access_token: string } } }
const grantKey = 'jan-theme/oauth-mcp-demo'

function settingsFixture() {
  const records = new Map<string, Grant>()
  const credentials = {
    readRecord: async (key: string) => records.get(key),
    modifyRecord: async (key: string, update: (current?: Grant) => Grant | undefined) => {
      const next = update(records.get(key))
      if (next) records.set(key, next)
    },
    deleteRecord: async (key: string) => records.delete(key),
  }
  let dispose: (() => void) | undefined
  onTestFinished(() => dispose?.())
  return {
    records,
    async mount(url: string) {
      dispose?.()
      let handler: ((req: Request, res: Response) => Promise<void>) | undefined
      const firstStart = Promise.withResolvers<Connector>()
      const restarted = Promise.withResolvers<Connector>()
      let starts = 0
      await mountAgentSettings({
        fiber: { entry: {} }, tools: { definitions: () => [] }, skills: { snapshot: async () => [] },
        get: (name: string) => ({ credentials, configEditor: {} })[name as 'credentials' | 'configEditor'],
        provide: () => {}, effect: (effect: () => () => void, label: string) => {
          const cleanup = effect()
          if (label === 'jan-theme: MCP startup audit') dispose = cleanup
        },
        plugin: (_: unknown, connector: Connector) => {
          starts++
          if (starts === 1) firstStart.resolve(connector)
          else restarted.resolve(connector)
          return Object.assign(Promise.resolve(), { dispose: async () => {} })
        },
        connection: { requestRejection: () => undefined }, logger: { warn: () => {} },
        webServer: { register: (route: { handler: typeof handler }) => { handler = route.handler } },
      }, { mcpServers: [{ name: 'demo', enabled: true, transport: 'streamable-http', url }] })
      return {
        firstStart: firstStart.promise,
        restarted: restarted.promise,
        starts: () => starts,
        async call(method: string, params = {}) {
          if (!handler) throw new Error('Agent settings did not register its route')
          let body = ''
          await handler({
            method: 'POST', headers: { 'content-type': 'application/json' },
            async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify({ method, params })) },
          }, { writeHead: () => {}, end: value => { body = value } })
          return JSON.parse(body)
        },
      }
    },
  }
}

it('uses an OAuth grant only at its authorized connector endpoint', async () => {
  const settings = settingsFixture()
  const oauth = await startOAuthMcpFixture()
  onTestFinished(() => oauth.close())
  const original = await settings.mount(oauth.url)
  const { result } = await original.call('signIn', { name: 'demo' })
  expect(result).toMatchObject({ started: true, url: expect.stringContaining('/authorize?') })
  const reloaded = await settings.mount(oauth.url)
  expect(await reloaded.call('list')).toMatchObject({ result: { servers: [{ state: 'signing-in', signInUrl: result.url }] } })
  const page = await fetch(result.url)
  expect(page.status).toBe(200)
  await page.text()
  expect((await reloaded.restarted).headers.Authorization).toMatch(/^Bearer at-/)
  expect(settings.records.get(grantKey)?.payload.endpoint).toBe(oauth.url)

  const changed = await settings.mount(`${oauth.base}/replacement`)
  expect((await changed.firstStart).headers.Authorization).toBeUndefined()
  expect(await changed.call('list')).toMatchObject({ result: { servers: [{ signedIn: false }] } })
})

it('requires a new sign-in for an older grant without an endpoint', async () => {
  const settings = settingsFixture()
  settings.records.set(grantKey, { kind: 'grant', payload: { tokens: { access_token: 'legacy-token' } } })
  const mounted = await settings.mount('https://example.com/mcp')
  expect((await mounted.firstStart).headers.Authorization).toBeUndefined()
  expect(await mounted.call('list')).toMatchObject({ result: { servers: [{ signedIn: false }] } })
})

it('keeps a non-refreshable connector connected until the access token expires', async () => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
  onTestFinished(() => vi.useRealTimers())
  const settings = settingsFixture()
  const endpoint = 'https://example.com/mcp'
  settings.records.set(grantKey, { kind: 'grant', payload: { endpoint, expiresAt: Date.now() + 90_000, tokens: { access_token: 'valid-token' } } })
  const mounted = await settings.mount(endpoint)
  expect((await mounted.firstStart).headers.Authorization).toBe('Bearer valid-token')
  await vi.advanceTimersByTimeAsync(89_999)
  expect(mounted.starts()).toBe(1)
  await vi.advanceTimersByTimeAsync(1)
  expect(mounted.starts()).toBe(2)
  expect((await mounted.restarted).headers.Authorization).toBeUndefined()
})

it('cancels a pending sign-in when the connector endpoint changes', async () => {
  const oauth = await startOAuthMcpFixture()
  onTestFinished(() => oauth.close())
  const settings = settingsFixture()
  const original = await settings.mount(oauth.url)
  const { result } = await original.call('signIn', { name: 'demo' })
  expect(result).toMatchObject({ started: true, url: expect.stringContaining('/authorize?') })

  const changed = await settings.mount(`${oauth.base}/replacement`)
  await changed.firstStart
  expect(await changed.call('list')).toMatchObject({ result: { servers: [{ signedIn: false, state: 'empty' }] } })
  const callback = new URL(result.url).searchParams.get('redirect_uri')!
  await expect(fetch(callback)).rejects.toThrow()
  expect(settings.records.has(grantKey)).toBe(false)
  expect(changed.starts()).toBe(1)
})
