import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  ExaFetchProvider, ExaSearchProvider, normalizeRestContents, parseHostedSearchText, stripHostedFetchHeader,
} from '../src/exa.ts'
import { fixedKey, json, specsFor, sse, startLoopback, toolText } from './loopback.ts'
import type { Loopback } from './loopback.ts'

let loopback: Loopback

beforeEach(async () => { loopback = await startLoopback() })
afterEach(async () => { await loopback.close() })

const SEARCH_TEXT = [
  'Title: Releases · ggml-org/llama.cpp\nURL: https://github.com/ggml-org/llama.cpp/releases\nPublished: N/A\nAuthor: N/A\nHighlights:\nb12284\n\nCUDA: Add OCP FP8 support',
  'Title: llama.cpp release history\nURL: https://example.com/llama\nPublished: 2026-11-11T00:00:00.000Z\nAuthor: N/A\nHighlights:\nLatest release b12283',
  'Title: No link\nURL: N/A\nHighlights:\nignored',
].join('\n---\n')

function exa(overrides: Parameters<typeof specsFor>[1] = {}): ReturnType<typeof specsFor>['exa'] {
  return specsFor(loopback.base, overrides).exa
}

describe('hosted Exa text parsing', () => {
  it('splits search text into sources and drops a block without a URL', () => {
    expect(parseHostedSearchText(SEARCH_TEXT)).toEqual([
      {
        url: 'https://github.com/ggml-org/llama.cpp/releases', title: 'Releases · ggml-org/llama.cpp',
        snippet: 'b12284\n\nCUDA: Add OCP FP8 support', summary: 'b12284\n\nCUDA: Add OCP FP8 support',
      },
      {
        url: 'https://example.com/llama', title: 'llama.cpp release history', snippet: 'Latest release b12283',
        summary: 'Latest release b12283', publishedAt: '2026-11-11T00:00:00.000Z',
      },
    ])
  })

  it('bounds the display snippet but keeps the full highlights as the summary', () => {
    const long = 'x'.repeat(400)
    const [source] = parseHostedSearchText(`Title: T\nURL: https://a.example\nHighlights:\n${long}`)
    expect(source?.snippet).toBe(`${'x'.repeat(300)}…`)
    expect(source?.summary).toBe(long)
  })

  it('keeps a source whose block has no title or highlights', () => {
    expect(parseHostedSearchText('URL: https://bare.example')).toEqual([{ url: 'https://bare.example' }])
  })

  it('removes the title and URL header from fetched text', () => {
    expect(stripHostedFetchHeader('# Example Domain\nURL: https://example.com\n\nBody text')).toBe('Body text')
  })
})

describe('ExaSearchProvider without a key', () => {
  it('calls web_search_exa on the MCP endpoint with the clamped result count', async () => {
    loopback.handler = (_request, res) => { sse(res, toolText(SEARCH_TEXT)) }
    const result = await new ExaSearchProvider(exa(), fixedKey(undefined)).search({ query: 'llama.cpp', maxResults: 50 })
    expect(loopback.calls[0]?.path).toBe('/exa/mcp')
    expect(loopback.calls[0]?.headers['x-api-key']).toBeUndefined()
    expect(loopback.calls[0]?.body).toEqual({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'web_search_exa', arguments: { query: 'llama.cpp', objective: 'llama.cpp', numResults: 20 } },
    })
    expect(result.sources.map(source => source.url)).toEqual(['https://github.com/ggml-org/llama.cpp/releases', 'https://example.com/llama'])
    expect(result.truncated).toBe(false)
  })

  it('uses the configured count when the caller sets none, and at least one', async () => {
    loopback.handler = (_request, res) => { sse(res, toolText('')) }
    await new ExaSearchProvider(exa({ numResults: 3 }), fixedKey(undefined)).search({ query: 'q' })
    await new ExaSearchProvider(exa(), fixedKey(undefined)).search({ query: 'q', maxResults: 0 })
    expect(loopback.calls.map(call => (call.body.params as { arguments: { numResults: number } }).arguments.numResults)).toEqual([3, 1])
  })

  it('fails on a rate-limited reply instead of returning no results', async () => {
    loopback.handler = (_request, res) => { sse(res, toolText('', { 'ai.exa/rateLimited': true })) }
    const failure = new ExaSearchProvider(exa(), fixedKey(undefined)).search({ query: 'q' })
    await expect(failure).rejects.toThrow(/Exa rate-limited/)
    await expect(failure).rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })
})

