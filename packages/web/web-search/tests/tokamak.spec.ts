import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_BASE_URL } from '@janhq/jan-tokamak-account'
import { Config, resolve } from '../src/config.ts'
import { TokamakFetchProvider, TokamakSearchProvider, TokamakSession } from '../src/tokamak.ts'
import type { TokamakSignIn } from '../src/tokamak.ts'
import { json, specsFor, startLoopback } from './loopback.ts'
import type { Loopback } from './loopback.ts'

let loopback: Loopback

beforeEach(async () => { loopback = await startLoopback() })
afterEach(async () => { await loopback.close() })

/** A signed-in account releasing `key` only for URLs on `issuer`, recording rejected keys. */
function account(key: string | undefined, issuer = loopback.base): TokamakSignIn & { rejected: string[] } {
  const rejected: string[] = []
  return {
    rejected,
    async* watch() { yield { status: key === undefined ? 'signed-out' : 'credential-stored', links: { usageUrl: '', topUpUrl: '' }, attempt: null } },
    resolveToken: url => Promise.resolve(new URL(url).origin === issuer ? key : undefined),
    rejectToken: (token) => { rejected.push(token); return Promise.resolve() },
  }
}

function tokamak(overrides: Parameters<typeof specsFor>[1] = {}): ReturnType<typeof specsFor>['tokamak'] {
  return specsFor(loopback.base, overrides).tokamak
}

function providers(signIn: TokamakSignIn, overrides: Parameters<typeof specsFor>[1] = {}): {
  session: TokamakSession
  search: TokamakSearchProvider
  fetch: TokamakFetchProvider
} {
  const spec = tokamak(overrides)
  const session = new TokamakSession(signIn, spec)
  return { session, search: new TokamakSearchProvider(spec, session), fetch: new TokamakFetchProvider(spec, session) }
}

describe('Tokamak config', () => {
  it('defaults to the API base the tokamak-account service defaults to, capping results at 10', () => {
    const spec = resolve(Config({})).tokamak
    expect(spec.searchUrl).toBe(`${DEFAULT_BASE_URL}/web_search`)
    expect(spec.fetchUrl).toBe(`${DEFAULT_BASE_URL}/web_fetch`)
    expect(spec.maxResults).toBe(10)
    expect(() => resolve(Config({ tokamak: { apiUrl: 'nope' } }))).toThrow('web-search: tokamak.apiUrl is not an http(s) URL: nope')
    expect(() => Config({ tokamak: { maxResults: 21 } })).toThrow()
  })
})

describe('TokamakSession', () => {
  it('is unavailable until the first account state, then follows it, and clears when the stream ends', async () => {
    const { session } = providers(account('tk-1'))
    expect(session.available()).toBe(false)
    await session.follow(new AbortController().signal)
    expect(session.available()).toBe(false)
  })

  it('reports signed-in only for a key issued by the configured deployment', async () => {
    const states: boolean[] = []
    const observe = (signIn: TokamakSignIn): TokamakSignIn => ({
      ...signIn,
      async* watch(signal) { for await (const view of signIn.watch(signal)) { yield view; states.push(session.available()) } },
    })
    let session = providers(observe(account('tk-1'))).session
    await session.follow(new AbortController().signal)
    session = providers(observe(account('tk-1', 'https://api.other.example'))).session
    await session.follow(new AbortController().signal)
    session = providers(observe(account(undefined))).session
    await session.follow(new AbortController().signal)
    expect(states).toEqual([true, false, false])
  })
})

