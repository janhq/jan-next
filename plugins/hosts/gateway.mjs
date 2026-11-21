/**
 * The device gateway: a second listener on a LAN address that forwards to this Host's loopback
 * listener. The Host itself never leaves loopback. Every request must carry a paired device's
 * own cookie, so removing one device cuts it off at once, including its open live connection,
 * without signing out the desktop or other devices. The owner login the gateway adds upstream
 * never reaches the device.
 */
import { createServer, request as httpRequest } from 'node:http'
import { connect } from 'node:net'
import { networkInterfaces } from 'node:os'
import { randomBytes } from 'node:crypto'
import { deviceFor } from './store.mjs'

const COOKIE = 'jan-device'
const PAIR_PATH = '/jan-pair'
const YEAR_SECONDS = 365 * 24 * 60 * 60
const HOP_HEADERS = new Set(['connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'upgrade', 'te', 'trailer'])

function cookieOf(header, name) {
  for (const part of String(header ?? '').split(';')) {
    const at = part.indexOf('=')
    if (at > 0 && part.slice(0, at).trim() === name) return part.slice(at + 1).trim()
  }
  return undefined
}

// A phone on home Wi-Fi reaches 192.168/16 or 10/8; 100.64/10 is a VPN or tailnet
// (for example Tailscale) that the phone joins only on purpose; public addresses must never be the default.
function rank(address, name) {
  const [a, b] = address.split('.').map(Number)
  const virtual = /vEthernet|WSL|Hyper-V|docker|br-|veth|VirtualBox|VMware|Radmin|ZeroTier/i.test(name)
  let score = 4
  if (a === 192 && b === 168) score = 0
  else if (a === 10) score = 1
  else if (a === 172 && b >= 16 && b <= 31) score = 2
  else if (a === 100 && b >= 64 && b <= 127) score = 3
  return score + (virtual ? 10 : 0)
}

/**
 * IPv4 addresses a phone could use, the likeliest home network first.
 * @returns {{ address: string, interface: string }[]} candidate bind addresses.
 */
export function lanAddresses() {
  const found = []
  for (const [name, entries] of Object.entries(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal && !entry.address.startsWith('169.254.')) {
        found.push({ address: entry.address, interface: name, rank: rank(entry.address, name) })
      }
    }
  }
  return found.sort((x, y) => x.rank - y.rank).map(({ rank: _rank, ...item }) => item)
}

/**
 * Start the gateway.
 * @param {object} options - what the gateway forwards and checks.
 * @param {string} options.host - LAN address to bind.
 * @param {number} options.port - port to bind; 0 picks a free one.
 * @param {string} options.upstream - loopback origin of this Host, such as `http://127.0.0.1:3080`.
 * @param {() => Promise<string>} options.ownerCookie - the Host login cookie to add upstream; called again after a 401.
 * @param {() => Map<string, string>} options.hashes - current device token hashes.
 * @param {(id: string) => void} options.seen - notes a device's last use.
 * @param {(label: string) => Promise<{ token: string }>} options.pair - creates a device for a setup link.
 * @returns {Promise<{ url: string, setupUrl: () => string, disconnect: (id: string) => void, close: () => Promise<void> }>} the running gateway.
 */
export async function startGateway({ host, port, upstream, ownerCookie, hashes, seen, pair }) {
  const target = new URL(upstream)
  const sockets = new Map()
  // One link per process that pairs the first device on a machine with no screen, like the
  // token on the `jan web:` line. It works once and is never written to disk.
  let setupToken = randomBytes(24).toString('base64url')
  let cookie = await ownerCookie()

  function track(id, socket) {
    let set = sockets.get(id)
    if (set === undefined) sockets.set(id, set = new Set())
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

  async function handlePair(req, res, url) {
    const token = url.searchParams.get('t')
    const setup = url.searchParams.get('setup')
    let deviceToken
    if (token && deviceFor(hashes(), token)) deviceToken = token
    else if (setup && setupToken && setup === setupToken) {
      setupToken = undefined
      deviceToken = (await pair('First device')).token
    }
    if (deviceToken === undefined) {
      res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
      res.end('This pairing link is not valid any more. Make a new one on the Hosts page of the Jan you want to reach.\n')
      return
    }
    // Lax, not Strict: a QR scan opens the link from the camera app, and Strict would drop the
    // cookie on the redirect that follows.
    res.writeHead(303, {
      'location': '/', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer',
      'set-cookie': `${COOKIE}=${deviceToken}; Max-Age=${YEAR_SECONDS}; Path=/; HttpOnly; SameSite=Lax`,
    })
    res.end()
  }

  function forward(req, res, retried = false) {
    const proxied = httpRequest({ host: target.hostname, port: target.port, method: req.method, path: req.url, headers: upstreamHeaders(req.headers) }, async (upstreamRes) => {
      if (upstreamRes.statusCode === 401 && !retried && (req.method === 'GET' || req.method === 'HEAD')) {
        upstreamRes.resume()
        cookie = await ownerCookie()
        forward(req, res, true)
        return
      }
      const headers = { ...upstreamRes.headers }
      delete headers['set-cookie']
      res.writeHead(upstreamRes.statusCode ?? 502, headers)
      upstreamRes.pipe(res)
    })
    proxied.on('error', () => { if (!res.headersSent) { res.writeHead(502); res.end('Jan on this computer is not answering.\n') } else res.destroy() })
    req.pipe(proxied)
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://gateway.invalid')
    if (url.pathname === PAIR_PATH) { void handlePair(req, res, url); return }
    const id = deviceFor(hashes(), cookieOf(req.headers.cookie, COOKIE))
    if (id === undefined) {
      res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
      res.end('This device is not paired with this Jan. Scan the QR code on its Hosts page.\n')
      return
    }
    seen(id)
    track(id, req.socket)
    forward(req, res)
  })

  server.on('upgrade', (req, socket, head) => {
    const id = deviceFor(hashes(), cookieOf(req.headers.cookie, COOKIE))
    if (id === undefined) { socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n'); return }
    track(id, socket)
    const upstreamSocket = connect(Number(target.port), target.hostname, () => {
      const headers = upstreamHeaders(req.headers)
      headers.connection = 'Upgrade'
      headers.upgrade = req.headers.upgrade
      const lines = [`${req.method} ${req.url} HTTP/1.1`, ...Object.entries(headers).map(([key, value]) => `${key}: ${value}`), '', '']
      upstreamSocket.write(lines.join('\r\n'))
      if (head.length) upstreamSocket.write(head)
      upstreamSocket.pipe(socket)
      socket.pipe(upstreamSocket)
    })
    const end = () => { socket.destroy(); upstreamSocket.destroy() }
    upstreamSocket.on('error', end)
    socket.on('error', end)
    socket.once('close', end)
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => { server.off('error', reject); resolve() })
  })
  const url = `http://${host}:${server.address().port}`
  return {
    url,
    setupUrl: () => setupToken === undefined ? undefined : `${url}${PAIR_PATH}?setup=${setupToken}`,
    pairUrl: token => `${url}${PAIR_PATH}?t=${token}`,
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
