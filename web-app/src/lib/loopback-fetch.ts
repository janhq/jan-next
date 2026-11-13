import { fetch as httpFetch } from '@tauri-apps/plugin-http'

/**
 * Requests to the local engine server, sent so that no proxy can
 * capture them.
 *
 * `@tauri-apps/plugin-http` sends from Rust's reqwest, which reads
 * `HTTP(S)_PROXY` and the OS proxy setting (on Windows, the registry one) and
 * does not exempt loopback unless `NO_PROXY` names it. With a VPN client, a
 * proxy tool or a corporate proxy configured, the chat request to
 * `http://localhost:<port>` is then sent to that proxy and fails, although the
 * server is up. Naming any proxy turns reqwest's environment and system lookup
 * off, and the no-proxy list covers every loopback host, so the placeholder
 * address is never dialled: these requests always go direct.
 *
 * Only for loopback servers: any URL whose host is not localhost, 127.0.0.1
 * or [::1] is rejected before it is sent, since the bypass would otherwise
 * route a remote request around the user's proxy. 0.0.0.0 is refused too:
 * it is a listen address, and no caller dials it. Remote providers keep the
 * runtime fetch. Built-in engines get this as `ctx.internal.loopbackFetch`.
 */
/** `fetch` for the engine on loopback; `connectTimeout` is in milliseconds. */
export type LoopbackFetch = (
  input: string | URL | Request,
  init?: RequestInit & { connectTimeout?: number }
) => Promise<Response>

export const LOOPBACK_DIRECT_PROXY = {
  all: { url: 'http://127.0.0.1:9', noProxy: 'localhost,127.0.0.1,::1' },
}

// URL.hostname keeps the brackets on an IPv6 literal.
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

export const isLoopbackUrl = (href: string): boolean => {
  try {
    return LOOPBACK_HOSTS.has(new URL(href).hostname)
  } catch {
    return false
  }
}

export const loopbackFetch: LoopbackFetch = async (input, init) => {
  const href = input instanceof Request ? input.url : String(input)
  if (!isLoopbackUrl(href))
    throw new Error(
      `loopbackFetch only reaches localhost, 127.0.0.1 or [::1], not ${href}`
    )
  return httpFetch(input, { ...init, proxy: LOOPBACK_DIRECT_PROXY })
}
