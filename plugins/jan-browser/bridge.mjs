import { randomUUID } from 'node:crypto'
import { EventEmitter, once } from 'node:events'
import { createServer } from 'node:http'
import { WebSocket, WebSocketServer } from 'ws'

const HOST = '127.0.0.1'
const EXTENSION_ID = 'mkciifcjehgnpaigoiaakdgabbpfppal'
const EXTENSION_ORIGIN = `chrome-extension://${EXTENSION_ID}`
const PING_INTERVAL_MS = 15_000
const HANDSHAKE_TIMEOUT_MS = 5_000
const MAX_RESULT_BYTES = 24 * 1024 * 1024

/** Chrome Web Store listing for the published extension accepted by the bridge. */
export const INSTALL_URL = `https://chromewebstore.google.com/detail/jan-browser-mcp/${EXTENSION_ID}`

/**
 * Owns the loopback listener, Chrome profile selection, and one in-flight call per connection.
 * Loopback restricts reachability; the Origin check filters browser origins, not local processes.
 * A local peer can supply the allowed Origin and any profile ID. The ready frame is not authentication.
 * The published extension has no Jan-controlled channel for receiving a pairing secret.
 */
export class JanBrowserBridge {
  /** @type {Map<string, Profile>} */
  #profiles = new Map()
  /** @type {string | null} */
  #activeId = null
  #change = new EventEmitter()
  #lifetime = new AbortController()
  /** @type {Promise<void> | undefined} */
  #listening
  /** @type {Promise<void> | undefined} */
  #closing
  /** @type {import('node:http').Server | undefined} */
  #http
  /** @type {WebSocketServer | undefined} */
  #ws

  /** @param {{ port: number, connectTimeoutMs: number, callTimeoutMs: number }} config - local listener and tool budgets. */
  constructor(config) {
    this.config = config
  }

  /** @returns {number | undefined} The actual bound port, if listening. */
  get port() {
    const address = this.#http?.address()
    return address && typeof address === 'object' ? address.port : undefined
  }

