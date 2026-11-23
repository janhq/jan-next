const ORIGIN = 'https://backend.composio.dev'
const SESSION_ENDPOINT = `${ORIGIN}/api/v3.1/tool_router/session`

const invalidResponse = () => composioError('composio-invalid-response')

/** Validate both newly provisioned and saved endpoints before sending a project key. */
export function composioMcpUrl(value) {
  if (typeof value !== 'string' || value.includes('${')) throw invalidResponse()
  let url
  try { url = new URL(value) } catch { throw invalidResponse() }
  if (url.origin !== ORIGIN || url.protocol !== 'https:' || url.username || url.password || /[?#]/.test(url.href)) throw invalidResponse()
  return url.href
}

/** Provision a session for an opaque Jan user ID without exposing provider error text. */
export async function createComposioSession(apiKey, userId, { fetch = globalThis.fetch } = {}) {
  let response
  const signal = AbortSignal.timeout(15_000)
  try {
    response = await fetch(SESSION_ENDPOINT, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify({ user_id: userId }), redirect: 'error', signal,
    })
  } catch { throw composioError('composio-unavailable') }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {})
    if (response.status === 401) throw composioError('composio-invalid-key')
    if (response.status === 403) throw composioError('composio-permissions')
    throw composioError('composio-unavailable')
  }
  let body
  try { body = await response.json() } catch {
    throw signal.aborted ? composioError('composio-unavailable') : invalidResponse()
  }
  if (typeof body?.session_id !== 'string' || !body.session_id.trim() || body.mcp?.type !== 'http') throw invalidResponse()
  return { sessionId: body.session_id, url: composioMcpUrl(body.mcp.url) }
}

// Jan's plugin API serializes Error.message. Keep it a stable code the UI can translate.
function composioError(code) {
  return Object.assign(new Error(code), { code })
}
