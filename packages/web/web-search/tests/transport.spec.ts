import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { callMcpTool, clipChars, parseRpcReply, postJson } from '../src/transport.ts'
import { json, sse, startLoopback, toolText } from './loopback.ts'
import type { Loopback } from './loopback.ts'

let loopback: Loopback

beforeEach(async () => { loopback = await startLoopback() })
afterEach(async () => { await loopback.close() })

function call(timeoutMs = 5000): Parameters<typeof callMcpTool>[0] {
  return { provider: 'P', url: `${loopback.base}/mcp`, tool: 't', arguments: {}, timeoutMs }
}

describe('MCP reply parsing', () => {
  it('reads a reply from plain JSON and from SSE, skipping notification and non-JSON frames', () => {
    expect(parseRpcReply('P', '{"result":{"content":[]}}')).toMatchObject({ result: { content: [] } })
    const stream = [
      ': ping', '', 'event: message', 'data: not-json',
      `data: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/message', params: { data: 'searching' } })}`,
      'data: {"error":{"message":"bad"}}', '',
    ].join('\n')
    expect(parseRpcReply('P', stream)).toMatchObject({ error: { message: 'bad' } })
    expect(() => parseRpcReply('P', 'event: message\n\n')).toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })

  it('rejects a malformed reply frame', () => {
    expect(() => parseRpcReply('P', '{"result":{"content":"text"}}')).toThrow(/P returned an unexpected reply/)
  })
})

describe('callMcpTool', () => {
  it('sends the MCP accept header and joins text content', async () => {
    loopback.handler = (_request, res) => { sse(res, { result: { content: [{ type: 'text', text: 'a' }, { type: 'image' }, { type: 'text', text: 'b' }] } }) }
    await expect(callMcpTool(call())).resolves.toBe('a\n\nb')
    expect(loopback.calls[0]?.headers.accept).toBe('application/json, text/event-stream')
    expect(loopback.calls[0]?.headers['content-type']).toBe('application/json')
  })

  it('reports JSON-RPC, tool, rate-limit, and HTTP errors', async () => {
    loopback.handler = (_request, res) => { json(res, { error: { message: 'nope' } }) }
    await expect(callMcpTool(call())).rejects.toThrow('P error: nope')
    loopback.handler = (_request, res) => { json(res, { error: { code: -32000 } }) }
    await expect(callMcpTool(call())).rejects.toThrow('P error: unknown')
    loopback.handler = (_request, res) => { json(res, { result: { isError: true, content: [{ type: 'text' }] } }) }
    await expect(callMcpTool(call())).rejects.toThrow('P error: unknown')
    loopback.handler = (_request, res) => { sse(res, { result: { isError: true, content: [{ type: 'text', text: 'bad query' }] } }) }
    await expect(callMcpTool(call())).rejects.toThrow('P error: bad query')
    loopback.handler = (_request, res) => { sse(res, toolText('limited', { rateLimited: true })) }
    await expect(callMcpTool(call())).rejects.toThrow(/P rate-limited this request/)
    loopback.handler = (_request, res) => { sse(res, toolText('fine', { 'ai.exa/rateLimited': false })) }
    await expect(callMcpTool(call())).resolves.toBe('fine')
    loopback.handler = (_request, res) => { res.writeHead(503).end('down') }
    await expect(callMcpTool(call())).rejects.toThrow('P request failed (HTTP 503): down')
    loopback.handler = (_request, res) => { res.writeHead(500).end() }
    await expect(callMcpTool(call())).rejects.toThrow(/^P request failed \(HTTP 500\)$/)
  })
})

describe('postJson', () => {
  it('reads a reply without a body as empty text', async () => {
    loopback.handler = (_request, res) => { res.writeHead(204).end() }
    await expect(postJson({ provider: 'P', url: loopback.base, body: {}, timeoutMs: 5000 })).resolves.toEqual({ status: 204, body: '' })
  })

  it('refuses an oversized reply', async () => {
    loopback.handler = (_request, res) => { res.writeHead(200).end(Buffer.alloc(5 * 1024 * 1024, 32)) }
    await expect(postJson({ provider: 'P', url: loopback.base, body: {}, timeoutMs: 5000 })).rejects.toThrow('P returned an oversized reply')
  })

  it('fails as a timeout when the endpoint does not answer, and as aborted on cancellation', async () => {
    loopback.handler = () => { /* never answers */ }
    await expect(postJson({ provider: 'P', url: loopback.base, body: {}, timeoutMs: 50 }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_TIMEOUT', message: 'P did not answer within 50 ms' }))
    const controller = new AbortController()
    const pending = postJson({ provider: 'P', url: loopback.base, body: {}, timeoutMs: 5000 }, controller.signal)
    setTimeout(() => { controller.abort() }, 20)
    await expect(pending).rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
    await expect(postJson({ provider: 'P', url: loopback.base, body: {}, timeoutMs: 5000 }, controller.signal))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })

  it('reports a connection failure as a provider error', async () => {
    const closed = await startLoopback()
    const url = closed.base
    await closed.close()
    await expect(postJson({ provider: 'P', url, body: {}, timeoutMs: 5000 })).rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })
})

describe('clipChars', () => {
  it('cuts to the bound without splitting a surrogate pair', () => {
    expect(clipChars('abc', 5)).toBe('abc')
    expect(clipChars('abcdef', 3)).toBe('abc')
    expect(clipChars('a😀b', 2)).toBe('a')
  })
})
