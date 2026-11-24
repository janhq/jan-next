/**
 * Tokamak CLI sign-in wire protocol, ported from Jan's `device_auth.rs` / `tokamak.rs`.
 *
 * Flow: create a session with a PKCE challenge, send the user to the web approval page with the
 * short user code, poll the token endpoint with the verifier until the server answers
 * approved/denied/expired, and receive a long-lived `sk_live_*` API key. The loopback `redirect`
 * on the approval page is only a wake-up ping for the poller; no secret ever travels through it.
 */
import { z } from 'zod'
import type { SignInErrorCode } from './types.ts'

/** Production inference/router API, OpenAI-compatible. */
export const DEFAULT_BASE_URL = 'https://api.tokamak.sh/v1'
/** Device sign-in session endpoint, relative to the API origin. */
export const SESSIONS_PATH = '/auth/cli/sessions'
/** Session lifetime when the server does not advertise one. */
export const DEFAULT_EXPIRES_IN_SECONDS = 600
/** Poll interval when the server does not advertise one. */
export const DEFAULT_INTERVAL_SECONDS = 5
/** Lower bound for the poll interval. */
export const MIN_INTERVAL_SECONDS = 1
/** Upper bound for the poll interval. */
export const MAX_INTERVAL_SECONDS = 30
const BODY_LIMIT = 65_536

/** Errors expose a stable code; response bodies and keys never reach the message. */
export class TokamakAuthError extends Error {
  /** @param code - safe classification rendered by the UI. @param detail - Host-only diagnostic. */
  constructor(readonly code: SignInErrorCode, readonly detail?: string) { super(`tokamak-account: ${code}`) }
}

/** The deployment has no CLI session routes (HTTP 404/405); the user must paste a key instead. */
export class TokamakUnsupportedError extends TokamakAuthError {
  constructor() { super('protocol', 'device sign-in unsupported by this deployment') }
}

/**
 * Normalize a configured API base URL: a bare host gets `/v1`, trailing slashes are dropped.
 * @param value - configured or environment-supplied URL.
 * @param allowLoopbackHttp - permit `http:` on loopback hosts for local mocks.
 * @returns normalized base URL such as `https://api.tokamak.sh/v1`.
 */
export function normalizeBaseUrl(value: string, allowLoopbackHttp: boolean): string {
  const url = new URL(value.trim())
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.username || url.password || url.search || url.hash
    || !(url.protocol === 'https:' || (allowLoopbackHttp && loopback && url.protocol === 'http:'))) {
    throw new Error('tokamak-account: apiBaseURL must be an HTTPS URL (or loopback HTTP when allowLoopbackHttp is set)')
  }
  const path = url.pathname.replace(/\/+$/, '')
  return `${url.origin}${path === '' ? '/v1' : path}`
}

/**
 * Derive the API origin that the auth routes hang off (not `/v1`).
 * @param baseUrl - normalized API base.
 * @returns its origin.
 */
export function apiRoot(baseUrl: string): string {
  return new URL(baseUrl).origin
}

/**
 * Derive the web app origin: `api.tokamak.sh` → `tokamak.sh`, `api-stag.tokamak.sh` → `stag.tokamak.sh`.
 * @param baseUrl - normalized API base.
 * @param override - explicit web origin (config or `TOKAMAK_WEB_URL`); wins when non-empty.
 * @returns web origin without trailing slash.
 */
export function webRoot(baseUrl: string, override?: string): string {
  const explicit = override?.trim().replace(/\/+$/, '')
  if (explicit) return new URL(explicit).origin
  const url = new URL(baseUrl)
  const host = url.hostname
  const stripped = host.startsWith('api.') ? host.slice(4) : host.startsWith('api-') ? host.slice(4) : host
  if (stripped !== '') url.hostname = stripped
  return url.origin
}

/**
 * Build the approval page URL the user opens.
 * @param web - web origin from {@link webRoot}.
 * @param userCode - code the user confirms on the page.
 * @param wake - optional loopback wake endpoint and its state guard.
 * @returns the approval page URL.
 */
export function buildAuthorizeUrl(web: string, userCode: string, wake?: { redirect: string; state: string }): string {
  const url = new URL('/cli/authorize', web)
  url.searchParams.set('code', userCode)
  if (wake !== undefined) {
    url.searchParams.set('redirect', wake.redirect)
    url.searchParams.set('state', wake.state)
  }
  return url.href
}

/**
 * Locate the page where users mint keys by hand.
 * @param web - web origin.
 * @returns that page's URL.
 */
export function apiKeysUrl(web: string): string {
  return new URL('/settings/api-keys', web).href
}

