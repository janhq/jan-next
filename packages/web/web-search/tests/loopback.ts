/** Loopback HTTP stand-in for the provider endpoints, recording each request. */

import { createServer, type IncomingHttpHeaders, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { resolve } from '../src/config.ts'
import type { Config, SearxngSpec, Spec } from '../src/config.ts'
import { Config as ConfigSchema } from '../src/config.ts'
import type { KeyLookup } from '../src/credentials.ts'

/** One request the stand-in received. */
export interface Recorded {
  readonly path: string
  readonly headers: IncomingHttpHeaders
  readonly body: Record<string, unknown>
}

type Handler = (request: Recorded, res: ServerResponse) => void

/** A running stand-in; `handler` answers every request until replaced. */
export interface Loopback {
  readonly base: string
  readonly calls: Recorded[]
  handler: Handler
  close(): Promise<void>
}

/**
 * Start a stand-in on an OS-assigned loopback port.
 * @returns the running stand-in.
 */
export async function startLoopback(): Promise<Loopback> {
  const calls: Recorded[] = []
  const state: { handler: Handler } = { handler: (_request, res) => { res.writeHead(500).end() } }
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => { chunks.push(chunk) })
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8')
      const parsed: unknown = text.length === 0 ? {} : JSON.parse(text)
      const body = typeof parsed === 'object' && parsed !== null ? Object.fromEntries(Object.entries(parsed)) : {}
      const request: Recorded = { path: req.url ?? '', headers: req.headers, body }
      calls.push(request)
      state.handler(request, res)
    })
  })
  await new Promise<void>((done) => { server.listen(0, '127.0.0.1', done) })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('loopback server has no port')
  return {
    base: `http://127.0.0.1:${String((address satisfies AddressInfo).port)}`,
    calls,
    get handler() { return state.handler },
    set handler(next: Handler) { state.handler = next },
    async close() {
      server.closeAllConnections()
      await new Promise<void>((done) => { server.close(() => { done() }) })
    },
  }
}

/**
 * Answer with a JSON body.
 * @param res - the response.
 * @param payload - the body.
 * @param status - the HTTP status.
 */
export function json(res: ServerResponse, payload: unknown, status = 200): void {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(payload))
}

/**
 * Answer with a single-message SSE stream.
 * @param res - the response.
 * @param frames - the `data:` payloads, in order.
 */
export function sse(res: ServerResponse, ...frames: unknown[]): void {
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  res.end(frames.map(frame => `event: message\ndata: ${JSON.stringify(frame)}\n\n`).join(''))
}

/**
 * An MCP `tools/call` reply carrying text content.
 * @param text - the tool's text.
 * @param meta - optional `_meta`.
 * @returns the JSON-RPC reply.
 */
export function toolText(text: string, meta?: Record<string, unknown>): unknown {
  return { jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text }], ...meta === undefined ? {} : { _meta: meta } } }
}

/**
 * Resolved specs whose every endpoint points at the stand-in.
 * @param base - the stand-in's origin.
 * @param overrides - extra config fields.
 * @returns the resolved spec; `searxng` is always present.
 */
export function specsFor(base: string, overrides: Partial<Config> = {}): Spec & { searxng: SearxngSpec } {
  const spec = resolve(ConfigSchema({
    exa: { mcpUrl: `${base}/exa/mcp`, apiUrl: `${base}/exa` },
    tavily: { apiUrl: `${base}/tavily` },
    searxng: { url: `${base}/searx/` },
    you: { mcpUrl: `${base}/you/mcp`, extractUrl: `${base}/you/extract`, apiUrl: `${base}/you` },
    maxCharacters: 1000,
    timeoutMs: 5000,
    ...overrides,
  }))
  const { searxng } = spec
  if (searxng === undefined) throw new Error('fixture spec has no searxng')
  return { ...spec, searxng }
}

/**
 * A lookup answering a fixed key, or none.
 * @param key - the key, or undefined for keyless.
 * @returns the lookup.
 */
export function fixedKey(key: string | undefined): KeyLookup {
  return async () => key
}
