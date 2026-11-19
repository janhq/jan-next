/**
 * HTTP and MCP transport shared by every backend: one JSON POST or GET per operation with a
 * deadline, caller cancellation, and a reply-size cap, plus the MCP `tools/call` reply reader for
 * hosted keyless endpoints.
 * @module @janhq/jan-web-search/transport
 */

import { WebError } from '@janhq/jan-web'
import z from '@janhq/schemastery'

/** Largest reply body read; provider replies are tens of kilobytes. */
export const MAX_REPLY_BYTES = 4 * 1024 * 1024

/** Longest provider reply excerpt quoted in an error message. */
const ERROR_EXCERPT_CHARS = 400

/** One JSON POST to a provider endpoint. */
export interface PostRequest {
  /** Display name of the provider, used in every error message. */
  readonly provider: string
  /** Absolute endpoint URL. */
  readonly url: string
  /** JSON request body. */
  readonly body: unknown
  /** Extra request headers; `content-type: application/json` is always sent. */
  readonly headers?: Readonly<Record<string, string>>
  /** Milliseconds the request and reply read may take together. */
  readonly timeoutMs: number
}

/** One GET to an unauthenticated provider endpoint. */
export interface GetRequest {
  /** Display name of the provider, used in every error message. */
  readonly provider: string
  /** Absolute endpoint URL, query included. */
  readonly url: string
  /** Milliseconds the request and reply read may take together. */
  readonly timeoutMs: number
}

/** A completed HTTP exchange; non-2xx statuses are returned, not thrown. */
export interface HttpReply {
  readonly status: number
  readonly body: string
}

/**
 * Send one JSON POST. Redirects fail instead of being followed, so a credential or query never
 * reaches a second origin.
 * @param request - endpoint, body, headers, and deadline.
 * @param signal - caller cancellation.
 * @returns the status and body text.
 * @throws {@link WebError} `WEB_ABORTED` on cancellation, `WEB_PROVIDER_TIMEOUT` past the deadline,
 * `WEB_PROVIDER_ERROR` for transport failures, redirects, and replies over {@link MAX_REPLY_BYTES}.
 */
export async function postJson(request: PostRequest, signal?: AbortSignal): Promise<HttpReply> {
  return await exchange(request.provider, request.url, request.timeoutMs, {
    method: 'POST',
    redirect: 'error',
    headers: { ...request.headers, 'content-type': 'application/json' },
    body: JSON.stringify(request.body),
  }, signal)
}

/**
 * Send one GET that carries no credential, following redirects as a browser would.
 * @param request - endpoint and deadline.
 * @param signal - caller cancellation.
 * @returns the status and body text.
 * @throws {@link WebError} as {@link postJson} does, except that redirects are followed.
 */
export async function getJson(request: GetRequest, signal?: AbortSignal): Promise<HttpReply> {
  return await exchange(request.provider, request.url, request.timeoutMs, {
    method: 'GET',
    redirect: 'follow',
    headers: { accept: 'application/json' },
  }, signal)
}