/**
 * Clamp the server-advertised poll interval.
 * @param seconds - server-advertised interval.
 * @returns the interval clamped to 1–30 s, default 5 s.
 */
export function clampInterval(seconds: unknown): number {
  const value = typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0 ? seconds : DEFAULT_INTERVAL_SECONDS
  return Math.min(MAX_INTERVAL_SECONDS, Math.max(MIN_INTERVAL_SECONDS, value))
}

/**
 * Classify a poll HTTP status: 408, 425, 429 and 5xx are reachability blips, so polling continues.
 * @param status - HTTP status of a poll response.
 * @returns whether the poll should be retried.
 */
export function pollStatusIsTransient(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || (status >= 500 && status <= 599)
}

const sessionPayload = z.object({
  session_id: z.string().min(1),
  user_code: z.string().min(1),
  expires_in: z.number().positive().optional(),
  interval: z.number().optional(),
})
/** A started device session. */
export interface DeviceSession {
  readonly sessionId: string
  readonly userCode: string
  readonly expiresInSeconds: number
  readonly intervalSeconds: number
}

const pollPayload = z.object({
  status: z.string().optional(),
  interval: z.number().optional(),
  api_key: z.object({ key: z.string(), id: z.string().nullish(), expires_at: z.string().nullish() }).nullish(),
  user: z.object({ email: z.string().nullish(), name: z.string().nullish() }).nullish(),
})
/** The key minted for this client on approval. */
export interface Minted {
  readonly key: string
  readonly keyId?: string
  /** Unix milliseconds. */
  readonly expiresAt?: number
  readonly account?: string
}
/** One poll outcome; transient failures are reported as `retry` rather than thrown. */
export type PollResult =
  | { readonly status: 'pending'; readonly intervalSeconds: number }
  | { readonly status: 'approved'; readonly minted: Minted }
  | { readonly status: 'denied' | 'expired' }
  | { readonly status: 'retry'; readonly detail: string }

/**
 * Create a sign-in session; no auth header.
 * @param root - API origin.
 * @param challenge - PKCE S256 code challenge.
 * @param clientName - name shown on the approval page.
 * @param signal - cancellation.
 * @returns the session id, user code, lifetime and poll interval.
 * @throws TokamakUnsupportedError on 404/405, TokamakAuthError otherwise.
 */
export async function beginSession(root: string, challenge: string, clientName: string, signal: AbortSignal): Promise<DeviceSession> {
  const { status, payload } = await postJson(`${root}${SESSIONS_PATH}`, { code_challenge: challenge, client_name: clientName }, signal)
  if (status === 404 || status === 405) throw new TokamakUnsupportedError()
  if (status < 200 || status >= 300) throw new TokamakAuthError('network', `session create failed with HTTP ${status}`)
  const parsed = sessionPayload.safeParse(payload)
  if (!parsed.success) throw new TokamakAuthError('protocol', 'session create returned an invalid body')
  return {
    sessionId: parsed.data.session_id,
    userCode: parsed.data.user_code,
    expiresInSeconds: parsed.data.expires_in ?? DEFAULT_EXPIRES_IN_SECONDS,
    intervalSeconds: clampInterval(parsed.data.interval),
  }
}

/**
 * Poll the token endpoint once.
 * @param root - API origin.
 * @param sessionId - session from {@link beginSession}.
 * @param verifier - PKCE code verifier.
 * @param cancel - caller cancellation; the only abort that rethrows.
 * @param timeoutMs - per-request timeout; a timeout is a retry.
 * @returns the classified outcome; terminal HTTP failures throw.
 */
export async function pollOnce(root: string, sessionId: string, verifier: string,
  cancel: AbortSignal, timeoutMs: number): Promise<PollResult> {
  let response: { status: number; payload: unknown }
  try {
    response = await postJson(`${root}${SESSIONS_PATH}/token`, { session_id: sessionId, code_verifier: verifier },
      AbortSignal.any([cancel, AbortSignal.timeout(timeoutMs)]))
  } catch (error) {
    // Only real cancellation ends the attempt; an unreachable or hung tick is transient, since
    // the user may have just approved and the key is live server-side.
    if (cancel.aborted) throw error
    return { status: 'retry', detail: 'no response' }
  }
  if (response.status < 200 || response.status >= 300) {
    if (pollStatusIsTransient(response.status)) return { status: 'retry', detail: `HTTP ${response.status}` }
    throw new TokamakAuthError(response.status === 401 || response.status === 403 ? 'expired' : 'network',
      `poll failed with HTTP ${response.status}`)
  }
  const parsed = pollPayload.safeParse(response.payload)
  if (!parsed.success) return { status: 'retry', detail: 'invalid poll body' }
  const body = parsed.data
  switch (body.status) {
    case 'approved': {
      // Approved without a key is a malformed body, not a verdict: the next poll should carry it.
      if (!body.api_key?.key) return { status: 'retry', detail: 'approved without an API key' }
      const expiresAt = body.api_key.expires_at ? Date.parse(body.api_key.expires_at) : Number.NaN
      const account = body.user?.email || body.user?.name || undefined
      return {
        status: 'approved',
        minted: {
          key: body.api_key.key,
          ...body.api_key.id ? { keyId: body.api_key.id } : {},
          ...Number.isFinite(expiresAt) ? { expiresAt } : {},
          ...account ? { account } : {},
        },
      }
    }
    case 'denied': return { status: 'denied' }
    case 'expired': return { status: 'expired' }
    // Unknown statuses are not terminal: a newer server may add intermediate states.
    default: return { status: 'pending', intervalSeconds: clampInterval(body.interval) }
  }
}

