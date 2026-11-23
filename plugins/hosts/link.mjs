/**
 * One signed-in connection from this Host to another Jan: unary calls over its `/api` HTTP
 * channel and logical streams over its `api/remote.mux` WebSocket, speaking the same wire
 * protocol a browser page does. The login token never leaves this process.
 */
import { randomUUID } from 'node:crypto'
import WebSocket from 'ws'

/** Socket reconnect delays while the link lives, in milliseconds; the last repeats. */
const BACKOFF_MS = [1_000, 2_000, 5_000, 10_000]

/** A failure the remote Host answered, kept in wire form so it can be passed on unchanged. */
export class LinkRemoteError extends Error {
  constructor(error) {
    super(error.message)
    this.name = 'LinkRemoteError'
    this.wire = { code: error.code, message: error.message, details: error.details ?? {} }
  }
}

/**
 * @param {{ root: string, token: string, onState?: (state: 'connecting' | 'live' | 'lost') => void }} options
 *   `root` is the remote Jan's base URL (a tunnel's loopback root); `token` its login token.
 */
export function createHostLink({ root, token, onState = () => { } }) {
  const base = new URL(root)
  let cookie
  let login
  let socket
  let socketReady
  let closed = false
  let attempt = 0
  let state = 'connecting'
  const streams = new Map()

  const setState = (next) => {
    if (state === next) return
    state = next
    onState(next)
  }

  async function signIn() {
    const connect = new URL('connect', base)
    connect.searchParams.set('token', token)
    // `answer`: the other Jan's approval and question requests come here and on to this window.
    connect.searchParams.set('interactions', 'answer')
    // `local`: the other Jan answers with its own projects and chats only. It may federate this
    // one too, and forwarding these calls back would echo lists and streams between the two.
    connect.searchParams.set('forward', 'local')
    const response = await fetch(connect, { redirect: 'manual' })
    const value = response.headers.get('set-cookie')?.split(';')[0]
    if (response.status !== 302 || value === undefined) throw new Error(`The other Jan refused the sign-in (HTTP ${response.status}).`)
    cookie = value
  }

  function signedIn() {
    login ??= signIn().catch((error) => { login = undefined; throw error })
    return login
  }

  function headers() {
    return { cookie, host: base.host, origin: base.origin }
  }

  /**
   * Call one unary endpoint and return the remote's wire result (`{ ok, value }` or `{ ok, error }`).
   * @param {string} endpoint - `namespace/method`.
   * @param {unknown} payload - `{ args }`.
   * @param {AbortSignal} [signal]
   */
  async function callWire(endpoint, payload, signal) {
    await signedIn()
    const send = () => fetch(new URL(`api/${endpoint}`, base), {
      method: 'POST', headers: { ...headers(), 'content-type': 'application/json' }, signal,
      body: JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method: endpoint, payload }),
    })
    let response = await send()
    if (response.status === 401) {
      // The other Jan restarted its sign-in store; one fresh login retries the call.
      login = undefined
      await signedIn()
      response = await send()
    }
    if (!response.ok) throw new Error(`The other Jan answered HTTP ${response.status} for ${endpoint}.`)
    const type = response.headers.get('content-type') ?? ''
    if (type.startsWith('multipart/form-data')) return decodeBinary(await response.formData())
    return (await response.json()).result
  }

  /**
   * Call one unary endpoint with named args and return its value.
   * @throws {LinkRemoteError} when the remote answers a failure.
   */
  async function call(endpoint, args, signal) {
    const result = await callWire(endpoint, { args }, signal)
    if (!result.ok) throw new LinkRemoteError(result.error)
    return result.value
  }

  function connectSocket() {
    if (socketReady !== undefined) return socketReady
    socketReady = (async () => {
      await signedIn()
      const url = new URL('api/remote.mux', base)
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
      const next = new WebSocket(url, { headers: headers() })
      await new Promise((resolve, reject) => {
        next.once('open', resolve)
        next.once('unexpected-response', (_request, response) => {
          if (response.statusCode === 401) login = undefined
          reject(new Error(`The other Jan refused its live connection (HTTP ${response.statusCode}).`))
        })
        next.once('error', reject)
      })
      next.on('message', (data) => {
        let message
        try { message = JSON.parse(String(data)) } catch { return }
        // Any valid JSON parses, `null` included; only an object can name a stream.
        if (message === null || typeof message !== 'object') return
        streams.get(message.streamId)?.(message)
      })
      next.on('close', () => {
        if (socket === next) socket = undefined
        socketReady = undefined
        for (const deliver of [...streams.values()]) deliver({ type: 'carrier-lost' })
        if (!closed) { setState('lost'); scheduleReconnect() }
      })
      next.on('error', () => { })
      socket = next
      attempt = 0
      setState('live')
      return next
    })().catch((error) => {
      socketReady = undefined
      if (!closed) { setState('lost'); scheduleReconnect() }
      throw error
    })
    return socketReady
  }

  let retryTimer
  function scheduleReconnect() {
    if (closed || retryTimer !== undefined) return
    const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]
    attempt++
    retryTimer = setTimeout(() => {
      retryTimer = undefined
      connectSocket().catch(() => { })
    }, delay)
  }

  /**
   * Open one logical stream; yields the remote's wire items. Ends, or throws the remote's
   * failure (`LinkRemoteError`) or a carrier loss (plain `Error` named `RemoteStreamCarrierError`).
   */
  async function* stream(endpoint, payload, signal) {
    if (signal?.aborted) return
    const carrier = await connectSocket()
    if (signal?.aborted) return
    const streamId = randomUUID()
    const queue = []
    let wake
    streams.set(streamId, (message) => { queue.push(message); wake?.() })
    const abort = () => { wake?.() }
    signal?.addEventListener('abort', abort, { once: true })
    let terminal = false
    try {
      carrier.send(JSON.stringify({ type: 'open', streamId, endpoint, payload }))
      while (!signal?.aborted) {
        while (queue.length === 0 && !signal?.aborted) await new Promise((resolve) => { wake = resolve })
        wake = undefined
        if (signal?.aborted) return
        const message = queue.shift()
        if (message.type === 'item') { yield message.value; continue }
        terminal = true
        if (message.type === 'end') return
        if (message.type === 'error') throw new LinkRemoteError(message.error)
        const lost = new Error('The live connection to the other Jan dropped.')
        lost.name = 'RemoteStreamCarrierError'
        throw lost
      }
    } finally {
      signal?.removeEventListener('abort', abort)
      streams.delete(streamId)
      if (!terminal && carrier.readyState === WebSocket.OPEN) carrier.send(JSON.stringify({ type: 'cancel', streamId }))
    }
  }

  return {
    get state() { return state },
    /** Sign in and open the live connection; rejects when the first attempt fails. */
    open: () => connectSocket().then(() => undefined),
    call,
    callWire,
    stream,
    close() {
      closed = true
      clearTimeout(retryTimer)
      socket?.close(1000, 'disconnected')
      socket = undefined
    },
  }
}

/** Rebuild a multipart (binary) RPC answer into the plain wire result with attachments. */
async function decodeBinary(form) {
  const metadata = JSON.parse(String(form.get('metadata')))
  const attachments = []
  for (const attachment of metadata.attachments ?? []) {
    const blob = form.get(attachment.part)
    attachments.push({ path: attachment.path, bytes: new Uint8Array(await blob.arrayBuffer()) })
  }
  return { ...metadata.result, attachments }
}
