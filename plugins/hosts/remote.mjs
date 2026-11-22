/**
 * Reaching another Jan Host: the connection test and the SSH tunnel. Nothing here trusts a
 * status code alone, because a captive portal or another web server on the same port also
 * answers HTTP; a pass needs Jan's own login exchange and its WebSocket to open.
 */
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import WebSocket from 'ws'

const TEST_MS = 8000
const START_MS = 90_000
// Releases before the 2026-11-16 rename print `dsh web` and answer "dsh web authentication
// required" over the same /connect and api/remote.mux wire; both names are one product.
const UNAUTHORIZED_PATTERN = /^(jan|dsh) web authentication required/
const START_LINE_PATTERN = /(?:jan|dsh) web: (https?:\/\/\S+)/

/**
 * The reason the remote Jan stopped before printing its start line. Node ends a crash with its
 * stack and version, so the last lines are noise; the `Error:` line is what the user can act on.
 * @param {string} output - the remote's combined output.
 * @returns {string} one sentence for the Hosts page.
 */
export function startFailure(output) {
  // The loader prints "version `GLIBC_2.28' not found".
  if (/GLIBC_\d[\d.]*'? not found/.test(output)) {
    return 'That computer\'s Linux is too old for Jan. It needs glibc 2.28 or newer (Debian 10, Ubuntu 20.04, RHEL 8 or later).'
  }
  if (/No such file or directory/.test(output) && !/Error:/.test(output)) {
    return 'Jan\'s copy on that computer is incomplete. Connect again to reinstall it.'
  }
  const error = output.split(/\r?\n/).map(line => line.trim()).filter(line => /^(\w+)?Error\b|^error:/i.test(line)).at(-1)
  return error ?? output.split(/\r?\n/).filter(Boolean).slice(-2).join(' ')
}

function abortAfter(ms) {
  return AbortSignal.timeout(ms)
}

/**
 * Check one Host the way the page will use it.
 * @param {string} root - application root, ending in `/`.
 * @param {string | undefined} token - the login token from the Host's `jan web:` line.
 * @returns {Promise<{ http: string, websocket: string, message: string }>} each leg's outcome:
 * `ok`, `login-needed`, `unreachable`, `not-jan` or `skipped`.
 */
export async function testHost(root, token) {
  let response
  try {
    response = await fetch(root, { redirect: 'manual', signal: abortAfter(TEST_MS) })
  } catch (error) {
    return { http: 'unreachable', websocket: 'skipped', message: `No answer from ${root}: ${error.cause?.code ?? error.message}.` }
  }
  const body = response.status === 401 ? await response.text() : ''
  // 401 with Jan's own sentence is a Jan Host that wants its login link; 403 is Jan's
  // Host check refusing the address this computer used.
  if (response.status === 403) {
    return {
      http: 'not-trusted', websocket: 'skipped',
      message: 'That Host refused this address. Start it with --host set to this address, or add it with --trusted-host.'
    }
  }
  if (response.status !== 401 || !UNAUTHORIZED_PATTERN.test(body)) {
    return { http: 'not-jan', websocket: 'skipped', message: `${root} answered, but it is not a Jan Host (HTTP ${response.status}).` }
  }
  if (token === undefined) {
    return { http: 'login-needed', websocket: 'skipped', message: 'Jan is running there. Paste its full link with ?token= to sign in.' }
  }
  const connect = new URL('connect', root)
  connect.searchParams.set('token', token)
  connect.searchParams.set('interactions', 'none')
  const login = await fetch(connect, { redirect: 'manual', signal: abortAfter(TEST_MS) }).catch(error => error)
  if (login instanceof Error) return { http: 'unreachable', websocket: 'skipped', message: `The Host stopped answering: ${login.message}.` }
  const cookie = login.headers.get('set-cookie')?.split(';')[0]
  if (login.status !== 302 || cookie === undefined) {
    return {
      http: 'login-needed', websocket: 'skipped',
      message: 'The saved link no longer signs in. That Host was restarted; paste the new link from its jan web: line.'
    }
  }
  const mux = new URL('api/remote.mux', root)
  mux.protocol = mux.protocol === 'https:' ? 'wss:' : 'ws:'
  const websocket = await new Promise((resolve) => {
    const socket = new WebSocket(mux, { headers: { cookie, host: new URL(root).host }, handshakeTimeout: TEST_MS })
    socket.once('open', () => { socket.close(); resolve('ok') })
    socket.once('unexpected-response', (_request, res) => { resolve(`HTTP ${res.statusCode}`) })
    socket.once('error', error => { resolve(error.message) })
  })
  return websocket === 'ok'
    ? { http: 'ok', websocket: 'ok', message: 'Reachable. Chats on that Host will work from here.' }
    : {
      http: 'ok', websocket: 'failed',
      message: `Sign-in works but the live connection does not (${websocket}). A proxy or firewall is blocking WebSocket upgrades.`
    }
}

