// Signing in to a remote MCP server the way Cursor and Claude do: the server answers 401 with an
// OAuth challenge, Jan registers itself with the server's authorization server, opens the sign-in
// page in the browser, and receives the result on a one-time loopback address. The tokens are kept
// as a credential and turned into an Authorization header each time the server starts.

import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { auth, discoverOAuthServerInfo, refreshAuthorization } from '@modelcontextprotocol/client'

const SIGN_IN_TIMEOUT_MS = 10 * 60_000
// A token this close to expiry is refreshed before the server starts.
const REFRESH_MARGIN_MS = 2 * 60_000

const errorsIn = error => {
  const chain = []
  for (let current = error; current instanceof Error && chain.length < 8; current = current.cause) chain.push(current)
  return chain
}

/** Whether a failed start was the server asking for sign-in (HTTP 401 or an OAuth challenge). */
export function needsSignIn(error) {
  return errorsIn(error).some(item => item.status === 401 || item.name === 'UnauthorizedError'
    || /\b401\b|unauthori[sz]ed/i.test(item.message))
}

/** The innermost failure message, short enough for a settings row. */
export function failureReason(error) {
  const chain = errorsIn(error)
  const inner = chain.at(-1)
  if (!inner) return String(error).slice(0, 240)
  const text = inner.message.replace(/^mcp-client\([^)]*\):\s*/, '').split('\n')[0].trim()
  if (inner.code === 'ENOENT') return `Jan could not find the command${inner.path ? ` "${inner.path}"` : ''}. Check that it is installed.`
  if (/ECONNREFUSED|ENOTFOUND|fetch failed/i.test(text)) return `Jan could not reach the server (${text}). Check the address and your connection.`
  return text.slice(0, 240) || 'The server closed the connection.'
}

export const hostOf = url => { try { return new URL(url).host } catch { return url } }

/**
 * Tokens for a saved sign-in, refreshed when they are about to expire.
 * @param {string} serverUrl
 * @param {{ client?: object, tokens?: object, expiresAt?: number } | undefined} saved
 * @param {(next: object) => Promise<void>} save - persists a refreshed record.
 * @returns {Promise<{ accessToken: string, expiresAt?: number, refreshable: boolean } | undefined>} undefined when there is no usable sign-in.
 */
export async function signedInTokens(serverUrl, saved, save, now = Date.now()) {
  if (!saved?.tokens?.access_token) return undefined
  const { expiresAt } = saved
  const refreshable = Boolean(saved.tokens.refresh_token && saved.client)
  if (expiresAt === undefined || expiresAt - now > REFRESH_MARGIN_MS || (!refreshable && expiresAt > now)) {
    return { accessToken: saved.tokens.access_token, expiresAt, refreshable }
  }
  if (!refreshable) return undefined
  const info = await discoverOAuthServerInfo(serverUrl)
  const tokens = await refreshAuthorization(info.authorizationServerUrl, {
    metadata: info.authorizationServerMetadata, clientInformation: saved.client,
    refreshToken: saved.tokens.refresh_token, resource: info.resourceMetadata?.resource,
  })
  const record = { ...saved }
  providerFor(serverUrl, record, { interactive: false }).saveTokens(tokens)
  await save(record)
  return { accessToken: record.tokens.access_token, expiresAt: record.expiresAt, refreshable }
}

function providerFor(serverUrl, record, { interactive, redirectUrl, state, onRedirect }) {
  let verifier
  let discovery
  return {
    get redirectUrl() { return redirectUrl },
    get clientMetadata() {
      return {
        client_name: 'Jan', client_uri: 'https://jan.ai',
        redirect_uris: redirectUrl ? [redirectUrl] : [],
        grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'],
        token_endpoint_auth_method: 'none',
      }
    },
    state: () => state,
    clientInformation: () => record.client,
    saveClientInformation: (client) => { record.client = client },
    tokens: () => record.tokens,
    saveTokens: (tokens) => {
      const refreshToken = tokens.refresh_token ?? record.tokens?.refresh_token
      record.tokens = { ...tokens, ...(refreshToken === undefined ? {} : { refresh_token: refreshToken }) }
      if (typeof tokens.expires_in === 'number') record.expiresAt = Date.now() + tokens.expires_in * 1000
      else delete record.expiresAt
    },
    redirectToAuthorization: (url) => {
      if (!interactive) throw new Error('Sign in again to keep using this server.')
      onRedirect(url)
    },
    saveCodeVerifier: (value) => { verifier = value },
    codeVerifier: () => verifier,
    saveDiscoveryState: (value) => { discovery = value },
    discoveryState: () => discovery,
    invalidateCredentials: (scope) => {
      if (scope === 'all' || scope === 'tokens') { delete record.tokens; delete record.expiresAt }
      if (scope === 'all' || scope === 'client') delete record.client
    },
  }
}

