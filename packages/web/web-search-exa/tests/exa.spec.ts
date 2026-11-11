import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Context } from '@deepseek-ai/cordis'
import WebRuntime from '@deepseek-ai/dsh-web'
import * as exaPlugin from '../src/index.ts'
import { ExaFetchProvider, ExaSearchProvider, parseRpcReply, parseSearchText, stripFetchHeader } from '../src/provider.ts'
import type { ExaOptions } from '../src/provider.ts'

type Handler = (body: Record<string, unknown>, req: IncomingMessage, res: ServerResponse) => void

let server: Server
let base: string
let handler: Handler
let calls: Record<string, unknown>[]

beforeEach(async () => {
  calls = []
  handler = (_body, _req, res) => { res.writeHead(500).end() }
  server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => { chunks.push(chunk) })
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
      calls.push(body)
      handler(body, req, res)
    })
  })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/mcp`
})

afterEach(async () => {
  server.closeAllConnections()
  await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
})

const SEARCH_TEXT = [
  'Title: Releases · ggml-org/llama.cpp\nURL: https://github.com/ggml-org/llama.cpp/releases\nPublished: N/A\nAuthor: N/A\nHighlights:\nb12284\n\nCUDA: Add OCP FP8 support',
  'Title: llama.cpp release history\nURL: https://example.com/llama\nPublished: 2026-11-11T00:00:00.000Z\nAuthor: N/A\nHighlights:\nLatest release b12283',
  'Title: No link\nURL: N/A\nHighlights:\nignored',
].join('\n---\n')

function options(overrides: Partial<ExaOptions> = {}): () => ExaOptions {
  return () => ({ url: base, numResults: 5, maxCharacters: 1000, timeoutMs: 5000, ...overrides })
}

function sse(res: ServerResponse, payload: unknown): void {
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  res.end(`event: message\ndata: ${JSON.stringify(payload)}\n\n`)
}

function textResult(text: string, meta?: Record<string, unknown>): unknown {
  return { jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text }], ...meta === undefined ? {} : { _meta: meta } } }
}

describe('Exa reply parsing', () => {
  it('reads a reply from plain JSON and from an SSE frame', () => {
    expect(parseRpcReply('{"result":{"content":[]}}')).toEqual({ result: { content: [] } })
    expect(parseRpcReply(': ping\n\nevent: message\ndata: not-json\ndata: {"error":{"message":"bad"}}\n')).toEqual({ error: { message: 'bad' } })
    expect(() => parseRpcReply('event: message\n\n')).toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })

  it('splits search text into sources and drops a block without a URL', () => {
    expect(parseSearchText(SEARCH_TEXT)).toEqual([
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
    const [source] = parseSearchText(`Title: T\nURL: https://a.example\nHighlights:\n${long}`)
    expect(source?.snippet).toBe(`${'x'.repeat(300)}…`)
    expect(source?.summary).toBe(long)
  })

  it('removes the title and URL header from fetched text', () => {
    expect(stripFetchHeader('# Example Domain\nURL: https://example.com\n\nBody text')).toBe('Body text')
  })
})