async function exchange(provider: string, url: string, timeoutMs: number, init: RequestInit, signal?: AbortSignal): Promise<HttpReply> {
  if (signal?.aborted === true) throw aborted(provider, signal)
  const timeout = AbortSignal.timeout(timeoutMs)
  const combined = signal === undefined ? timeout : AbortSignal.any([signal, timeout])
  try {
    const response = await fetch(url, { ...init, signal: combined })
    return { status: response.status, body: await readCapped(provider, response) }
  } catch (error: unknown) {
    if (signal !== undefined && isAborted(signal)) throw aborted(provider, signal)
    if (timeout.aborted) {
      throw new WebError(`${provider} did not answer within ${String(timeoutMs)} ms`, 'WEB_PROVIDER_TIMEOUT', { cause: error })
    }
    if (error instanceof WebError) throw error
    throw new WebError(`${provider} request failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
  }
}

/**
 * Fail a non-2xx reply with a message naming the next step: a refused credential names its
 * reference, and a throttled call asks for a later retry.
 * @param provider - display name of the provider.
 * @param reply - the completed exchange.
 * @param credential - the credential reference the request authenticated with, if any.
 * @throws {@link WebError} `WEB_PROVIDER_ERROR` unless the status is 2xx.
 */
export function assertOk(provider: string, reply: HttpReply, credential?: string): void {
  if (reply.status >= 200 && reply.status < 300) return
  const excerpt = clipChars(reply.body.trim(), ERROR_EXCERPT_CHARS)
  const detail = excerpt.length === 0 ? '' : `: ${excerpt}`
  if ((reply.status === 401 || reply.status === 403) && credential !== undefined) {
    throw new WebError(
      `${provider} rejected the API key in ${credential} (HTTP ${String(reply.status)}); replace or unset it${detail}`,
      'WEB_PROVIDER_ERROR',
    )
  }
  if (reply.status === 429) {
    throw new WebError(`${provider} rate-limited this request (HTTP 429); wait a minute and try again${detail}`, 'WEB_PROVIDER_ERROR')
  }
  throw new WebError(`${provider} request failed (HTTP ${String(reply.status)})${detail}`, 'WEB_PROVIDER_ERROR')
}

/**
 * Parse a 2xx reply body as JSON and validate it.
 * @param provider - display name of the provider.
 * @param body - the reply text.
 * @param schema - the validator for the expected fields.
 * @param hint - the next step appended to a failure message, when there is one.
 * @returns the validated value.
 * @throws {@link WebError} `WEB_PROVIDER_ERROR` for invalid JSON or unexpected fields.
 */
export function parseJson<T>(provider: string, body: string, schema: z<T>, hint?: string): T {
  const suffix = hint === undefined ? '' : `; ${hint}`
  let parsed: Parameters<typeof schema>[0]
  // oxlint-disable-next-line typescript/no-unsafe-assignment -- validated by `schema` below; it types only its input.
  try { parsed = JSON.parse(body) }
  catch (error: unknown) { throw new WebError(`${provider} returned invalid JSON${suffix}`, 'WEB_PROVIDER_ERROR', { cause: error }) }
  try { return schema(parsed) }
  catch (error: unknown) {
    throw new WebError(`${provider} returned an unexpected reply: ${String(error)}${suffix}`, 'WEB_PROVIDER_ERROR', { cause: error })
  }
}

/** One MCP `tools/call` request. */
export interface McpToolCall {
  /** Display name of the provider, used in every error message. */
  readonly provider: string
  /** The MCP endpoint. */
  readonly url: string
  /** Tool name. */
  readonly tool: string
  /** Tool arguments. */
  readonly arguments: Readonly<Record<string, unknown>>
  /** Extra request headers. */
  readonly headers?: Readonly<Record<string, string>>
  /** Milliseconds the call may take. */
  readonly timeoutMs: number
}

interface ToolCallResult {
  content: { type: string; text?: string }[]
  isError?: boolean
  _meta: Record<string, unknown>
}

/** One JSON-RPC reply frame carrying `result` or `error`; an absent `result` reads as empty. */
export interface RpcReply {
  result: ToolCallResult
  error?: { code?: number; message?: string }
}

const RpcReply: z<RpcReply> = z.object({
  result: z.object({
    content: z.array(z.object({ type: z.string().required(), text: z.string() })).default([]),
    isError: z.boolean(),
    _meta: z.dict(z.any()),
  }),
  // A one-member union keeps an absent `error` absent; schemastery materializes a bare object as `{}`.
  error: z.union([z.object({ code: z.number(), message: z.string() })]),
})

/**
 * Pull the JSON-RPC reply out of a response body, which is either the JSON object itself or an
 * SSE stream whose `data:` frames carry it. Frames without `result` or `error`, such as progress
 * notifications, are skipped.
 * @param provider - display name of the provider.
 * @param body - the response text.
 * @returns the first frame carrying `result` or `error`.
 * @throws {@link WebError} `WEB_PROVIDER_ERROR` when no frame carries either, or the frame is malformed.
 */
export function parseRpcReply(provider: string, body: string): RpcReply {
  const candidates = body.trimStart().startsWith('{')
    ? [body]
    : body.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trim())
  for (const candidate of candidates) {
    let parsed: unknown
    try { parsed = JSON.parse(candidate) }
    catch (_notJson) { continue /* A keep-alive or non-JSON frame carries no reply. */ }
    if (typeof parsed === 'object' && parsed !== null && ('result' in parsed || 'error' in parsed)) {
      return parseJson(provider, candidate, RpcReply)
    }
  }
  throw new WebError(`${provider} returned no JSON-RPC reply`, 'WEB_PROVIDER_ERROR')
}

/**
 * Whether a tool result carries a vendor rate-limit flag in `_meta`, such as `ai.exa/rateLimited`.
 * @param result - the tool result.
 * @returns true for a `rateLimited` key, bare or vendor-namespaced, set to `true`.
 */
function isRateLimited(result: ToolCallResult): boolean {
  return Object.entries(result._meta).some(([key, value]) => (key === 'rateLimited' || key.endsWith('/rateLimited')) && value === true)
}

/**
 * Call one MCP tool on a stateless hosted endpoint and return its text content.
 * @param call - endpoint, tool, arguments, and deadline.
 * @param signal - caller cancellation.
 * @returns the concatenated text content of the reply.
 * @throws {@link WebError} as {@link postJson} does, and `WEB_PROVIDER_ERROR` for HTTP, JSON-RPC,
 * tool, and rate-limit failures. A throttled hosted endpoint answers HTTP 200 with a `_meta` flag;
 * without the check it would read as no results.
 */
export async function callMcpTool(call: McpToolCall, signal?: AbortSignal): Promise<string> {
  const reply = await postJson({
    provider: call.provider,
    url: call.url,
    headers: { ...call.headers, accept: 'application/json, text/event-stream' },
    body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: call.tool, arguments: call.arguments } },
    timeoutMs: call.timeoutMs,
  }, signal)
  assertOk(call.provider, reply)
  const rpc = parseRpcReply(call.provider, reply.body)
  if (rpc.error !== undefined) throw new WebError(`${call.provider} error: ${rpc.error.message ?? 'unknown'}`, 'WEB_PROVIDER_ERROR')
  const { result } = rpc
  if (isRateLimited(result)) {
    throw new WebError(`${call.provider} rate-limited this request; wait a minute and try again, or configure an API key`, 'WEB_PROVIDER_ERROR')
  }
  const text = result.content.map(part => (part.type === 'text' ? part.text ?? '' : '')).join('\n')
  if (result.isError === true) throw new WebError(`${call.provider} error: ${text.length > 0 ? text : 'unknown'}`, 'WEB_PROVIDER_ERROR')
  return text
}

/**
 * Cut a string to at most `max` UTF-16 code units without splitting a surrogate pair.
 * @param text - the text to cut.
 * @param max - the largest length kept.
 * @returns the text, or its prefix when longer.
 */
export function clipChars(text: string, max: number): string {
  if (text.length <= max) return text
  const end = /[\uD800-\uDBFF]/.test(text.charAt(max - 1)) ? max - 1 : max
  return text.slice(0, end)
}

/**
 * Read a response body as text, refusing one larger than {@link MAX_REPLY_BYTES}.
 * @param provider - display name of the provider.
 * @param response - the HTTP response.
 * @returns the body text.
 * @throws {@link WebError} `WEB_PROVIDER_ERROR` for an oversized body.
 */
async function readCapped(provider: string, response: Response): Promise<string> {
  if (response.body === null) return ''
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of response.body) {
    size += chunk.byteLength
    if (size > MAX_REPLY_BYTES) {
      await response.body.cancel().catch((_cancelFailure: unknown) => undefined /* The oversized error below is the outcome. */)
      throw new WebError(`${provider} returned an oversized reply`, 'WEB_PROVIDER_ERROR')
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** Read `signal.aborted` after an await, where control-flow narrowing from the entry check no longer holds. */
function isAborted(signal: AbortSignal): boolean {
  return signal.aborted
}

function aborted(provider: string, signal: AbortSignal): WebError {
  return new WebError(`${provider} request aborted`, 'WEB_ABORTED', { cause: signal.reason })
}