/** A sentence for a sign-in that could not start, naming what the person can do instead. */
export function signInFailure(serverUrl, error) {
  const host = hostOf(serverUrl)
  const chain = errorsIn(error)
  const text = chain.map(item => item.message).join(' ')
  if (chain.some(item => /Registration/i.test(item.name)) || /regist/i.test(text) && /\b40[13]\b|forbidden/i.test(text)) {
    return `${host} only lets apps it has approved sign in, and it has not approved Jan yet. Use an access token instead.`
  }
  if (/does not support|no authorization server|metadata/i.test(text)) return `${host} does not offer a sign-in page Jan can use. Use an access token instead.`
  return `Signing in to ${host} failed: ${failureReason(error)}`
}

/**
 * Start signing in: registers Jan, opens a loopback callback and returns the sign-in page.
 * @param {string} serverUrl
 * @param {(record: object) => Promise<void>} onSignedIn - receives the tokens once the browser returns.
 * @returns {Promise<{ url: string, done: Promise<void>, cancel: () => void }>}
 */
export async function beginSignIn(serverUrl, onSignedIn) {
  const state = randomBytes(24).toString('base64url')
  const callback = Promise.withResolvers()
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (url.pathname !== '/callback') { response.writeHead(404).end(); return }
    const ok = url.searchParams.get('state') === state && url.searchParams.has('code')
    const denied = url.searchParams.get('error_description') ?? url.searchParams.get('error')
    response.writeHead(ok ? 200 : 400, { 'content-type': 'text/html; charset=utf-8' }).end(page(ok
      ? ['Signed in', `Jan is connecting to ${hostOf(serverUrl)}. You can close this tab and go back to Jan.`]
      : ['Sign-in did not finish', denied ? `${denied}. Go back to Jan and try again.` : 'Go back to Jan and try again.']))
    if (ok) callback.resolve({ code: url.searchParams.get('code'), iss: url.searchParams.get('iss') ?? undefined })
    else callback.reject(new Error(denied ?? 'The sign-in page returned without a code.'))
  })
  const listening = Promise.withResolvers()
  server.once('error', listening.reject)
  server.listen(0, '127.0.0.1', listening.resolve)
  await listening.promise
  const redirectUrl = `http://127.0.0.1:${server.address().port}/callback`
  const close = () => { server.close(); server.closeAllConnections?.() }
  const record = {}
  let authorizationUrl
  const provider = providerFor(serverUrl, record, { interactive: true, redirectUrl, state, onRedirect: (url) => { authorizationUrl = url } })
  try {
    const first = await auth(provider, { serverUrl })
    if (first === 'AUTHORIZED') { close(); await onSignedIn(record); return { url: undefined, done: Promise.resolve(), cancel: () => {} } }
  } catch (error) { close(); throw error }
  if (!authorizationUrl) { close(); throw new Error('The server did not return a sign-in page.') }
  const timer = setTimeout(() => callback.reject(new Error('Sign-in timed out. Try again.')), SIGN_IN_TIMEOUT_MS)
  const done = callback.promise.then(async ({ code, iss }) => {
    await auth(provider, { serverUrl, authorizationCode: code, iss })
    if (!record.tokens?.access_token) throw new Error('The server did not return an access token.')
    await onSignedIn(record)
  }).finally(() => { clearTimeout(timer); close() })
  return { url: authorizationUrl.href, done, cancel: () => callback.reject(new Error('Sign-in cancelled.')) }
}

const escape = text => text.replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char])
const page = ([title, body]) => `<!doctype html><meta charset="utf-8"><title>${escape(title)} - Jan</title>
<style>body{font:16px/1.5 -apple-system,system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;margin:0;color:#222;background:#fafafa}
main{max-width:420px;padding:32px;text-align:center}h1{font-size:22px;font-weight:600;margin:0 0 8px}p{margin:0;color:#666}
@media(prefers-color-scheme:dark){body{background:#161616;color:#eee}p{color:#aaa}}</style>
<main><h1>${escape(title)}</h1><p>${escape(body)}</p></main>`
