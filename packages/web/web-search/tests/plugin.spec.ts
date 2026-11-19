import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@janhq/cordis'
import { credentialRef } from '@janhq/jan-credentials'
import WebRuntime from '@janhq/jan-web'
import { MemoryCredentials } from '../../../credentials/credentials/tests/memory.ts'
import * as plugin from '../src/index.ts'
import { Config, resolve } from '../src/config.ts'
import type { BackendId } from '../src/config.ts'
import { keyLookupFrom } from '../src/credentials.ts'
import { FakeTokamakAccount } from './fake-account.ts'
import { json, sse, startLoopback, toolText } from './loopback.ts'
import type { Loopback } from './loopback.ts'

let loopback: Loopback

beforeEach(async () => { loopback = await startLoopback() })
afterEach(async () => {
  vi.unstubAllEnvs()
  await loopback.close()
})

describe('config resolution', () => {
  it('defaults to Exa, Tavily, and You.com with their public endpoints, and no SearXNG instance', () => {
    const spec = resolve(Config({}))
    expect(spec.providers).toEqual(['tokamak', 'exa', 'tavily', 'you'])
    expect(spec.searxng).toBeUndefined()
    expect(spec.tavily).toMatchObject({
      searchUrl: 'https://api.tavily.com/search', extractUrl: 'https://api.tavily.com/extract', apiKeyEnv: 'TAVILY_API_KEY',
    })
    expect(spec.exa).toMatchObject({
      mcpUrl: 'https://mcp.exa.ai/mcp', searchUrl: 'https://api.exa.ai/search', contentsUrl: 'https://api.exa.ai/contents',
      apiKeyEnv: 'EXA_API_KEY', numResults: 5, maxCharacters: 40_000, timeoutMs: 30_000,
    })
    expect(spec.you).toMatchObject({
      mcpUrl: 'https://api.you.com/mcp?profile=free', extractUrl: 'https://api.you.com/v1/extract',
      searchUrl: 'https://ydc-index.io/v1/search', contentsUrl: 'https://ydc-index.io/v1/contents', apiKeyEnv: 'YDC_API_KEY',
    })
  })

  it('joins REST paths onto a base URL with or without a trailing slash', () => {
    expect(resolve(Config({ exa: { apiUrl: 'https://proxy.example/exa/' } })).exa.searchUrl).toBe('https://proxy.example/exa/search')
  })

  it('fails loud for each invalid field', () => {
    expect(() => resolve(Config({ exa: { mcpUrl: 'ftp://x' } }))).toThrow('web-search: exa.mcpUrl is not an http(s) URL: ftp://x')
    expect(() => resolve(Config({ you: { apiUrl: 'not a url' } }))).toThrow(/you.apiUrl is not an http\(s\) URL/)
    expect(() => resolve(Config({ you: { apiKeyEnv: 'bad-name' } }))).toThrow('web-search: you.apiKeyEnv is not an environment-variable name: bad-name')
    expect(() => resolve(Config({ you: { userAgent: ' ' } }))).toThrow('web-search: you.userAgent must not be empty')
    expect(() => resolve(Config({ providers: [] }))).toThrow(/at least one backend/)
    expect(() => resolve(Config({ providers: ['exa', 'exa'] }))).toThrow(/must not repeat/)
    // @ts-expect-error -- cordis.yml can name a backend this package does not have.
    expect(() => Config({ providers: ['brave'] })).toThrow()
    expect(() => resolve(Config({ providers: ['searxng'] })))
      .toThrow('web-search: providers lists searxng, so searxng.url must name a SearXNG instance')
    expect(() => resolve(Config({ providers: ['searxng'], searxng: { url: 'example.com' } }))).toThrow('web-search: searxng.url is not an http(s) URL: example.com')
    expect(resolve(Config({ providers: ['searxng'], searxng: { url: 'https://searx.example/' } })).searxng?.searchUrl).toBe('https://searx.example/search')
    expect(() => Config({ numResults: 21 })).toThrow()
    expect(() => resolve({ providers: ['exa'] })).toThrow('web-search: exa is required')
    expect(() => resolve({ providers: ['you'], exa: {}, tavily: {}, you: {}, tokamak: {}, numResults: 1, maxCharacters: 1, timeoutMs: 1 })).toThrow('web-search: exa.apiUrl is required')
    const { tokamak: _omitted, ...withoutTokamak } = Config({})
    expect(() => resolve(withoutTokamak)).toThrow('web-search: tokamak is required')
    expect(() => resolve(Object.assign(Config({}), { tokamak: { apiUrl: 'https://api.tokamak.sh/v1' } })))
      .toThrow('web-search: tokamak.maxResults is required')
  })
})

