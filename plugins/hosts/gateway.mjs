/**
 * The device gateway: a second listener on a LAN address that forwards to this Host's loopback
 * listener. The Host itself never leaves loopback. Every request must carry a paired device's
 * own cookie, so removing one device cuts it off at once, including its open live connection,
 * without signing out the desktop or other devices. The owner login the gateway adds upstream
 * never reaches the device.
 */
import { createServer, request as httpRequest } from 'node:http'
import { createServer as createHttpsServer, request as httpsRequest } from 'node:https'
import { BlockList, connect, isIP, isIPv6 } from 'node:net'
import { connect as tlsConnect } from 'node:tls'
import { networkInterfaces } from 'node:os'
import { randomBytes } from 'node:crypto'
import { deviceFor } from './store.mjs'

const COOKIE = 'jan-device'
const PAIR_PATH = '/jan-pair'
const YEAR_SECONDS = 365 * 24 * 60 * 60
const PAIR_TTL_MS = 10 * 60_000
const HOP_HEADERS = new Set(['connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'upgrade', 'te', 'trailer'])
const tailnetV6 = new BlockList()
tailnetV6.addSubnet('fd7a:115c:a1e0::', 48, 'ipv6')
const loopbackV6 = new BlockList()
loopbackV6.addAddress('::1', 'ipv6')

function cookieOf(header, name) {
  for (const part of String(header ?? '').split(';')) {
    const at = part.indexOf('=')
    if (at > 0 && part.slice(0, at).trim() === name) return part.slice(at + 1).trim()
  }
  return undefined
}

// A phone on home Wi-Fi reaches 192.168/16 or 10/8; 100.64/10 is a VPN or tailnet
// (for example Tailscale) that the phone joins only on purpose; public addresses must never be the default.
function privateRank(address) {
  const [a, b] = address.split('.').map(Number)
  if (a === 192 && b === 168) return 0
  if (a === 10) return 1
  if (a === 172 && b >= 16 && b <= 31) return 2
  if (a === 100 && b >= 64 && b <= 127) return 3
  return undefined
}

function requestUrl(target) {
  // The gateway is not a forward proxy; only origin-form targets belong here.
  if (typeof target !== 'string' || !target.startsWith('/') || /^\/[/\\]|[\\#]/.test(target)) return undefined
  return URL.parse(target, 'http://gateway.invalid') ?? undefined
}

function badGateway(res, message) {
  if (res.destroyed || res.writableEnded) return
  if (res.headersSent) { res.destroy(); return }
  res.writeHead(502, { 'cache-control': 'no-store' }).end(`${message}\n`)
}

function pairingToken() {
  return randomBytes(24).toString('base64url')
}

function addressHost(host) {
  return isIPv6(host) ? `[${host}]` : host
}

/** The transport protection available without TLS on a literal bind address. */
export function deviceAddressKind(host) {
  const family = isIP(host)
  if (family === 6 && !host.includes('%')) {
    if (loopbackV6.check(host, 'ipv6')) return 'loopback'
    if (tailnetV6.check(host, 'ipv6')) return 'tailnet'
  }
  if (family === 4) {
    if (host.startsWith('127.')) return 'loopback'
    const rank = privateRank(host)
    if (rank !== undefined) return rank === 3 ? 'tailnet' : 'lan'
  }
  return 'other'
}
/**
 * Private LAN IPv4 and tailnet addresses a phone could use, home Wi-Fi first.
 * @returns {{ address: string, interface: string }[]} candidate bind addresses.
 */
export function lanAddresses(interfaces = networkInterfaces()) {
  const found = []
  for (const [name, entries] of Object.entries(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.internal) continue
      const kind = deviceAddressKind(entry.address)
      if (kind !== 'lan' && kind !== 'tailnet') continue
      const rank = kind === 'tailnet' ? 3 : privateRank(entry.address)
      const virtual = /vEthernet|WSL|Hyper-V|docker|br-|veth|VirtualBox|VMware|Radmin|ZeroTier/i.test(name)
      found.push({ address: entry.address, interface: name, rank: rank + (virtual ? 10 : 0) })
    }
  }
  return found.sort((x, y) => x.rank - y.rank).map(({ rank: _rank, ...item }) => item)
}

/**
 * Start the gateway.
 * @param {object} options - what the gateway forwards and checks.
 * @param {string} options.host - LAN address to bind.
 * @param {number} options.port - port to bind; 0 picks a free one.
 * @param {{ cert: Buffer, key: Buffer }} [options.tls] - certificate and key when serving devices over HTTPS.
 * @param {boolean} [options.allowInsecureLan] - explicit opt-in for HTTP over private LAN.
 * @param {string} options.upstream - loopback origin of this Host, such as `http://127.0.0.1:3080`.
 * @param {() => Promise<string>} options.ownerCookie - the Host login cookie to add upstream; called again after a 401.
 * @param {() => Map<string, string>} options.hashes - current device token hashes.
 * @param {(id: string) => void} options.seen - notes a device's last use.
 * @param {(label: string) => Promise<{ token: string }>} options.pair - creates a device for a setup link.
 * @returns {Promise<{ url: string, secure: boolean, setupUrl: () => string | undefined, pairUrl: (label: string) => string, disconnect: (id: string) => void, close: () => Promise<void> }>} the running gateway.
 */
export async function startGateway({ host, port, tls, allowInsecureLan = false, upstream, ownerCookie, hashes, seen, pair }) {
  const secure = tls !== undefined
  const kind = deviceAddressKind(host)
  if (secure && (!tls.cert?.length || !tls.key?.length)) throw new Error('Device access requires both a TLS certificate and private key when TLS is configured.')
  if (!secure && kind === 'other') throw new Error('A device gateway on this address requires HTTPS.')
  if (!secure && kind === 'lan' && !allowInsecureLan) throw new Error('Configure HTTPS or turn on Allow unencrypted LAN access in Settings > Hosts.')
  const target = new URL(upstream)
  const secureUpstream = target.protocol === 'https:'
  const upstreamHost = target.hostname.replace(/^\[|\]$/g, '')
  const upstreamPort = Number(target.port || (secureUpstream ? 443 : 80))
  const sockets = new Map()
  const invites = new Map()
  const setupToken = pairingToken()
  let setup = { label: 'First device' }
  async function signIn() {
    const value = await ownerCookie()
    if (typeof value !== 'string' || value.length === 0) throw new Error('Jan on this computer did not issue an owner cookie.')
    return value
  }
  let cookie = await signIn()

  function track(id, socket) {
    let set = sockets.get(id)
    if (set === undefined) sockets.set(id, set = new Set())
    if (set.has(socket)) return
    set.add(socket)
    socket.once('close', () => set.delete(socket))
  }

  function upstreamHeaders(headers) {
    const next = {}
    for (const [key, value] of Object.entries(headers)) if (!HOP_HEADERS.has(key) && key !== 'cookie') next[key] = value
    // Jan's Host check accepts loopback; the device's address is the gateway's business.
    next.host = target.host
    if (next.origin !== undefined) next.origin = target.origin
    if (next.referer !== undefined) delete next.referer
    next.cookie = cookie
    return next
  }

  async function handlePair(res, url) {
    const token = url.searchParams.get('t')
    const isSetup = token === null && url.searchParams.get('setup') === setupToken
    const invite = isSetup ? setup : invites.get(token)
    if (invite === undefined || invite.pending || (invite.expires !== undefined && invite.expires <= Date.now())) {
      res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' })
      res.end('This pairing link is not valid any more. Make a new one on the Hosts page of the Jan you want to reach.\n')
      return
    }
    invite.pending = true
    let deviceToken
    try {
      ({ token: deviceToken } = await pair(invite.label))
    } catch {
      invite.pending = false
      badGateway(res, 'Jan could not save the paired device. Try this link again.')
      return
    }
    if (isSetup) setup = undefined
    else invites.delete(token)
    // Lax, not Strict: a QR scan opens the link from the camera app, and Strict would drop the
    // cookie on the redirect that follows.
    res.writeHead(303, {
      'location': '/', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer',
      'set-cookie': `${COOKIE}=${deviceToken}; Max-Age=${YEAR_SECONDS}; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`,
    })
    res.end()
  }

  function forward(req, res, retried = false) {
    const request = secureUpstream ? httpsRequest : httpRequest
    const unavailable = () => badGateway(res, 'Jan on this computer is not answering.')
    const proxied = request({ host: upstreamHost, port: upstreamPort, method: req.method, path: req.url, headers: upstreamHeaders(req.headers) }, (upstreamRes) => {
      upstreamRes.on('error', unavailable)
      if (upstreamRes.statusCode === 401 && !retried && (req.method === 'GET' || req.method === 'HEAD')) {
        upstreamRes.resume()
        void signIn().then((next) => {
          cookie = next
          if (!res.destroyed && !res.writableEnded) forward(req, res, true)
        }).catch(unavailable)
        return
      }
      const headers = { ...upstreamRes.headers }
      delete headers['set-cookie']
      res.writeHead(upstreamRes.statusCode ?? 502, headers)
      upstreamRes.pipe(res)
    })
    proxied.on('error', unavailable)
    req.pipe(proxied)
  }

  function onRequest(req, res) {
    const url = requestUrl(req.url)
    if (url === undefined) { res.writeHead(400).end('Invalid request target.\n'); return }
    if (url.pathname === PAIR_PATH) {
      if (req.method !== 'GET') { res.writeHead(405, { allow: 'GET' }).end(); return }
      void handlePair(res, url).catch(() => badGateway(res, 'Jan could not pair this device.'))
      return
    }
    const id = deviceFor(hashes(), cookieOf(req.headers.cookie, COOKIE))
    if (id === undefined) {
      res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
      res.end('This device is not paired with this Jan. Scan the QR code on its Hosts page.\n')
      return
    }
    seen(id)
    track(id, req.socket)
    forward(req, res)
  }
  const server = secure ? createHttpsServer(tls, onRequest) : createServer(onRequest)

  server.on('upgrade', (req, socket, head) => {
    if (requestUrl(req.url) === undefined) { socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); return }
    const id = deviceFor(hashes(), cookieOf(req.headers.cookie, COOKIE))
    if (id === undefined) { socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n'); return }
    track(id, socket)
    const connected = () => {
      const headers = upstreamHeaders(req.headers)
      headers.connection = 'Upgrade'
      headers.upgrade = req.headers.upgrade
      const lines = [`${req.method} ${req.url} HTTP/1.1`, ...Object.entries(headers).map(([key, value]) => `${key}: ${value}`), '', '']
      upstreamSocket.write(lines.join('\r\n'))
      if (head.length) upstreamSocket.write(head)
      upstreamSocket.pipe(socket)
      socket.pipe(upstreamSocket)
    }
    const upstreamSocket = secureUpstream
      ? tlsConnect({ host: upstreamHost, port: upstreamPort, servername: isIP(upstreamHost) === 0 ? upstreamHost : undefined }, connected)
      : connect(upstreamPort, upstreamHost, connected)
    const end = () => { socket.destroy(); upstreamSocket.destroy() }
    upstreamSocket.on('error', end)
    socket.on('error', end)
    socket.once('close', end)
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => { server.off('error', reject); resolve() })
  })
  const url = `${secure ? 'https' : 'http'}://${addressHost(host)}:${server.address().port}`
  return {
    url,
    secure,
    setupUrl: () => setup === undefined ? undefined : `${url}${PAIR_PATH}?setup=${setupToken}`,
    pairUrl(label) {
      const now = Date.now()
      for (const [token, invite] of invites) if (invite.expires <= now && !invite.pending) invites.delete(token)
      const token = pairingToken()
      invites.set(token, { label, expires: now + PAIR_TTL_MS })
      return `${url}${PAIR_PATH}?t=${token}`
    },
    disconnect(id) {
      for (const socket of sockets.get(id) ?? []) socket.destroy()
      sockets.delete(id)
    },
    close: () => new Promise((resolve) => {
      for (const set of sockets.values()) for (const socket of set) socket.destroy()
      server.close(() => resolve())
    }),
  }
}