/**
 * Confirm a key works before storing it.
 * @param baseUrl - normalized API base (`…/v1`).
 * @param key - API key to check.
 * @param signal - cancellation.
 * @returns model ids the key can use.
 * @throws TokamakAuthError('expired') when rejected, ('network') on other failures.
 */
export async function verifyKey(baseUrl: string, key: string, signal: AbortSignal): Promise<string[]> {
  let response: Response
  try {
    response = await fetch(`${baseUrl}/models`, { headers: { authorization: `Bearer ${key}` }, redirect: 'error', signal })
  } catch { throw new TokamakAuthError('no-response', 'model listing unreachable') }
  if (response.status === 401 || response.status === 403) {
    await response.body?.cancel()
    throw new TokamakAuthError('expired', `key rejected with HTTP ${response.status}`)
  }
  if (!response.ok) {
    await response.body?.cancel()
    throw new TokamakAuthError('network', `model listing failed with HTTP ${response.status}`)
  }
  try { return modelIds(await readBounded(response)) } catch (error) {
    // A body that times out or is malformed is a transport problem, not a key rejection.
    throw error instanceof TokamakAuthError ? error : new TokamakAuthError('no-response', 'model listing body unreadable')
  }
}

/**
 * Read model ids from a listing: `{data:[{id}]}`, a bare array of objects, or an array of strings, like Jan does.
 * @param payload - parsed listing body.
 * @returns the model ids, empty for an unknown shape.
 */
export function modelIds(payload: unknown): string[] {
  const list: unknown = Array.isArray(payload) ? payload
    : typeof payload === 'object' && payload !== null && Array.isArray((payload as { data?: unknown }).data)
      ? (payload as { data: unknown[] }).data : []
  if (!Array.isArray(list)) return []
  const ids: string[] = []
  for (const entry of list) {
    if (typeof entry === 'string') ids.push(entry)
    else if (typeof entry === 'object' && entry !== null && typeof (entry as { id?: unknown }).id === 'string') {
      ids.push((entry as { id: string }).id)
    }
  }
  return ids
}

/**
 * Best-effort server-side revocation, authenticated with the key itself.
 * @param root - API origin.
 * @param keyId - id of the key to revoke.
 * @param key - the key itself, used as the Bearer credential.
 * @param signal - cancellation.
 * @returns whether the server confirmed it.
 */
export async function revokeKey(root: string, keyId: string, key: string, signal: AbortSignal): Promise<boolean> {
  try {
    const response = await fetch(`${root}/auth/api-keys/${encodeURIComponent(keyId)}`, {
      method: 'DELETE', headers: { authorization: `Bearer ${key}` }, redirect: 'error', signal,
    })
    await response.body?.cancel()
    return response.ok
  } catch { return false }
}

async function postJson(url: string, body: unknown, signal: AbortSignal): Promise<{ status: number; payload: unknown }> {
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body), redirect: 'error', signal,
    })
  } catch {
    const reason: unknown = signal.reason
    // Caller cancellation propagates as-is; a request timeout is just "no response".
    if (signal.aborted && !(reason instanceof Error && reason.name === 'TimeoutError')) throw reason
    throw new TokamakAuthError('no-response', `${new URL(url).pathname} unreachable`)
  }
  let payload: unknown
  try { payload = await readBounded(response) } catch { payload = undefined }
  return { status: response.status, payload }
}

async function readBounded(response: Response): Promise<unknown> {
  if (response.body === null) return undefined
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      size += next.value.byteLength
      if (size > BODY_LIMIT) throw new TokamakAuthError('protocol', 'response body too large')
      chunks.push(next.value)
    }
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.trim() === '') return undefined
  try { return JSON.parse(text) } catch { throw new TokamakAuthError('protocol', 'response body is not JSON') }
}