async function freePort() {
  const server = createServer()
  const { promise, resolve, reject } = Promise.withResolvers()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', resolve)
  await promise
  const { port } = server.address()
  const closed = Promise.withResolvers()
  server.close(closed.resolve)
  await closed.promise
  return port
}

/**
 * A port to use on the other computer. ssh cannot report a port it picked for `-R` to the
 * remote command, so both remote ports are chosen here and a taken one is retried.
 * @returns {number} a port from 20000 to 59999.
 */
export function remotePort() {
  return 20_000 + Math.floor(Math.random() * 40_000)
}

/** Whether the remote side refused a port, so another pair is worth trying. */
export function portTaken(output) {
  return /remote port forwarding failed|EADDRINUSE|address already in use/i.test(output)
}

/**
 * Start Jan on the other computer over SSH and forward its loopback port here. The remote Jan
 * listens on its own loopback only, so nothing new is exposed on that computer's network; the
 * tunnel is the only way in. `-R` forwards a port there back to the relay on this computer, the
 * remote Jan's way to its model providers. `-tt` gives the remote command a terminal so it ends
 * when the tunnel closes instead of staying behind.
 * @param {{ ssh: string[], command: (ports: { web: number, relay: number }) => string, relayPort?: number, log: (line: string) => void }} request -
 * ssh arguments ending in the destination, the remote start command for the chosen ports, the relay to forward, and the status line sink.
 * @returns {Promise<{ root: string, token: string, close: () => void, exited: Promise<string> }>} the forwarded Host.
 */
export async function openTunnel({ ssh, command, relayPort, log }) {
  let failure
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const ports = { web: remotePort(), relay: remotePort() }
    try {
      return await startOnce({ ssh, command: command(ports), ports, relayPort, log })
    } catch (error) {
      failure = error
      if (!error.portTaken) throw error
    }
  }
  throw failure
}

async function startOnce({ ssh, command, ports, relayPort, log }) {
  const destination = ssh.at(-1)
  const localPort = await freePort()
  const args = [
    '-tt', '-o', 'ExitOnForwardFailure=yes', ...ssh.slice(0, -1),
    '-L', `127.0.0.1:${localPort}:127.0.0.1:${ports.web}`,
    ...(relayPort === undefined ? [] : ['-R', `127.0.0.1:${ports.relay}:127.0.0.1:${relayPort}`]),
    destination, command,
  ]
  const child = spawn('ssh', args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  let output = ''
  const exited = new Promise(resolve => child.once('exit', code => resolve(`ssh exited with code ${code}`)))
  const { promise, resolve, reject } = Promise.withResolvers()
  const timer = setTimeout(() => reject(new Error(`Jan did not start on ${destination} within ${START_MS / 1000} s.`)), START_MS)
  const read = (chunk) => {
    output = `${output}${chunk}`.slice(-8000)
    for (const line of String(chunk).split(/\r?\n/)) if (line.trim()) log(line.trim())
    const match = START_LINE_PATTERN.exec(output)
    if (match) {
      clearTimeout(timer)
      resolve(new URL(match[1]).searchParams.get('token'))
    }
  }
  child.stdout.on('data', read)
  child.stderr.on('data', read)
  child.once('error', (error) => { clearTimeout(timer); reject(error) })
  void exited.then((reason) => {
    clearTimeout(timer)
    reject(Object.assign(new Error(`${reason}. ${startFailure(output)}`.trim()), { portTaken: portTaken(output) }))
  })
  try {
    const token = await promise
    return { root: `http://127.0.0.1:${localPort}/`, token, close: () => { child.kill() }, exited }
  } catch (error) {
    child.kill()
    throw error
  }
}