describe('ExaSearchProvider', () => {
  it('calls web_search_exa with the bounded result count and maps sources', async () => {
    handler = (_body, _req, res) => { sse(res, textResult(SEARCH_TEXT)) }
    const result = await new ExaSearchProvider(options()).search({ query: 'llama.cpp', maxResults: 50 })
    expect(calls[0]).toEqual({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'web_search_exa', arguments: { query: 'llama.cpp', objective: 'llama.cpp', numResults: 20 } },
    })
    expect(result.sources.map(source => source.url)).toEqual(['https://github.com/ggml-org/llama.cpp/releases', 'https://example.com/llama'])
    expect(result.truncated).toBe(false)
  })

  it('uses the configured count when the caller sets none', async () => {
    handler = (_body, _req, res) => { sse(res, textResult('')) }
    await new ExaSearchProvider(options({ numResults: 3 })).search({ query: 'q' })
    expect((calls[0]?.params as { arguments: { numResults: number } }).arguments.numResults).toBe(3)
  })

  it('fails on a rate-limited reply instead of returning no results', async () => {
    handler = (_body, _req, res) => { sse(res, textResult('', { 'ai.exa/rateLimited': true })) }
    const failure = new ExaSearchProvider(options()).search({ query: 'q' })
    await expect(failure).rejects.toThrow(/rate-limited/)
    await expect(failure).rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })

  it('reports JSON-RPC, tool, and HTTP errors', async () => {
    handler = (_body, _req, res) => { res.writeHead(200, { 'content-type': 'application/json' }).end('{"error":{"message":"nope"}}') }
    await expect(new ExaSearchProvider(options()).search({ query: 'q' })).rejects.toThrow(/Exa error: nope/)
    handler = (_body, _req, res) => { sse(res, { result: { isError: true, content: [{ type: 'text', text: 'bad query' }] } }) }
    await expect(new ExaSearchProvider(options()).search({ query: 'q' })).rejects.toThrow(/Exa error: bad query/)
    handler = (_body, _req, res) => { res.writeHead(503).end('down') }
    await expect(new ExaSearchProvider(options()).search({ query: 'q' })).rejects.toThrow(/HTTP 503/)
  })

  it('refuses an oversized reply', async () => {
    handler = (_body, _req, res) => { res.writeHead(200, { 'content-type': 'application/json' }).end(Buffer.alloc(5 * 1024 * 1024, 32)) }
    await expect(new ExaSearchProvider(options()).search({ query: 'q' })).rejects.toThrow(/oversized reply/)
  })

  it('does not follow a redirect', async () => {
    let followed = false
    const target = createServer((_req, res) => { followed = true; res.end() })
    await new Promise<void>((resolve) => { target.listen(0, '127.0.0.1', resolve) })
    try {
      handler = (_body, _req, res) => { res.writeHead(307, { location: `http://127.0.0.1:${String((target.address() as AddressInfo).port)}/` }).end() }
      await expect(new ExaSearchProvider(options()).search({ query: 'q' })).rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
      expect(followed).toBe(false)
    } finally {
      await new Promise<void>((resolve) => { target.close(() => { resolve() }) })
    }
  })

  it('fails as a timeout when Exa does not answer, and as aborted on cancellation', async () => {
    handler = () => { /* never answers */ }
    await expect(new ExaSearchProvider(options({ timeoutMs: 50 })).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_TIMEOUT' }))
    const controller = new AbortController()
    const pending = new ExaSearchProvider(options()).search({ query: 'q' }, controller.signal)
    setTimeout(() => { controller.abort() }, 20)
    await expect(pending).rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
    controller.abort()
    await expect(new ExaSearchProvider(options()).search({ query: 'q' }, controller.signal))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })
})

describe('ExaFetchProvider', () => {
  it('calls web_fetch_exa and returns the page text', async () => {
    handler = (_body, _req, res) => { sse(res, textResult('# Example\nURL: https://example.com\n\nHello page')) }
    const result = await new ExaFetchProvider(options()).fetch({ url: 'https://example.com' })
    expect((calls[0]?.params as Record<string, unknown>)).toEqual({ name: 'web_fetch_exa', arguments: { urls: ['https://example.com'], maxCharacters: 1000 } })
    expect(result).toEqual({ url: 'https://example.com', statusCode: 200, body: { kind: 'text', content: 'Hello page' }, truncated: false })
  })

  it('flags text that reached the character limit as truncated', async () => {
    handler = (_body, _req, res) => { sse(res, textResult('abcdef')) }
    expect((await new ExaFetchProvider(options({ maxCharacters: 6 })).fetch({ url: 'https://example.com' })).truncated).toBe(true)
  })

  it('rejects a non-http URL before contacting Exa', async () => {
    await expect(new ExaFetchProvider(options()).fetch({ url: 'file:///etc/passwd' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_INVALID_URL' }))
    expect(calls).toHaveLength(0)
  })
})

describe('web-search-exa plugin', () => {
  it('registers search and fetch providers and removes them on dispose', async () => {
    handler = (body, _req, res) => {
      const tool = (body.params as { name: string }).name
      sse(res, textResult(tool === 'web_search_exa' ? SEARCH_TEXT : 'page'))
    }
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { searchProvider: 'exa', fetchProvider: 'exa' })
    const fiber = await ctx.plugin(exaPlugin, { url: base })
    expect(ctx.web.listProviders()).toMatchObject({ search: [{ id: 'exa', title: 'Exa' }], fetch: [{ id: 'exa', title: 'Exa' }] })
    expect(await ctx.web.searchReady('local')).toBe(true)
    await expect(ctx.web.search({ query: 'q', maxResults: 1 })).resolves.toMatchObject({ sources: [{ url: 'https://github.com/ggml-org/llama.cpp/releases' }], truncated: true })
    await expect(ctx.web.fetch({ url: 'https://example.com' })).resolves.toMatchObject({ body: { content: 'page' } })
    await fiber.dispose()
    expect(ctx.web.listProviders()).toEqual({ search: [], fetch: [] })
  })

  it('fails to load with an unparseable URL', async () => {
    const ctx = new Context()
    await ctx.plugin(WebRuntime, {})
    await expect(ctx.plugin(exaPlugin, { url: 'not a url' })).rejects.toThrow(/url is not a URL/)
  })

  it('has no default export', () => {
    expect('default' in exaPlugin).toBe(false)
  })
})
