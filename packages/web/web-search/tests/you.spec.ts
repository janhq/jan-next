import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { YOU_CLIENT_INFO, YouFetchProvider, YouSearchProvider, normalizeSearch } from '../src/you.ts'
import { fixedKey, json, specsFor, sse, startLoopback, toolText } from './loopback.ts'
import type { Loopback } from './loopback.ts'

let loopback: Loopback

beforeEach(async () => { loopback = await startLoopback() })
afterEach(async () => { await loopback.close() })

function you(overrides: Parameters<typeof specsFor>[1] = {}): ReturnType<typeof specsFor>['you'] {
  return specsFor(loopback.base, overrides).you
}

const SEARCH_REPLY = {
  results: {
    web: [
      { url: 'https://a.example', title: 'A', description: 'Summary of A', snippets: ['fragment'], page_age: '2026-03-04T00:00:00' },
      { url: 'https://b.example', title: 'B', description: '', snippets: ['first', 'second'] },
      { url: 'nope', title: 'dropped' },
    ],
    news: [{ url: 'https://news.example', title: 'ignored' }],
  },
}

const EXPECTED_SOURCES = [
  { url: 'https://a.example', title: 'A', snippet: 'Summary of A', summary: 'Summary of A', publishedAt: '2026-03-04T00:00:00' },
  { url: 'https://b.example', title: 'B', snippet: 'first second', summary: 'first second' },
]

describe('You.com search normalization', () => {
  it('treats a news-only or empty reply as no results', async () => {
    expect(normalizeSearch({ results: { web: [] } })).toEqual([])
    for (const reply of [{ results: { news: [{ url: 'https://news.example' }] } }, {}]) {
      loopback.handler = (_request, res) => { json(res, reply) }
      await expect(new YouSearchProvider(you(), fixedKey('k')).search({ query: 'q' })).resolves.toEqual({ sources: [], truncated: false })
    }
  })

  it('reports both providers available without a network call', () => {
    expect(new YouSearchProvider(you(), fixedKey(undefined)).available()).toBe(true)
    expect(new YouFetchProvider(you(), fixedKey(undefined)).available()).toBe(true)
    expect(loopback.calls).toHaveLength(0)
  })

  it('identifies the client with the attribution grammar You.com reads', () => {
    const segments = YOU_CLIENT_INFO.split('; ')
    expect(segments).toHaveLength(3)
    expect(segments[0]).toBe('plugin')
    expect(segments[1]).toMatch(/^client=jan-web-search\/[^/;\s]+$/)
    expect(segments[2]).toMatch(/^ua=node\/\d/)
  })
})

describe('YouSearchProvider', () => {
  it('calls the hosted you-search tool without a key, reading the result after a notification frame', async () => {
    loopback.handler = (_request, res) => {
      sse(res, { jsonrpc: '2.0', method: 'notifications/message', params: { data: 'searching' } }, toolText(JSON.stringify(SEARCH_REPLY)))
    }
    const result = await new YouSearchProvider(you(), fixedKey(undefined)).search({ query: 'q', maxResults: 30 })
    const [request] = loopback.calls
    expect(request?.path).toBe('/you/mcp')
    expect(request?.body.params).toEqual({ name: 'you-search', arguments: { query: 'q', count: 20 } })
    expect(request?.headers['x-api-key']).toBeUndefined()
    expect(request?.headers['user-agent']).toBe('jan-web-search (+https://github.com/janhq/jan-next)')
    expect(request?.headers['x-client-info']).toBe(YOU_CLIENT_INFO)
    expect(result).toEqual({ sources: EXPECTED_SOURCES, truncated: false })
  })

  it('posts to the REST search endpoint with a key', async () => {
    loopback.handler = (_request, res) => { json(res, SEARCH_REPLY) }
    const result = await new YouSearchProvider(you({ numResults: 4 }), fixedKey('ydc-key')).search({ query: 'q' })
    expect(loopback.calls[0]?.path).toBe('/you/v1/search')
    expect(loopback.calls[0]?.headers['x-api-key']).toBe('ydc-key')
    expect(loopback.calls[0]?.headers['content-type']).toBe('application/json')
    expect(loopback.calls[0]?.body).toEqual({ query: 'q', count: 4 })
    expect(result.sources).toEqual(EXPECTED_SOURCES)
  })

  it('names the credential reference when You.com rejects the key', async () => {
    loopback.handler = (_request, res) => { json(res, { detail: 'forbidden' }, 403) }
    await expect(new YouSearchProvider(you(), fixedKey('bad')).search({ query: 'q' }))
      .rejects.toThrow(/You.com rejected the API key in YDC_API_KEY \(HTTP 403\)/)
  })

  it('reports a hosted tool payload that is not search JSON', async () => {
    loopback.handler = (_request, res) => { sse(res, toolText('plain text')) }
    await expect(new YouSearchProvider(you(), fixedKey(undefined)).search({ query: 'q' })).rejects.toThrow('You.com returned invalid JSON')
  })
})