describe('credential lookup', () => {
  it('resolves through ctx.credentials when mounted, else the launch environment, treating blank as unset', async () => {
    const ctx = new Context()
    vi.stubEnv('JAN_WEB_SEARCH_TEST_KEY', ' env-key ')
    const lookup = keyLookupFrom(ctx)
    await expect(lookup(credentialRef('JAN_WEB_SEARCH_TEST_KEY'))).resolves.toBe('env-key')
    vi.stubEnv('JAN_WEB_SEARCH_TEST_KEY', '')
    await expect(lookup(credentialRef('JAN_WEB_SEARCH_TEST_KEY'))).resolves.toBeUndefined()

    vi.stubEnv('JAN_WEB_SEARCH_TEST_KEY', 'env-key')
    const fiber = await ctx.plugin(MemoryCredentials, { JAN_WEB_SEARCH_TEST_KEY: 'stored-key' })
    await expect(lookup(credentialRef('JAN_WEB_SEARCH_TEST_KEY'))).resolves.toBe('stored-key')
    await expect(lookup(credentialRef('JAN_WEB_SEARCH_OTHER_KEY'))).resolves.toBeUndefined()
    await fiber.dispose()
    await expect(lookup(credentialRef('JAN_WEB_SEARCH_TEST_KEY'))).resolves.toBe('env-key')
  })
})