describe('ExaSearchProvider with a key', () => {
  it('posts to the REST search endpoint with the key and maps results', async () => {
    loopback.handler = (_request, res) => {
      json(res, {
        results: [
          { url: 'https://a.example', title: 'A', text: 'Page text of A', highlights: ['The best sentence.'], publishedDate: '2026-01-02' },
          { url: 'https://b.example', title: null, text: 'Only text', highlights: [], publishedDate: null },
          { url: 'not a url', title: 'dropped' },
        ],
      })
    }
    const result = await new ExaSearchProvider(exa(), fixedKey('exa-key')).search({ query: 'q', maxResults: 2 })
    expect(loopback.calls[0]?.path).toBe('/exa/search')
    expect(loopback.calls[0]?.headers['x-api-key']).toBe('exa-key')
    expect(loopback.calls[0]?.body).toEqual({
      query: 'q', type: 'auto', numResults: 2,
      contents: { text: { maxCharacters: 800 }, highlights: { numSentences: 3, highlightsPerUrl: 1 } },
    })
    expect(result).toEqual({
      sources: [
        { url: 'https://a.example', title: 'A', snippet: 'The best sentence.', summary: 'Page text of A', publishedAt: '2026-01-02' },
        { url: 'https://b.example', snippet: 'Only text', summary: 'Only text' },
      ],
      truncated: false,
    })
  })

  it('names the credential reference when Exa rejects the key, and asks for a retry on HTTP 429', async () => {
    loopback.handler = (_request, res) => { json(res, { error: 'invalid key' }, 401) }
    await expect(new ExaSearchProvider(exa(), fixedKey('bad')).search({ query: 'q' }))
      .rejects.toThrow(/rejected the API key in EXA_API_KEY \(HTTP 401\).*invalid key/)
    loopback.handler = (_request, res) => { json(res, {}, 429) }
    await expect(new ExaSearchProvider(exa(), fixedKey('k')).search({ query: 'q' })).rejects.toThrow(/rate-limited this request \(HTTP 429\)/)
  })

  it('reports an invalid or unexpected reply as a provider error', async () => {
    loopback.handler = (_request, res) => { res.writeHead(200).end('not json') }
    await expect(new ExaSearchProvider(exa(), fixedKey('k')).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR', message: 'Exa returned invalid JSON' }))
    loopback.handler = (_request, res) => { json(res, { results: 'nope' }) }
    await expect(new ExaSearchProvider(exa(), fixedKey('k')).search({ query: 'q' })).rejects.toThrow(/Exa returned an unexpected reply/)
  })

  it('does not follow a redirect with the key', async () => {
    let followed = false
    const target = createServer((_req, res) => { followed = true; res.end() })
    await new Promise<void>((done) => { target.listen(0, '127.0.0.1', done) })
    try {
      const port = (target.address() as AddressInfo).port
      loopback.handler = (_request, res) => { res.writeHead(307, { location: `http://127.0.0.1:${String(port)}/` }).end() }
      await expect(new ExaSearchProvider(exa(), fixedKey('k')).search({ query: 'q' }))
        .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
      await expect(new ExaFetchProvider(exa(), fixedKey('k')).fetch({ url: 'https://example.com' }))
        .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
      expect(followed).toBe(false)
    } finally {
      await new Promise<void>((done) => { target.close(() => { done() }) })
    }
  })
})

describe('ExaFetchProvider', () => {
  it('calls web_fetch_exa without a key and returns the page text', async () => {
    loopback.handler = (_request, res) => { sse(res, toolText('# Example\nURL: https://example.com\n\nHello page')) }
    const result = await new ExaFetchProvider(exa(), fixedKey(undefined)).fetch({ url: 'https://example.com' })
    expect(loopback.calls[0]?.body.params).toEqual({ name: 'web_fetch_exa', arguments: { urls: ['https://example.com'], maxCharacters: 1000 } })
    expect(result).toEqual({ url: 'https://example.com', statusCode: 200, body: { kind: 'text', content: 'Hello page' }, truncated: false })
  })

  it('flags hosted text that reached the character limit as truncated', async () => {
    loopback.handler = (_request, res) => { sse(res, toolText('abcdef')) }
    expect((await new ExaFetchProvider(exa({ maxCharacters: 6 }), fixedKey(undefined)).fetch({ url: 'https://example.com' })).truncated).toBe(true)
  })

  it('posts to the REST contents endpoint with a key and bounds the text', async () => {
    loopback.handler = (_request, res) => { json(res, { results: [{ url: 'https://example.com/final', title: 'T', text: 'x'.repeat(12) }] }) }
    const result = await new ExaFetchProvider(exa({ maxCharacters: 10 }), fixedKey('exa-key')).fetch({ url: 'https://example.com' })
    expect(loopback.calls[0]?.path).toBe('/exa/contents')
    expect(loopback.calls[0]?.headers['x-api-key']).toBe('exa-key')
    expect(loopback.calls[0]?.body).toEqual({ urls: ['https://example.com'], text: { maxCharacters: 10 } })
    expect(result).toEqual({ url: 'https://example.com/final', statusCode: 200, body: { kind: 'text', content: 'x'.repeat(10) }, truncated: true })
  })

  it('reports REST text that exactly fills the bound as truncated, and keeps the requested URL without a reported one', async () => {
    loopback.handler = (_request, res) => { json(res, { results: [{ text: 'x'.repeat(10) }] }) }
    await expect(new ExaFetchProvider(exa({ maxCharacters: 10 }), fixedKey('k')).fetch({ url: 'https://example.com' }))
      .resolves.toMatchObject({ url: 'https://example.com', truncated: true })
    loopback.handler = (_request, res) => { json(res, { results: [{ text: 'short' }] }) }
    await expect(new ExaFetchProvider(exa({ maxCharacters: 10 }), fixedKey('k')).fetch({ url: 'https://example.com' }))
      .resolves.toMatchObject({ truncated: false })
  })

  it('reports a REST reply without content with Exa\'s status tag', async () => {
    loopback.handler = (_request, res) => {
      json(res, { results: [], statuses: [{ id: 'https://example.com', status: 'error', error: { tag: 'CRAWL_NOT_FOUND', httpStatusCode: 404 } }] })
    }
    await expect(new ExaFetchProvider(exa(), fixedKey('k')).fetch({ url: 'https://example.com' }))
      .rejects.toThrow('Exa returned no content for https://example.com (CRAWL_NOT_FOUND, HTTP 404)')
    loopback.handler = (_request, res) => {
      json(res, { results: [{ url: 'https://example.com', text: ' ' }], statuses: [{ status: 'error', error: { tag: 'CRAWL_TIMEOUT', httpStatusCode: null } }] })
    }
    await expect(new ExaFetchProvider(exa(), fixedKey('k')).fetch({ url: 'https://example.com' }))
      .rejects.toThrow('Exa returned no content for https://example.com (CRAWL_TIMEOUT)')
    expect(() => normalizeRestContents({ results: [], statuses: [{ status: 'success' }] }, 'https://example.com', 10))
      .toThrow(/^Exa returned no content for https:\/\/example.com$/)
  })

  it('rejects a non-http URL before contacting Exa', async () => {
    await expect(new ExaFetchProvider(exa(), fixedKey(undefined)).fetch({ url: 'file:///etc/passwd' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_INVALID_URL' }))
    expect(loopback.calls).toHaveLength(0)
  })
})
