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
const COMMAND_PATTERN = /^[A-Za-z0-9_./~+-]+$/
// Releases before the 2026-11-16 rename print `dsh web` and answer "dsh web authentication
// required" over the same /connect and api/remote.mux wire; both names are one product.
const UNAUTHORIZED_PATTERN = /^(jan|dsh) web authentication required/
const START_LINE_PATTERN = /(?:jan|dsh) web: (https?:\/\/\S+)/

/**
 * The reason a remote `jan` stopped before printing its start line. Node ends a crash with its
 * stack and version, so the last lines are noise; the `Error:` line is what the user can act on.
 * @param {string} output - the remote's combined output.
 * @returns {string} one sentence for the Hosts page.
 */
export function startFailure(output) {
  if (/command not found|not found|No such file/.test(output) && !/Error:/.test(output)) {
    return 'Jan is not installed there, or set the Jan command to its full path.'
  }
  const profile = /profile "([^"]+)" does not exist/.exec(output)
  if (profile) {
    return `The Jan there has no "${profile[1]}" profile. It may be an older release: update it, or set the profile to web.`
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

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

/**
 * Start Jan on the other machine over SSH and forward its loopback port here. The remote Host
 * listens on its own loopback only, so nothing new is exposed on that machine's network; the
 * tunnel is the only way in. `-tt` gives the remote command a terminal so it ends when the
 * tunnel closes instead of staying behind.
 * @param {{ ssh: string, remotePort: number, command?: string, profile?: string }} entry - saved SSH connection.
 * @param {(line: string) => void} log - receives the remote output, for the page's status line.
 * @returns {Promise<{ root: string, token: string, close: () => void, exited: Promise<string> }>} the forwarded Host.
 */
export async function openTunnel(entry, log) {
  const command = entry.command ?? 'jan'
  const profile = entry.profile ?? 'web'
  // The store already checked these; checked again because this is where they reach a shell.
  if (!COMMAND_PATTERN.test(command) || !COMMAND_PATTERN.test(profile)) {
    throw new Error('The Jan command and profile may use only letters, digits and ./~_+-.')
  }
  const [target, port] = entry.ssh.split(/:(?=\d+$)/)
  const user = target.startsWith('@') ? target.slice(1) : target
  const localPort = await freePort()
  const args = [
    '-tt', '-o', 'BatchMode=yes', '-o', 'ExitOnForwardFailure=yes', '-o', 'StrictHostKeyChecking=accept-new',
    '-o', 'ServerAliveInterval=15', '-p', port, '-L', `127.0.0.1:${localPort}:127.0.0.1:${entry.remotePort}`,
    user, `${command} --profile ${profile} --no-open --port ${entry.remotePort}`,
  ]
  const child = spawn('ssh', args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  let output = ''
  const exited = new Promise(resolve => child.once('exit', code => resolve(`ssh exited with code ${code}`)))
  const token = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Jan did not start on ${user} within ${START_MS / 1000} s.`)), START_MS)
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
      reject(new Error(`${reason}. ${startFailure(output)}`.trim()))
    })
  }).catch((error) => { child.kill(); throw error })
  return { root: `http://127.0.0.1:${localPort}/`, token, close: () => { child.kill() }, exited }
}