  /** @returns {Promise<void>} Resolves when HTTP probes and WebSocket upgrades can be accepted. */
  listen() {
    this.#lifetime.signal.throwIfAborted()
    return this.#listening ??= this.#start().catch(error => {
      this.#listening = undefined
      throw error
    })
  }

  async #start() {
    const ws = new WebSocketServer({ noServer: true, maxPayload: MAX_RESULT_BYTES })
    const http = createServer((request, response) => {
      response.writeHead(request.method === 'HEAD' ? 204 : 404).end()
    })
    http.on('upgrade', (request, socket, head) => {
      const query = request.url?.startsWith('/?') ? new URLSearchParams(request.url.slice(2)) : undefined
      const id = query?.get('pid')
      if (this.#lifetime.signal.aborted || request.headers.origin !== EXTENSION_ORIGIN || !id || id.length > 128) {
        socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
        return
      }
      const label = query?.get('pl')?.trim().slice(0, 120) || `Profile ${id.slice(0, 8)}`
      ws.handleUpgrade(request, socket, head, connection => this.#connect(connection, id, label))
    })
    this.#http = http
    this.#ws = ws
    try {
      const listening = once(http, 'listening')
      http.listen(this.config.port, HOST)
      await listening
    } catch (cause) {
      ws.close()
      this.#http = undefined
      this.#ws = undefined
      throw new Error(`Jan Browser could not listen on ${HOST}:${this.config.port}. Quit any old Jan Browser MCP server, or select an unused port in the Jan Browser plugin and in Chrome.`, { cause })
    }
  }

  /** @param {AbortSignal} signal - caller cancellation. @returns {Promise<Profile>} The selected, handshake-ready connection. */
  async waitForProfile(signal) {
    const deadline = AbortSignal.timeout(this.config.connectTimeoutMs)
    const waiting = AbortSignal.any([signal, deadline, this.#lifetime.signal])
    try {
      while (true) {
        waiting.throwIfAborted()
        const selected = this.#activeId === null ? undefined : this.#profiles.get(this.#activeId)
        if (selected?.ready && selected.socket.readyState === WebSocket.OPEN) return selected
        await once(this.#change, 'profile', { signal: waiting })
      }
    } catch (error) {
      signal.throwIfAborted()
      this.#lifetime.signal.throwIfAborted()
      if (!deadline.aborted) throw error
      throw new Error(`Jan Browser is not connected. Install or enable Jan Browser MCP in Chrome (${INSTALL_URL}), then open its toolbar popup and click Connect on port ${this.port}. Try the tool again after it says Connected.`)
    }
  }

  /** @param {Profile} profile - exact connection selected for this Session. @returns {boolean} Whether it is still selected and usable. */
  isSelected(profile) {
    return profile.ready && this.#activeId === profile.id && this.#profiles.get(profile.id) === profile && profile.socket.readyState === WebSocket.OPEN
  }

  /**
   * Dispatch once. A canceled caller stops waiting, but Chrome receives no cancellation frame;
   * later calls cannot overtake the unresolved operation on that connection.
   * @param {Profile} profile - selected connection for this Session.
   * @param {string} tool - extension's wire method name.
   * @param {Record<string, unknown>} params - wire arguments.
   * @param {AbortSignal} signal - caller cancellation.
   * @returns {Promise<{content: unknown[], isError?: boolean}>} Extension content for the native tool adapter.
   */
  call(profile, tool, params, signal) {
    signal.throwIfAborted()
    this.#lifetime.signal.throwIfAborted()
    if (!this.isSelected(profile)) {
      throw new Error(`The selected Jan Browser connection changed or disconnected. Open the extension (${INSTALL_URL}), check the intended profile, click Connect, and start a new Jan Session before continuing.`)
    }
    if (profile.pending !== undefined) throw new Error('A Jan Browser action is still running. Inspect Chrome before continuing.')
    const id = randomUUID()
    return new Promise((resolve, reject) => {
      const aborted = () => reject(signal.reason)
      const timeout = setTimeout(() => {
        profile.socket.terminate()
        finish(new Error('Jan Browser did not report the outcome in time. The action may have run; inspect Chrome before trying again.'))
      }, this.config.callTimeoutMs)
      /** @type {Pending['finish']} */
      const finish = (error, result) => {
        profile.pending = undefined
        clearTimeout(timeout)
        signal.removeEventListener('abort', aborted)
        if (error !== undefined) reject(error)
        else if (result !== undefined) resolve(result)
      }
      profile.pending = { id, finish }
      signal.addEventListener('abort', aborted, { once: true })
      profile.socket.send(JSON.stringify({ kind: 'call', id, tool, params }), error => {
        if (error && profile.pending?.id === id) finish(new Error('Jan Browser lost its connection while sending the action. Inspect Chrome before trying again.', { cause: error }))
      })
    })
  }

  /** @returns {Promise<void>} Stops admission, disconnects only the bridge, and waits for its listeners to close. */
  dispose() {
    return this.#closing ??= this.#dispose()
  }

  async #dispose() {
    this.#lifetime.abort(new Error('Jan Browser is disabled or shutting down.'))
    try { await this.#listening } catch { /* Startup failure already closed the WebSocket server. */ }
    const http = this.#http
    const ws = this.#ws
    if (http === undefined || ws === undefined) return
    for (const socket of ws.clients) socket.terminate()
    await Promise.all([
      new Promise(resolve => ws.close(resolve)),
      new Promise(resolve => {
        http.close(resolve)
        http.closeAllConnections()
      }),
    ])
  }

  /** @param {WebSocket} socket @param {string} id @param {string} label */
  #connect(socket, id, label) {
    const previous = this.#profiles.get(id)
    if (previous?.pending) {
      socket.close(1008, 'Existing profile has an action in progress')
      return
    }
    previous?.socket.terminate()
    /** @type {Profile} */
    const profile = { id, label, socket, ready: false, pending: undefined, alive: true }
    this.#profiles.set(id, profile)
    this.#activeId ??= id
    const handshake = setTimeout(() => socket.terminate(), HANDSHAKE_TIMEOUT_MS)
    const heartbeat = setInterval(() => {
      if (!profile.alive) return socket.terminate()
      profile.alive = false
      socket.send('{"kind":"ping"}')
    }, PING_INTERVAL_MS)
    socket.on('error', () => socket.terminate())
    socket.once('close', () => {
      clearTimeout(handshake)
      clearInterval(heartbeat)
      profile.pending?.finish(new Error(`Jan Browser disconnected before reporting the outcome. Inspect Chrome, then reconnect the extension (${INSTALL_URL}) before continuing.`))
      if (this.#profiles.get(id) !== profile) return
      this.#profiles.delete(id)
      if (this.#activeId === id) this.#activeId = this.#profiles.keys().next().value ?? null
      this.#publish()
    })
    socket.on('message', (data, binary) => {
      if (binary || this.#profiles.get(id) !== profile) return
      /** @type {Record<string, unknown>} */
      let message
      try { message = JSON.parse(data.toString()) } catch { return }
      if (!message || typeof message !== 'object') return
      if (message.kind === 'pong') {
        profile.alive = true
        return
      }
      if (message.kind === 'ready' && message.profileId === id && !profile.ready) {
        clearTimeout(handshake)
        profile.ready = true
        this.#publish()
        return
      }
      if (!profile.ready) return
      if (message.kind === 'activate_profile' && message.profileId === id) {
        this.#activeId = id
        this.#publish()
        return
      }
      const pending = profile.pending
      if (pending === undefined || message.kind !== 'result' || message.id !== pending.id) return
      if (!this.isSelected(profile)) {
        pending.finish(new Error('Chrome profiles changed while Jan Browser was working. Inspect the previously selected profile before continuing.'))
      } else if (message.ok === false || message.isError === true) {
        const text = Array.isArray(message.content) ? message.content.find(block => block?.type === 'text' && typeof block.text === 'string')?.text : undefined
        pending.finish(new Error(typeof message.error === 'string' ? message.error : (text || 'The extension refused the action. Check the selected Chrome tab.')))
      } else if (message.ok !== true || !Array.isArray(message.content) || message.content.length === 0) {
        pending.finish(new Error('Jan Browser returned an invalid result. Inspect Chrome before trying again.'))
      } else {
        pending.finish(undefined, { content: message.content })
      }
    })
    socket.send(JSON.stringify({ kind: 'hello', serverVersion: '0.14.4', ...this.#profileState() }))
  }

  #profileState() {
    return {
      activeProfileId: this.#activeId,
      profileCount: this.#profiles.size,
      profiles: Array.from(this.#profiles.values(), ({ id, label, ready }) => ({ id, label, ready })),
    }
  }

  #publish() {
    const payload = JSON.stringify({ kind: 'profile_state', ...this.#profileState() })
    for (const profile of this.#profiles.values()) {
      if (profile.socket.readyState === WebSocket.OPEN) profile.socket.send(payload)
    }
    this.#change.emit('profile')
  }
}

/** @typedef {{id: string, label: string, socket: WebSocket, ready: boolean, alive: boolean, pending?: Pending | undefined}} Profile */
/** @typedef {{id: string, finish: (error?: Error, result?: {content: unknown[], isError?: boolean}) => void}} Pending */
