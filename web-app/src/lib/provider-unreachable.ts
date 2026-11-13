import { localNetworkHint } from '@/lib/local-network'
import { isMac } from '@/lib/shortcuts/platform'

/**
 * Map a transport-level fetch failure (no HTTP response — DNS, connect, TLS,
 * timeout, dropped connection) to an actionable message. `@tauri-apps/plugin-http`
 * rethrows reqwest's raw "error sending request for url …" string, which isn't
 * useful to users. Returns null when `err` is not a recognised transport error.
 */
export function describeTransportError(err: unknown): string | null {
  const raw = err instanceof Error ? err.message : String(err)
  if (typeof raw !== 'string' || !raw) return null
  const m = raw.toLowerCase()

  const isTransport =
    /error sending request/.test(m) ||
    /error trying to connect/.test(m) ||
    /failed to fetch|networkerror|load failed/.test(m) ||
    /connection (refused|reset|closed|aborted)/.test(m) ||
    /connection error|broken pipe/.test(m) ||
    /dns error|failed to lookup|name resolution/.test(m) ||
    /(operation|request|connection) timed out|timeout/.test(m) ||
    /tls|certificate|ssl|handshake/.test(m) ||
    /unreachable/.test(m)
  if (!isTransport) return null

  if (/dns error|failed to lookup|name resolution|unreachable/.test(m)) {
    return "Couldn't reach the provider — the address could not be resolved. Check the provider's Base URL and your internet connection."
  }
  if (/timed out|timeout/.test(m)) {
    return 'The provider took too long to respond and the request timed out. It may be overloaded or slow to start — try again.'
  }
  if (/tls|certificate|ssl|handshake/.test(m)) {
    return "Couldn't establish a secure connection to the provider (TLS/certificate error). Verify the endpoint URL."
  }
  return "Couldn't reach the provider — the connection failed. Check the provider's Base URL and your internet connection, then try again."
}

/**
 * A provider request that never got an HTTP response: DNS, connect, TLS or
 * timeout. The message is already written for the user (what failed, the URL,
 * and on macOS the Local Network hint), so it can be shown as it is. HTTP
 * status errors (401, 403, 404) are not this type and keep their own wording.
 */
export class ProviderUnreachableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProviderUnreachableError'
  }
}

/**
 * The unreachable error for a request to `url` that rejected with `error`, or
 * null when `error` is not a transport failure. Call it on what the fetch
 * itself rejected with, never on an error built from a response status: those
 * can contain words such as "failed to fetch" without being a connection
 * failure.
 */
export function toProviderUnreachable(
  error: unknown,
  url: string
): ProviderUnreachableError | null {
  const friendly = describeTransportError(error)
  if (!friendly) return null
  const hint = localNetworkHint(url, isMac)
  return new ProviderUnreachableError(
    `${friendly} (${url})${hint ? ` ${hint}` : ''}`
  )
}

/**
 * `fetchImpl`, with a transport failure rethrown as a `ProviderUnreachableError`
 * naming the URL. Responses, including HTTP error statuses, pass through.
 */
export function withUnreachableErrors(
  fetchImpl: typeof fetch
): typeof fetch {
  return async (input, init) => {
    try {
      return await fetchImpl(input, init)
    } catch (error) {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url
      throw toProviderUnreachable(error, url) ?? error
    }
  }
}

/**
 * The text for a failed model-list refresh: the unreachable message when that
 * is what happened, otherwise the generic localized `fallback`.
 */
export function refreshFailureText(error: unknown, fallback: string): string {
  return error instanceof ProviderUnreachableError ? error.message : fallback
}