describe('YouFetchProvider', () => {
  it('reads markdown from the keyless extract endpoint without a key', async () => {
    loopback.handler = (_request, res) => { json(res, { url: 'https://example.com/', title: 'T', contents: { full_page: { markdown: '# Hello\n\nWorld' } } }) }
    const result = await new YouFetchProvider(you(), fixedKey(undefined)).fetch({ url: 'https://example.com' })
    expect(loopback.calls[0]?.path).toBe('/you/extract')
    expect(loopback.calls[0]?.body).toEqual({ url: 'https://example.com' })
    expect(loopback.calls[0]?.headers['x-client-info']).toBe(YOU_CLIENT_INFO)
    expect(result).toEqual({ url: 'https://example.com/', statusCode: 200, body: { kind: 'text', content: '# Hello\n\nWorld' }, truncated: false })
  })

  it('reports a refused keyless extraction with the next step', async () => {
    loopback.handler = (_request, res) => { json(res, { error: 'pdf_not_supported', message: 'PDFs need a key' }, 422) }
    await expect(new YouFetchProvider(you(), fixedKey(undefined)).fetch({ url: 'https://example.com/a.pdf' }))
      .rejects.toThrow('You.com cannot extract PDFs without an API key; set YDC_API_KEY or select another fetch provider')
    loopback.handler = (_request, res) => { json(res, { message: 'Free allowance paused.' }, 402) }
    await expect(new YouFetchProvider(you(), fixedKey(undefined)).fetch({ url: 'https://example.com' }))
      .rejects.toThrow('You.com refused the keyless extraction: Free allowance paused.; set YDC_API_KEY or select another fetch provider')
    loopback.handler = (_request, res) => { res.writeHead(402).end('not json') }
    await expect(new YouFetchProvider(you(), fixedKey(undefined)).fetch({ url: 'https://example.com' }))
      .rejects.toThrow(/the free extraction allowance is used up/)
    loopback.handler = (_request, res) => { json(res, { error: 'other' }, 422) }
    await expect(new YouFetchProvider(you(), fixedKey(undefined)).fetch({ url: 'https://example.com' })).rejects.toThrow(/HTTP 422/)
    loopback.handler = (_request, res) => { json(res, {}) }
    await expect(new YouFetchProvider(you(), fixedKey(undefined)).fetch({ url: 'https://example.com' }))
      .rejects.toThrow('You.com returned no content for https://example.com')
  })

  it('posts to the REST contents endpoint with a key and bounds the markdown', async () => {
    loopback.handler = (_request, res) => { json(res, [{ url: 'https://example.com/', title: 'T', markdown: 'y'.repeat(15) }]) }
    const result = await new YouFetchProvider(you({ maxCharacters: 10 }), fixedKey('ydc-key')).fetch({ url: 'https://example.com' })
    expect(loopback.calls[0]?.path).toBe('/you/v1/contents')
    expect(loopback.calls[0]?.headers['x-api-key']).toBe('ydc-key')
    expect(loopback.calls[0]?.body).toEqual({ urls: ['https://example.com'], formats: ['markdown'] })
    expect(result).toEqual({ url: 'https://example.com/', statusCode: 200, body: { kind: 'text', content: 'y'.repeat(10) }, truncated: true })
  })

  it('reports a failed keyed extraction', async () => {
    loopback.handler = (_request, res) => { json(res, [{ url: 'https://example.com/', markdown: null }]) }
    await expect(new YouFetchProvider(you(), fixedKey('k')).fetch({ url: 'https://example.com' }))
      .rejects.toThrow('You.com returned no content for https://example.com')
    loopback.handler = (_request, res) => { json(res, []) }
    await expect(new YouFetchProvider(you(), fixedKey('k')).fetch({ url: 'https://example.com' })).rejects.toThrow(/no content/)
  })

  it('keeps the requested URL when the reply reports none or an unparseable one', async () => {
    loopback.handler = (_request, res) => { json(res, [{ url: 'relative/path', markdown: 'm' }]) }
    await expect(new YouFetchProvider(you(), fixedKey('k')).fetch({ url: 'https://example.com' })).resolves.toMatchObject({ url: 'https://example.com' })
    loopback.handler = (_request, res) => { json(res, { contents: { full_page: { markdown: 'm' } } }) }
    await expect(new YouFetchProvider(you(), fixedKey(undefined)).fetch({ url: 'https://example.com' })).resolves.toMatchObject({ url: 'https://example.com' })
  })

  it('rejects a non-http URL before contacting You.com', async () => {
    await expect(new YouFetchProvider(you(), fixedKey('k')).fetch({ url: 'ftp://example.com' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_INVALID_URL' }))
    expect(loopback.calls).toHaveLength(0)
  })

  it('does not follow a redirect with the key', async () => {
    let followed = false
    const target = createServer((_req, res) => { followed = true; res.end() })
    await new Promise<void>((done) => { target.listen(0, '127.0.0.1', done) })
    try {
      const port = (target.address() as AddressInfo).port
      loopback.handler = (_request, res) => { res.writeHead(302, { location: `http://127.0.0.1:${String(port)}/` }).end() }
      await expect(new YouSearchProvider(you(), fixedKey('k')).search({ query: 'q' }))
        .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
      await expect(new YouFetchProvider(you(), fixedKey('k')).fetch({ url: 'https://example.com' }))
        .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
      expect(followed).toBe(false)
    } finally {
      await new Promise<void>((done) => { target.close(() => { done() }) })
    }
  })
})
