/**
 * The way out to the internet for a Jan that Hosts started on a computer without one. A loopback
 * HTTP proxy on this computer accepts `CONNECT host:port` tunnels and plain `http://` requests;
 * `ssh -R` makes it reachable at 127.0.0.1 on the other computer, where the remote Jan's
 * HTTPS_PROXY points. Only requests that carry this relay's random password are served, because
 * every local user on the other computer can open that forwarded port. The TLS of a CONNECT tunnel
 * stays end to end between the remote Jan and the provider; the relay sees only host names.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, request as httpRequest } from 'node:http'
import { connect } from 'node:net'

const USER = 'jan'

/**
 * Whether a `Proxy-Authorization` header carries this relay's credential.
 * @param {string | undefined} header - the request header.
 * @param {string} password - the relay's password.
 * @returns {boolean} true only for `Basic base64(jan:password)`.
 */
export function authorized(header, password) {
  const match = /^Basic\s+(\S+)$/i.exec(String(header ?? ''))
  if (!match) return false
  const given = Buffer.from(match[1], 'base64')
  const expected = Buffer.from(`${USER}:${password}`)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

/**
 * Split a CONNECT target into host and port, refusing anything but `host:port`.
 * @param {string} target - the request line target.
 * @returns {{ host: string, port: number } | undefined} the parts, or undefined when malformed.
 */
export function connectTarget(target) {
  const match = /^(\[[0-9a-fA-F:]+\]|[A-Za-z0-9.-]+):(\d{1,5})$/.exec(String(target))
  if (!match) return undefined
  const port = Number(match[2])
  if (port < 1 || port > 65535) return undefined
  return { host: match[1].replace(/^\[|\]$/g, ''), port }
}

/**
 * Start the relay on a free loopback port.
 * @returns {Promise<{ port: number, password: string, proxyUrl: (port: number) => string, close: () => Promise<void> }>}
 * the listener and the proxy URL the remote Jan uses once ssh forwards a remote port to it.
 */
export async function startRelay() {
  const password = randomBytes(24).toString('base64url')
  const sockets = new Set()
  const refuse = (socket) => {
    socket.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="jan"\r\nContent-Length: 0\r\nConnection: close\r\n\r\n')
  }
  const server = createServer((req, res) => {
    // A plain http:// request through the proxy names the absolute URL in its request line.
    if (!authorized(req.headers['proxy-authorization'], password)) {
      res.writeHead(407, { 'proxy-authenticate': 'Basic realm="jan"', 'content-length': '0', connection: 'close' }).end()
      return
    }
    let url
    try { url = new URL(req.url) } catch { res.writeHead(400).end(); return }
    if (url.protocol !== 'http:') { res.writeHead(400).end(); return }
    const headers = { ...req.headers }
    delete headers['proxy-authorization']
    delete headers['proxy-connection']
    const upstream = httpRequest(url, { method: req.method, headers }, (answer) => {
      res.writeHead(answer.statusCode ?? 502, answer.headers)
      answer.pipe(res)
    })
    upstream.once('error', () => { if (!res.headersSent) res.writeHead(502).end(); else res.destroy() })
    req.pipe(upstream)
  })
  server.on('connect', (req, client, head) => {
    sockets.add(client)
    client.once('close', () => sockets.delete(client))
    client.on('error', () => {})
    if (!authorized(req.headers['proxy-authorization'], password)) { refuse(client); return }
    const target = connectTarget(req.url)
    if (target === undefined) { client.end('HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n'); return }
    const upstream = connect(target.port, target.host)
    sockets.add(upstream)
    upstream.once('close', () => sockets.delete(upstream))
    upstream.once('connect', () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      if (head.length > 0) upstream.write(head)
      upstream.pipe(client)
      client.pipe(upstream)
    })
    upstream.once('error', () => {
      if (client.writable) client.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n')
    })
    client.once('close', () => upstream.destroy())
  })
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
  })
  const { promise, resolve, reject } = Promise.withResolvers()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', resolve)
  await promise
  const { port } = server.address()
  return {
    port,
    password,
    proxyUrl: remotePort => `http://${USER}:${password}@127.0.0.1:${remotePort}`,
    async close() {
      const closed = Promise.withResolvers()
      server.close(() => closed.resolve())
      for (const socket of sockets) socket.destroy()
      await closed.promise
    },
  }
}