describe('web-search plugin', () => {
  async function mount(providers: BackendId[], web: { searchProvider?: string | string[]; fetchProvider?: string | string[] }): Promise<{ ctx: Context; fiber: Awaited<ReturnType<Context['plugin']>> }> {
    const ctx = new Context()
    await ctx.plugin(WebRuntime, web)
    const fiber = await ctx.plugin(plugin, {
      tokamak: { apiUrl: `${loopback.base}/tokamak/v1` },
      exa: { mcpUrl: `${loopback.base}/exa/mcp`, apiUrl: `${loopback.base}/exa`, apiKeyEnv: 'JAN_WEB_SEARCH_TEST_EXA' },
      tavily: { apiUrl: `${loopback.base}/tavily`, apiKeyEnv: 'JAN_WEB_SEARCH_TEST_TAVILY' },
      searxng: { url: `${loopback.base}/searx` },
      you: { mcpUrl: `${loopback.base}/you/mcp`, extractUrl: `${loopback.base}/you/extract`, apiUrl: `${loopback.base}/you`, apiKeyEnv: 'JAN_WEB_SEARCH_TEST_YDC' },
      providers,
    })
    return { ctx, fiber }
  }

  it('registers every backend, SearXNG for search only, and removes them when the fiber is disposed', async () => {
    const { ctx, fiber } = await mount(['exa', 'tavily', 'searxng', 'you'], { searchProvider: 'you', fetchProvider: 'exa' })
    expect(ctx.web.listProviders()).toMatchObject({
      search: [{ id: 'exa', title: 'Exa' }, { id: 'tavily', title: 'Tavily' }, { id: 'searxng', title: 'SearXNG' }, { id: 'you', title: 'You.com' }],
      fetch: [{ id: 'exa', title: 'Exa' }, { id: 'tavily', title: 'Tavily' }, { id: 'you', title: 'You.com' }],
    })
    expect(await ctx.web.searchReady('local')).toBe(true)
    expect(await ctx.web.fetchReady('local')).toBe(true)
    loopback.handler = (request, res) => {
      if (request.path === '/you/mcp') sse(res, toolText(JSON.stringify({ results: { web: [{ url: 'https://a.example' }, { url: 'https://b.example' }] } })))
      else sse(res, toolText('page'))
    }
    await expect(ctx.web.search({ query: 'q', maxResults: 1 })).resolves.toEqual({ sources: [{ url: 'https://a.example' }], truncated: true })
    await expect(ctx.web.fetch({ url: 'https://example.com' })).resolves.toMatchObject({ body: { content: 'page' } })
    await fiber.dispose()
    expect(ctx.web.listProviders()).toEqual({ search: [], fetch: [] })
  })

  it('reports a selected Tavily without a key as not ready, so the search tool is withheld', async () => {
    const { ctx } = await mount(['exa', 'tavily'], { searchProvider: 'tavily', fetchProvider: 'tavily' })
    expect(await ctx.web.searchReady('local')).toBe(false)
    expect(await ctx.web.fetchReady('local')).toBe(false)
    vi.stubEnv('JAN_WEB_SEARCH_TEST_TAVILY', 'tvly-key')
    expect(await ctx.web.searchReady('local')).toBe(true)
  })

  it('registers only the configured backends', async () => {
    const { ctx } = await mount(['exa'], {})
    expect(ctx.web.listProviders()).toMatchObject({ search: [{ id: 'exa' }], fetch: [{ id: 'exa' }] })
  })

  it('switches to the keyed API on the next operation once the key is set, without a remount', async () => {
    const { ctx } = await mount(['exa'], {})
    loopback.handler = (request, res) => {
      if (request.path === '/exa/search') json(res, { results: [{ url: 'https://keyed.example' }] })
      else sse(res, toolText('Title: T\nURL: https://keyless.example'))
    }
    await expect(ctx.web.search({ query: 'q' })).resolves.toMatchObject({ sources: [{ url: 'https://keyless.example' }] })
    vi.stubEnv('JAN_WEB_SEARCH_TEST_EXA', 'exa-key')
    await expect(ctx.web.search({ query: 'q' })).resolves.toMatchObject({ sources: [{ url: 'https://keyed.example' }] })
    expect(loopback.calls.map(call => call.path)).toEqual(['/exa/mcp', '/exa/search'])
    expect(loopback.calls[1]?.headers['x-api-key']).toBe('exa-key')
  })

  it('registers Tokamak only with the account service and selects it only while signed in', async () => {
    const { ctx } = await mount(['tokamak', 'exa'], { searchProvider: ['tokamak', 'exa'], fetchProvider: ['tokamak', 'exa'] })
    loopback.handler = (request, res) => {
      if (request.path === '/tokamak/v1/web_search') json(res, { results: [{ url: 'https://tokamak.example' }] })
      else if (request.path === '/tokamak/v1/web_fetch') json(res, { url: request.body['url'], content: 'tokamak page' })
      else if (request.body['params'] !== undefined && JSON.stringify(request.body).includes('web_fetch_exa')) sse(res, toolText('exa page'))
      else sse(res, toolText('Title: T\nURL: https://exa.example'))
    }
    const searched = async (): Promise<string | undefined> => (await ctx.web.search({ query: 'q' })).sources[0]?.url
    expect(ctx.web.listProviders().search.map(info => info.id)).toEqual(['exa'])
    await expect(searched()).resolves.toBe('https://exa.example')

    const accountFiber = await ctx.plugin(FakeTokamakAccount)
    const account = ctx.get('tokamakAccount') as FakeTokamakAccount
    account.issuer = loopback.base
    await vi.waitFor(() => { expect(ctx.web.listProviders().search.map(info => info.id)).toEqual(['exa', 'tokamak']) })
    await expect(searched()).resolves.toBe('https://exa.example')

    account.setToken('tk-1')
    await vi.waitFor(async () => { await expect(searched()).resolves.toBe('https://tokamak.example') })
    await expect(ctx.web.fetch({ url: 'https://example.com' })).resolves.toMatchObject({ body: { content: 'tokamak page' } })
    expect(await ctx.web.searchReady('local')).toBe(true)

    loopback.handler = (_request, res) => { json(res, { error: 'unauthorized' }, 401) }
    await expect(searched()).rejects.toThrow(/HTTP 401/)
    expect(account.rejected).toEqual(['tk-1'])
    loopback.handler = (request, res) => {
      if (request.path.startsWith('/tokamak')) res.writeHead(500).end()
      else sse(res, toolText('Title: T\nURL: https://exa.example'))
    }
    await vi.waitFor(async () => { await expect(searched()).resolves.toBe('https://exa.example') })

    await accountFiber.dispose()
    expect(ctx.web.listProviders()).toMatchObject({ search: [{ id: 'exa' }], fetch: [{ id: 'exa' }] })
    expect(ctx.web.listProviders().search).toHaveLength(1)
  })

  it('keeps Tokamak unavailable and warns when the account state cannot be read', async () => {
    const { ctx } = await mount(['tokamak'], { searchProvider: 'tokamak' })
    const warn = vi.spyOn(ctx.logger, 'warn')
    await ctx.plugin(FakeTokamakAccount)
    const account = ctx.get('tokamakAccount') as FakeTokamakAccount
    account.failState = true
    account.setToken('tk-1')
    await vi.waitFor(() => { expect(warn).toHaveBeenCalledWith('web-search: cannot read the Tokamak account state, so Tokamak search and fetch stay unavailable') })
    await expect(ctx.web.search({ query: 'q' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE' })
  })

  it('fails to load with an invalid endpoint', async () => {
    const ctx = new Context()
    await ctx.plugin(WebRuntime, {})
    await expect(ctx.plugin(plugin, { exa: { mcpUrl: 'not a url' } })).rejects.toThrow(/exa.mcpUrl is not an http\(s\) URL/)
  })

  it('has no default export', () => {
    expect('default' in plugin).toBe(false)
  })
})
