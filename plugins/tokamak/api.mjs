/**
 * One Tokamak API client for every capability of this plugin: the deployment root, the key of the signed-in
 * account (then the TOKAMAK_API_KEY credential), and the plain-language refusals Tokamak answers with.
 * @module @janhq/jan-tokamak/api
 */

import { credentialRef } from '@janhq/jan-credentials'
import { launchEnvironmentOf } from '@janhq/jan-launch-environment'
import { HarnessError } from '@janhq/jan-llm'

/** The environment variable and credential the Tokamak model route reads. */
const KEY_REF = 'TOKAMAK_API_KEY'

/** Longest error text quoted from a Tokamak reply. */
const ERROR_EXCERPT_CHARS = 400

/** Plain words for the refusals a user can act on, by Tokamak error code. */
const KNOWN_REFUSALS = /** @type {Record<string, string>} */ ({
  guardrail_policy_unsupported: 'Your Tokamak organization screens prompts, and audio cannot be screened, so voice is turned off for it. An organization admin can allow unscreened voice on the guardrail policy in the Tokamak console.',
  insufficient_quota: 'Your Tokamak balance is too low for this request. Add credit in Settings > Account.',
  speech_unverified: 'Tokamak could not read this text back correctly, so it returned no audio. Try shorter or plainer text.',
})

/**
 * The API root from a configured value: a bare origin gets `/v1`, trailing slashes are dropped.
 * @param {string | undefined} configured - the plugin's `apiBaseURL`.
 * @returns {string} the root every endpoint path is appended to.
 */
export function apiRoot(configured) {
  return (configured || process.env.TOKAMAK_BASE_URL || 'https://api.tokamak.sh/v1').trim().replace(/\/+$/, '').replace(/^(https?:\/\/[^/]+)$/, '$1/v1')
}

/**
 * The message of a failed reply: a known refusal in plain words, else `{ error: { message } }`, `{ error: string }`,
 * `{ detail: { message } }`, or the raw text.
 * @param {string} what - what was asked for, as in "Tokamak speech request failed".
 * @param {number} status - HTTP status.
 * @param {string} text - reply body.
 * @returns {string} one line for the user and the model.
 */
export function replyError(what, status, text) {
  let message = text.trim()
  try {
    const body = JSON.parse(text)
    const error = body?.error ?? body?.detail
    const code = typeof error === 'object' ? error?.code ?? error?.error_type : body?.code
    if (typeof code === 'string' && KNOWN_REFUSALS[code]) return KNOWN_REFUSALS[code]
    message = typeof error === 'string' ? error : typeof error?.message === 'string' ? error.message : message
  } catch { /* not JSON: quote the text */ }
  if (status === 402) return /** @type {string} */ (KNOWN_REFUSALS.insufficient_quota)
  const excerpt = message.length > ERROR_EXCERPT_CHARS ? `${message.slice(0, ERROR_EXCERPT_CHARS)}...` : message
  return `Tokamak ${what} request failed (HTTP ${status})${excerpt ? `: ${excerpt}` : '.'}`
}

/**
 * @typedef {{ method?: string, body?: BodyInit, json?: unknown, headers?: Record<string, string>, signal?: AbortSignal, timeoutMs?: number }} RequestOptions
 * @typedef {{ root: string, request(path: string, what: string, options?: RequestOptions): Promise<Response>, keyFor(url: string): Promise<{ token: string, fromAccount: boolean }> }} TokamakApi
 */

/**
 * A client bound to one Cordis context.
 * @param {import('@janhq/cordis').Context} ctx - `tokamakAccount` and `credentials` are used when mounted.
 * @param {string | undefined} configured - the plugin's `apiBaseURL`.
 * @returns {TokamakApi} the client.
 */
export function createTokamakApi(ctx, configured) {
  const root = apiRoot(configured)

  /**
   * The key for one request: the signed-in Tokamak account first, then the TOKAMAK_API_KEY credential.
   * @param {string} url - endpoint the key is released for.
   */
  async function keyFor(url) {
    const signedIn = await ctx.get('tokamakAccount')?.resolveToken(url)
    if (signedIn) return { token: signedIn, fromAccount: true }
    const credentials = ctx.get('credentials')
    const ref = credentialRef(KEY_REF)
    const value = (credentials === undefined ? launchEnvironmentOf(ctx).get(ref)?.value : (await credentials.resolve(ref))?.value)?.trim()
    if (value) return { token: value, fromAccount: false }
    throw new HarnessError('This needs a Tokamak account. Sign in to Tokamak in Settings > Account.', 'TOKAMAK_NO_KEY')
  }

  /**
   * Send one request and return the successful reply; a failure throws a {@link HarnessError} in plain words.
   * A 401 on the account's key signs the account out, as web search does.
   * @param {string} path - endpoint path under the root, such as `/audio/speech`.
   * @param {string} what - the capability named in an error.
   * @param {RequestOptions} [options] - method, body and limits.
   * @returns {Promise<Response>} the 2xx reply, body unread.
   */
  async function request(path, what, options = {}) {
    const url = `${root}${path}`
    const { token, fromAccount } = await keyFor(url)
    const signals = [AbortSignal.timeout(options.timeoutMs ?? 60_000), ...options.signal ? [options.signal] : []]
    const reply = await fetch(url, {
      method: options.method ?? 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        ...options.json === undefined ? {} : { 'content-type': 'application/json' },
        ...options.headers,
      },
      body: options.json === undefined ? options.body : JSON.stringify(options.json),
      signal: AbortSignal.any(signals),
    })
    if (reply.ok) return reply
    const text = await reply.text()
    if (reply.status === 401 && fromAccount) {
      await ctx.get('tokamakAccount')?.rejectToken(token)
      throw new HarnessError('Tokamak rejected the signed-in account (HTTP 401). Sign in to Tokamak again.', 'TOKAMAK_UNAUTHORIZED')
    }
    throw new HarnessError(replyError(what, reply.status, text), 'TOKAMAK_REQUEST_FAILED')
  }

  return { root, request, keyFor }
}