describe('TokamakSearchProvider', () => {
  it('posts only the query and capped count with the account key and maps results', async () => {
    loopback.handler = (_request, res) => {
      json(res, {
        id: 'ws_1', object: 'web_search', provider: 'exa', usage: { requests: 1 },
        results: [
          { title: ' One ', url: 'https://a.example', snippet: 'first', content: null, published_at: '2026-01-01', site_name: 'A' },
          { title: null, url: 'https://b.example', snippet: 'short', content: 'long page text', published_at: null, site_name: null },
          { title: '', url: 'https://c.example', snippet: '', content: null },
          { title: 'dropped', url: 'nope' },
          { title: 'no url' },
        ],
      })
    }
    const { search } = providers(account('tk-1'))
    await expect(search.ready()).resolves.toBe(true)
    const result = await search.search({ query: 'q', maxResults: 15 })
    expect(loopback.calls[0]?.path).toBe('/tokamak/v1/web_search')
    expect(loopback.calls[0]?.headers.authorization).toBe('Bearer tk-1')
    expect(loopback.calls[0]?.body).toEqual({ query: 'q', max_results: 10 })
    expect(result).toEqual({
      sources: [
        { url: 'https://a.example', title: 'One', snippet: 'first', summary: 'first', publishedAt: '2026-01-01' },
        { url: 'https://b.example', snippet: 'short', summary: 'long page text' },
        { url: 'https://c.example' },
      ],
      truncated: false,
    })
  })

  it('uses the configured count when the caller sets none, and treats a reply without results as empty', async () => {
    loopback.handler = (_request, res) => { json(res, {}) }
    await expect(providers(account('tk-1')).search.search({ query: 'q' })).resolves.toEqual({ sources: [], truncated: false })
    expect(loopback.calls[0]?.body).toEqual({ query: 'q', max_results: 5 })
  })

  it('falls back to the content for the snippet when the snippet is empty', async () => {
    loopback.handler = (_request, res) => { json(res, { results: [{ url: 'https://a.example', snippet: ' ', content: 'body' }] }) }
    await expect(providers(account('tk-1')).search.search({ query: 'q' }))
      .resolves.toMatchObject({ sources: [{ url: 'https://a.example', snippet: 'body', summary: 'body' }] })
  })

  it('sends nothing while signed out or signed in to another deployment', async () => {
    for (const signIn of [account(undefined), account('tk-1', 'https://api.other.example')]) {
      const { search } = providers(signIn)
      await expect(search.ready()).resolves.toBe(false)
      await expect(search.search({ query: 'q' })).rejects.toMatchObject({
        code: 'WEB_PROVIDER_ERROR', message: 'Tokamak web search needs a signed-in Tokamak account; sign in or select another provider',
      })
    }
    expect(loopback.calls).toHaveLength(0)
  })

  it('reports a rejected key to the account', async () => {
    loopback.handler = (_request, res) => { json(res, { error: 'unauthorized' }, 401) }
    const signIn = account('tk-stale')
    await expect(providers(signIn).search.search({ query: 'q' })).rejects.toMatchObject({
      code: 'WEB_PROVIDER_ERROR', message: 'Tokamak rejected the signed-in account\'s API key (HTTP 401); sign in to Tokamak again',
    })
    expect(signIn.rejected).toEqual(['tk-stale'])
  })

  it.each([
    [400, { error: { code: 'invalid_request', message: 'unknown field' } }, 'Tokamak web search failed (HTTP 400 invalid_request): unknown field'],
    [402, { error: 'insufficient balance' }, 'Tokamak web search failed (HTTP 402): insufficient balance; the Tokamak organization cannot pay for this call, so add credit or select another provider'],
    [422, { code: 'max_results_exceeded', message: 'at most 5' }, 'Tokamak web search failed (HTTP 422 max_results_exceeded): at most 5'],
    [429, { error: { code: 'rate_limited' } }, 'Tokamak web search failed (HTTP 429 rate_limited); wait a minute and try again'],
    [502, { error: { code: 'upstream_error', message: 'timeout' } }, 'Tokamak web search failed (HTTP 502 upstream_error): timeout; the upstream provider failed, so try again or select another provider'],
    [503, { error: { code: 'web_search_unavailable' } }, 'Tokamak web search failed (HTTP 503 web_search_unavailable); this deployment offers no provider for it, so select another provider'],
    [500, '<html>gateway</html>', 'Tokamak web search failed (HTTP 500): <html>gateway</html>'],
    [500, '', 'Tokamak web search failed (HTTP 500)'],
  ])('maps HTTP %i to a WEB_PROVIDER_ERROR naming the next step', async (status, body, message) => {
    loopback.handler = (_request, res) => {
      if (typeof body === 'string') res.writeHead(status).end(body)
      else json(res, body, status)
    }
    const signIn = account('tk-1')
    await expect(providers(signIn).search.search({ query: 'q' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR', message })
    expect(signIn.rejected).toEqual([])
  })

  it('rejects a malformed reply', async () => {
    loopback.handler = (_request, res) => { res.writeHead(200).end('not json') }
    await expect(providers(account('tk-1')).search.search({ query: 'q' })).rejects.toThrow('Tokamak returned invalid JSON')
  })
})

describe('TokamakFetchProvider', () => {
  it('posts only the URL and character bound and maps the page', async () => {
    loopback.handler = (_request, res) => {
      json(res, { id: 'wf_1', object: 'web_fetch', provider: 'exa', url: 'https://final.example/', title: 'T', content: '# Page', truncated: false })
    }
    const { fetch } = providers(account('tk-1'))
    await expect(fetch.ready()).resolves.toBe(true)
    await expect(fetch.fetch({ url: 'https://example.com' })).resolves.toEqual({
      url: 'https://final.example/', statusCode: 200, body: { kind: 'text', content: '# Page' }, truncated: false,
    })
    expect(loopback.calls[0]?.path).toBe('/tokamak/v1/web_fetch')
    expect(loopback.calls[0]?.headers.authorization).toBe('Bearer tk-1')
    expect(loopback.calls[0]?.body).toEqual({ url: 'https://example.com', max_characters: 1000 })
  })

  it('keeps the requested URL without a usable reported one, and flags truncation by Tokamak or the bound', async () => {
    loopback.handler = (_request, res) => { json(res, { url: null, content: 'x'.repeat(5), truncated: true }) }
    await expect(providers(account('tk-1')).fetch.fetch({ url: 'https://example.com' }))
      .resolves.toMatchObject({ url: 'https://example.com', truncated: true })
    loopback.handler = (_request, res) => { json(res, { url: 'relative', content: 'x'.repeat(10) }) }
    await expect(providers(account('tk-1'), { maxCharacters: 4 }).fetch.fetch({ url: 'https://example.com' }))
      .resolves.toMatchObject({ url: 'https://example.com', body: { content: 'xxxx' }, truncated: true })
  })

  it('fails for an empty page', async () => {
    loopback.handler = (_request, res) => { json(res, { url: 'https://example.com', content: ' ' }) }
    await expect(providers(account('tk-1')).fetch.fetch({ url: 'https://example.com' }))
      .rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR', message: 'Tokamak returned no content for https://example.com' })
  })

  it('maps url_not_allowed to WEB_BLOCKED_URL and fetch_failed to WEB_PROVIDER_ERROR', async () => {
    loopback.handler = (_request, res) => { json(res, { error: { code: 'url_not_allowed', message: 'private address' } }, 400) }
    await expect(providers(account('tk-1')).fetch.fetch({ url: 'http://10.0.0.1/' })).rejects.toMatchObject({
      code: 'WEB_BLOCKED_URL',
      message: 'Tokamak refused to fetch this URL (HTTP 400 url_not_allowed); only public http(s) URLs can be fetched: private address',
    })
    loopback.handler = (_request, res) => { json(res, { error: { code: 'fetch_failed', message: 'no readable content' } }, 422) }
    await expect(providers(account('tk-1')).fetch.fetch({ url: 'https://example.com' })).rejects.toMatchObject({
      code: 'WEB_PROVIDER_ERROR', message: 'Tokamak web fetch failed (HTTP 422 fetch_failed): no readable content',
    })
  })

  it('refuses a non-http(s) URL without contacting Tokamak', async () => {
    await expect(providers(account('tk-1')).fetch.fetch({ url: 'file:///etc/passwd' })).rejects.toMatchObject({ code: 'WEB_INVALID_URL' })
    expect(loopback.calls).toHaveLength(0)
  })
})
