import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { TavilyFetchProvider, TavilySearchProvider } from '../src/tavily.ts'
import { fixedKey, json, specsFor, startLoopback } from './loopback.ts'
import type { Loopback } from './loopback.ts'

let loopback: Loopback

beforeEach(async () => { loopback = await startLoopback() })
afterEach(async () => { await loopback.close() })

function tavily(overrides: Parameters<typeof specsFor>[1] = {}): ReturnType<typeof specsFor>['tavily'] {
  return specsFor(loopback.base, overrides).tavily
}

describe('TavilySearchProvider', () => {
  it('posts the query and clamped count with a bearer key and maps results', async () => {
    loopback.handler = (_request, res) => {
      json(res, {
        results: [
          { title: 'One', url: 'https://a.example', content: 'first excerpt', published_date: '2024-01-01' },
          { title: '', url: 'https://b.example', content: '' },
          { title: 'dropped', url: 'nope' },
          { url: 'https://c.example' },
        ],
      })
    }
    const result = await new TavilySearchProvider(tavily(), fixedKey('tvly-abc')).search({ query: 'q', maxResults: 40 })
    expect(loopback.calls[0]?.path).toBe('/tavily/search')
    expect(loopback.calls[0]?.headers.authorization).toBe('Bearer tvly-abc')
    expect(loopback.calls[0]?.body).toEqual({ query: 'q', max_results: 20 })
    expect(result).toEqual({
      sources: [
        { url: 'https://a.example', title: 'One', snippet: 'first excerpt', summary: 'first excerpt', publishedAt: '2024-01-01' },
        { url: 'https://b.example' },
        { url: 'https://c.example' },
      ],
      truncated: false,
    })
  })

  it('treats a reply without results as empty', async () => {
    loopback.handler = (_request, res) => { json(res, {}) }
    await expect(new TavilySearchProvider(tavily(), fixedKey('k')).search({ query: 'q' })).resolves.toEqual({ sources: [], truncated: false })
  })

  it('requires a key: not ready, and a search fails naming the reference without contacting Tavily', async () => {
    const provider = new TavilySearchProvider(tavily(), fixedKey(undefined))
    expect(provider.available()).toBe(true)
    await expect(provider.ready()).resolves.toBe(false)
    await expect(new TavilySearchProvider(tavily(), fixedKey('k')).ready()).resolves.toBe(true)
    await expect(provider.search({ query: 'q' }))
      .rejects.toThrow('Tavily requires an API key; set TAVILY_API_KEY or select another provider')
    expect(loopback.calls).toHaveLength(0)
  })

  it('names the credential reference when Tavily rejects the key', async () => {
    loopback.handler = (_request, res) => { json(res, { detail: { error: 'Unauthorized' } }, 401) }
    await expect(new TavilySearchProvider(tavily(), fixedKey('bad')).search({ query: 'q' }))
      .rejects.toThrow(/Tavily rejected the API key in TAVILY_API_KEY \(HTTP 401\)/)
  })
})

describe('TavilyFetchProvider', () => {
  it('posts the URL to /extract and bounds the raw content', async () => {
    loopback.handler = (_request, res) => { json(res, { results: [{ url: 'https://example.com/final', raw_content: 'z'.repeat(12) }], failed_results: [] }) }
    const result = await new TavilyFetchProvider(tavily({ maxCharacters: 10 }), fixedKey('tvly-abc')).fetch({ url: 'https://example.com' })
    expect(loopback.calls[0]?.path).toBe('/tavily/extract')
    expect(loopback.calls[0]?.headers.authorization).toBe('Bearer tvly-abc')
    expect(loopback.calls[0]?.body).toEqual({ urls: ['https://example.com'] })
    expect(result).toEqual({ url: 'https://example.com/final', statusCode: 200, body: { kind: 'text', content: 'z'.repeat(10) }, truncated: true })
  })

  it('reports no content with Tavily\'s failure reason, and keeps the requested URL without a reported one', async () => {
    loopback.handler = (_request, res) => { json(res, { results: [], failed_results: [{ url: 'https://example.com', error: 'Failed to fetch url' }] }) }
    await expect(new TavilyFetchProvider(tavily(), fixedKey('k')).fetch({ url: 'https://example.com' }))
      .rejects.toThrow('Tavily returned no content for https://example.com: Failed to fetch url')
    loopback.handler = (_request, res) => { json(res, { results: [{ raw_content: null }], failed_results: [{ url: 'https://example.com' }] }) }
    await expect(new TavilyFetchProvider(tavily(), fixedKey('k')).fetch({ url: 'https://example.com' }))
      .rejects.toThrow(/^Tavily returned no content for https:\/\/example.com$/)
    loopback.handler = (_request, res) => { json(res, { results: [{ raw_content: 'page' }] }) }
    await expect(new TavilyFetchProvider(tavily(), fixedKey('k')).fetch({ url: 'https://example.com' }))
      .resolves.toMatchObject({ url: 'https://example.com', body: { content: 'page' } })
  })

  it('requires a key and an http(s) URL before contacting Tavily', async () => {
    const provider = new TavilyFetchProvider(tavily(), fixedKey(undefined))
    expect(provider.available()).toBe(true)
    await expect(provider.ready()).resolves.toBe(false)
    await expect(provider.fetch({ url: 'https://example.com' })).rejects.toThrow(/set TAVILY_API_KEY/)
    await expect(new TavilyFetchProvider(tavily(), fixedKey('k')).fetch({ url: 'file:///etc/passwd' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_INVALID_URL' }))
    expect(loopback.calls).toHaveLength(0)
  })

  it('does not follow a redirect with the key', async () => {
    let followed = false
    const target = createServer((_req, res) => { followed = true; res.end() })
    await new Promise<void>((done) => { target.listen(0, '127.0.0.1', done) })
    try {
      const port = (target.address() as AddressInfo).port
      loopback.handler = (_request, res) => { res.writeHead(308, { location: `http://127.0.0.1:${String(port)}/` }).end() }
      await expect(new TavilySearchProvider(tavily(), fixedKey('k')).search({ query: 'q' }))
        .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
      await expect(new TavilyFetchProvider(tavily(), fixedKey('k')).fetch({ url: 'https://example.com' }))
        .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
      expect(followed).toBe(false)
    } finally {
      await new Promise<void>((done) => { target.close(() => { done() }) })
    }
  })
})
