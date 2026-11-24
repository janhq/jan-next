import { once } from 'node:events'
import { createServer } from 'node:http'

const CALLBACKS = new Map([
  ['claude', '/anthropic/callback'], ['codex', '/codex/callback'], ['antigravity', '/antigravity/callback'],
])

/** Bind the redirect declared by CLIProxyAPI without its wildcard callback forwarder. */
export async function openCallback(provider, authorize, state, session) {
  const target = CALLBACKS.get(provider)
  if (!target) return undefined
  const redirect = new URL(authorize.searchParams.get('redirect_uri'))
  if (redirect.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(redirect.hostname)
    || redirect.username || redirect.password || !redirect.port) throw new Error('Invalid CLIProxyAPI redirect')
  const servers = []
  const close = () => {
    for (const server of servers) { server.close(); server.closeAllConnections() }
  }
  const receive = (request, response) => {
    const callback = new URL(request.url, redirect.origin)
    if (request.method !== 'GET' || callback.pathname !== redirect.pathname
      || callback.searchParams.get('state') !== state
      || (!callback.searchParams.has('code') && !callback.searchParams.has('error'))) {
      response.writeHead(404).end()
      return
    }
    // This is the same loopback-only hand-off the upstream UI uses. The upstream
    // callback checks the state again and renders its own browser completion page.
    const destination = new URL(target, session.origin)
    for (const key of ['state', 'code', 'error', 'error_description']) {
      if (callback.searchParams.has(key)) destination.searchParams.set(key, callback.searchParams.get(key))
    }
    response.writeHead(302, { location: destination.href, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' }).end()
  }
  try {
    for (const host of redirect.hostname === 'localhost' ? ['127.0.0.1', '::1'] : ['127.0.0.1']) {
      const server = createServer({ requestTimeout: 5000, headersTimeout: 5000 }, receive)
      servers.push(server)
      try { await once(server.listen({ host, port: Number(redirect.port) }), 'listening') }
      catch (error) {
        if (host !== '::1' || !['EAFNOSUPPORT', 'EADDRNOTAVAIL'].includes(error.code)) throw error
      }
    }
    return close
  } catch (error) {
    close()
    throw error
  }
}
