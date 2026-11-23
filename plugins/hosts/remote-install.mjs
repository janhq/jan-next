/**
 * Put Jan on another computer over the SSH login the person already has, with nothing downloaded
 * there. The archive for that computer's processor ships with this Jan (see
 * apps/jan-host-runtime/README.md); one SSH command receives it on stdin, checks its SHA-256,
 * unpacks it into a staging directory and moves it into place, writing the identity file last.
 * An interrupted copy therefore never leaves a half-installed Jan that a later Connect would start.
 */
import { spawn } from 'node:child_process'
import { createReadStream, existsSync, readdirSync, readFileSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { missingTool, parseProbe, probeScript, selectTarget } from './install-target.mjs'
import { parseSshTarget } from './store.mjs'

/** Everything Hosts installs lives under this directory of the remote user's home. */
export const REMOTE_ROOT = '.jan/hosts-runtime'
/** Identity of the build that is installed and complete; written last. */
export const VERSION_FILE = `${REMOTE_ROOT}/VERSION`
const ARCHIVE_PATTERN = /^jan-host-runtime-(.+)-((?:linux|darwin)-(?:x64|arm64))\.tar\.gz$/
const PROBE_MS = 30_000
const INSTALL_MS = 15 * 60_000

/**
 * Quote one value for a POSIX shell.
 * @param {string} value - any string.
 * @returns {string} the value as one single-quoted shell word.
 */
export function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`
}

/**
 * The archives this Jan can copy, read from the directory Desktop packaging fills.
 * @param {string | undefined} directory - `JAN_HOST_RUNTIME_DIR`; undefined when this Jan ships none.
 * @returns {Map<string, { archive: string, version: string, sha256: string }>} one entry per target.
 * @throws {Error} when an archive has no `.sha256` file beside it, which means the build is incomplete.
 */
export function shippedRuntimes(directory) {
  const found = new Map()
  if (directory === undefined || directory === '' || !existsSync(directory)) return found
  for (const name of readdirSync(directory).sort()) {
    const match = ARCHIVE_PATTERN.exec(name)
    if (!match) continue
    const archive = join(directory, name)
    const sidecar = `${archive}.sha256`
    if (!existsSync(sidecar)) throw new Error(`jan-hosts: ${sidecar} is missing; rebuild with scripts/build-host-runtime.ts`)
    const sha256 = readFileSync(sidecar, 'utf8').trim().split(/\s+/)[0]?.toLowerCase() ?? ''
    if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error(`jan-hosts: ${sidecar} does not hold a SHA-256`)
    found.set(match[2], { archive, version: match[1], sha256 })
  }
  return found
}

/**
 * The identity written to the other computer's `VERSION` file. The digest makes two builds of one
 * version distinct, so a rebuilt archive replaces the old copy.
 * @param {{ version: string, sha256: string }} runtime - one shipped archive.
 * @returns {string} `<version>+<first 12 digest characters>`.
 */
export function runtimeIdentity(runtime) {
  return `${runtime.version}+${runtime.sha256.slice(0, 12)}`
}

/**
 * The SSH options every Hosts command uses. BatchMode turns a password prompt into a failure the
 * page can show, because there is no terminal to type into.
 * @param {string} ssh - saved `user@host[:port]` or ssh config alias.
 * @returns {string[]} ssh arguments up to and including the destination.
 */
export function sshArgs(ssh) {
  // Entries saved before ssh config aliases were supported start with `@` when they have no user.
  const { user, host, port } = parseSshTarget(String(ssh).replace(/^@/, ''))
  const destination = user === undefined ? host : `${user}@${host}`
  return [
    '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=15',
    '-o', 'ServerAliveInterval=15', ...(port === undefined ? [] : ['-p', String(port)]), destination,
  ]
}

/**
 * The sentence for an ssh failure. ssh prints its own reason on stderr; the person needs to know
 * whether it is the address, the key or the network.
 * @param {string} stderr - ssh's error output.
 * @returns {string} one sentence.
 */
export function sshFailure(stderr) {
  const text = String(stderr)
  if (/Permission denied/.test(text)) return 'That computer refused the SSH login. Check that your SSH key works there without a password prompt.'
  if (/Could not resolve hostname/.test(text)) return 'This computer cannot find that host name. Check the name, or pick it from your SSH config.'
  if (/Connection refused/.test(text)) return 'That computer refused the connection. Check that SSH is running there and the port is right.'
  if (/Connection timed out|Operation timed out|No route to host|Network is unreachable/.test(text)) {
    return 'That computer did not answer. Check that it is on and on the same network.'
  }
  if (/Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED/.test(text)) {
    return 'That computer\'s SSH identity changed since the last login. Check it, then remove its old line from known_hosts.'
  }
  const line = text.split(/\r?\n/).map(value => value.trim()).filter(Boolean).at(-1)
  return line === undefined ? 'The SSH login failed.' : `The SSH login failed: ${line}`
}

function lastLine(text) {
  return String(text).split(/\r?\n/).map(value => value.trim()).filter(Boolean).at(-1)
}

/**
 * Run one command on the other computer.
 * @param {{ ssh: string[], command: string, timeoutMs: number, signal?: AbortSignal, input?: import('node:stream').Readable }} request - what to run.
 * @returns {Promise<{ code: number | null, stdout: string, stderr: string }>} the outcome; a non-zero exit resolves.
 * @throws {Error} on timeout, cancellation, or a missing `ssh` command.
 */
export function runRemote({ ssh, command, timeoutMs, signal, input }) {
  const { promise, resolve, reject } = Promise.withResolvers()
  const child = spawn('ssh', [...ssh, command], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  let stdout = ''
  let stderr = ''
  const fail = (error) => { clearTimeout(timer); signal?.removeEventListener('abort', abort); child.kill(); reject(error) }
  const timer = setTimeout(() => fail(new Error(`No answer from that computer within ${Math.round(timeoutMs / 1000)} s.`)), timeoutMs)
  const abort = () => fail(signal.reason ?? new Error('Cancelled.'))
  signal?.addEventListener('abort', abort, { once: true })
  child.stdout.on('data', (chunk) => { stdout = `${stdout}${chunk}`.slice(-64_000) })
  child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-16_000) })
  child.once('error', error => fail(error.code === 'ENOENT' ? new Error('This computer has no ssh command. Install OpenSSH.') : error))
  child.once('close', (code) => {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
    resolve({ code, stdout, stderr })
  })
  // A remote that exits early closes the pipe; its exit status carries the reason.
  child.stdin.on('error', () => { })
  if (input === undefined) child.stdin.end()
  else {
    input.once('error', fail)
    input.pipe(child.stdin)
  }
  return promise
}

/**
 * Ask the other computer what it is and which Hosts build it already has.
 * @param {string[]} ssh - ssh arguments from {@link sshArgs}.
 * @param {readonly string[]} supported - targets this Jan ships archives for.
 * @param {AbortSignal} [signal] - cancels the probe.
 * @returns {Promise<{ target: string, installed?: string }>} the target and the installed identity.
 * @throws {Error} with a sentence for the page when the login fails or the computer does not qualify.
 */
export async function probeRemote(ssh, supported, signal) {
  const result = await runRemote({ ssh, command: probeScript(VERSION_FILE), timeoutMs: PROBE_MS, signal })
  if (result.code === 255) throw new Error(sshFailure(result.stderr))
  const probe = parseProbe(result.stdout)
  if (supported.length === 0) throw new Error('This Jan has no copy of itself to install on other computers. Install Jan there yourself, or use a Jan desktop release.')
  const choice = selectTarget(probe, supported)
  if ('error' in choice) throw new Error(choice.error)
  const missing = missingTool(probe.tools)
  if (missing !== undefined) throw new Error(missing)
  if (!probe.home.startsWith('/')) throw new Error('That computer did not report a home directory, so Jan has nowhere to put itself.')
  return { target: choice.target, ...(probe.installed === undefined ? {} : { installed: probe.installed }) }
}

/**
 * The remote script that receives one archive on stdin. It saves the bytes, checks the SHA-256,
 * unpacks into a fresh staging directory, swaps it in for the previous build and writes the
 * identity file last. A second Connect at the same moment waits for the installer lock.
 * @param {{ identity: string, sha256: string }} build - the archive's identity and digest.
 * @returns {string} the remote command.
 */
export function installScript({ identity, sha256 }) {
  const root = `"$HOME"/${REMOTE_ROOT}`
  const install = [
    'set -e',
    `stage=${root}/.stage-$$`,
    `part=${root}/.part-$$`,
    'trap \'rm -rf "$stage" "$part"\' EXIT',
    'mkdir -p "$stage"',
    'cat > "$part"',
    'if command -v sha256sum >/dev/null 2>&1; then got=$(sha256sum "$part" | cut -d " " -f 1); else got=$(shasum -a 256 "$part" | cut -d " " -f 1); fi',
    `if [ "$got" != ${shellQuote(sha256)} ]; then echo "JAN_HOSTS_INSTALL_CORRUPT $got" >&2; exit 3; fi`,
    'tar -xzf "$part" -C "$stage"',
    // An archive built on Windows carries no executable bits; the build lists the programs.
    'while IFS= read -r file; do [ -n "$file" ] && chmod 755 "$stage/$file"; done < "$stage/executables.txt"',
    `rm -f ${root}/VERSION`,
    `rm -rf ${root}/current.old`,
    `if [ -d ${root}/current ]; then mv ${root}/current ${root}/current.old; fi`,
    `mv "$stage" ${root}/current`,
    `rm -rf ${root}/current.old`,
    `printf '%s' ${shellQuote(identity)} > ${root}/VERSION.part`,
    `mv ${root}/VERSION.part ${root}/VERSION`,
    'echo JAN_HOSTS_INSTALL_OK',
  ].join('\n')
  // Keep the same lock inode across runs. The kernel releases it on process exit, even
  // if the installer is killed. Do not race a recent mkdir lock from an older Jan.
  return [
    'set -e',
    'umask 077',
    `mkdir -p ${root}`,
    'if command -v flock >/dev/null 2>&1; then locker=flock; elif command -v lockf >/dev/null 2>&1; then locker=lockf; else echo JAN_HOSTS_INSTALL_NO_LOCK_TOOL >&2; exit 4; fi',
    `exec 9>>${root}/.install.lock`,
    '"$locker" -t 60 9 || { echo JAN_HOSTS_INSTALL_BUSY >&2; exit 4; }',
    `legacy=${root}/.lock`,
    'if [ -d "$legacy" ] && [ -z "$(find "$legacy" -prune -mmin +30 -print 2>/dev/null)" ]; then echo JAN_HOSTS_INSTALL_BUSY >&2; exit 4; fi',
    `exec sh -c ${shellQuote(install)}`,
  ].join('\n')
}

/**
 * The sentence for a failed install, from the remote script's output.
 * @param {{ code: number | null, stdout: string, stderr: string }} result - the install command's outcome.
 * @param {boolean} [copied] - whether every byte of the archive was read into ssh; false names a cut copy.
 * @returns {string | undefined} undefined when the install completed.
 */
export function installFailure(result, copied = true) {
  if (result.code === 0 && result.stdout.includes('JAN_HOSTS_INSTALL_OK')) return undefined
  // The half copy is discarded there, so pressing Connect resends it.
  const dropped = 'The connection dropped while Jan was being copied. Connect again to resend it.'
  if (/closed by remote host|Connection reset|Broken pipe|client_loop: send disconnect/.test(result.stderr)) return dropped
  if (result.code === 255) return sshFailure(result.stderr)
  if (/JAN_HOSTS_INSTALL_CORRUPT/.test(result.stderr)) return 'The copy of Jan arrived damaged on that computer. Connect again to resend it.'
  if (/JAN_HOSTS_INSTALL_BUSY/.test(result.stderr)) return 'Another connection is installing Jan on that computer. Try again once it finishes.'
  if (/JAN_HOSTS_INSTALL_NO_LOCK_TOOL/.test(result.stderr)) return 'That computer has neither flock nor lockf, which Jan needs to coordinate installs.'
  if (/No space left on device|Disk quota exceeded/.test(result.stderr)) {
    return 'That computer ran out of disk space while unpacking Jan. It needs about 600 MB free in your home folder.'
  }
  // A remote end killed mid-copy often leaves ssh nothing to print; the short copy is the evidence.
  if (!copied) return dropped
  const line = lastLine(result.stderr)?.replace(/[.\s]+$/, '')
  return `Jan could not be installed there${line === undefined || line === '' ? '' : `: ${line}`}.`
}

/**
 * Stream a shipped archive to the other computer and install it.
 * @param {{ ssh: string[], runtime: { archive: string, version: string, sha256: string }, onProgress?: (sent: number, total: number) => void, signal?: AbortSignal }} request - what to send.
 * @returns {Promise<void>} resolves once the identity file names this build.
 * @throws {Error} with a sentence for the page when the copy, check or unpack fails.
 */
export async function installRemote({ ssh, runtime, onProgress, signal }) {
  const total = (await stat(runtime.archive)).size
  const input = createReadStream(runtime.archive)
  let sent = 0
  input.on('data', (chunk) => { sent += chunk.length; onProgress?.(sent, total) })
  const result = await runRemote({
    ssh, command: installScript({ identity: runtimeIdentity(runtime), sha256: runtime.sha256 }), timeoutMs: INSTALL_MS, signal, input,
  })
  const failure = installFailure(result, sent >= total)
  if (failure !== undefined) throw new Error(failure)
}

/**
 * The command that starts the installed Jan with the edge profile. Its Jan home sits beside the
 * build, so a Jan the person installed there by hand keeps its own settings and chats. The proxy
 * variables point at the relay tunnel; loopback stays direct so its own login still works.
 * A server with no `~/.config/user-dirs.dirs` makes `xdg-user-dir DOCUMENTS` answer `$HOME`,
 * which Jan refuses as a project home, so the default project goes under `~/Documents` there,
 * the folder a desktop Linux names, unless the account already set its own. `JAN_HOST_NAME` carries
 * the saved connection's name, which the remote window shows as the computer its projects are on.
 * @param {{ port: number, proxy?: string, name?: string }} options - remote listen port, the relay's proxy URL and the saved connection name.
 * @returns {string} the remote command.
 */
export function startCommand({ port, proxy, name }) {
  const root = `"$HOME"/${REMOTE_ROOT}`
  const variables = proxy === undefined ? [] : [
    ...['HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy'].map(name => `${name}=${shellQuote(proxy)}`),
    ...['NO_PROXY', 'no_proxy'].map(name => `${name}=127.0.0.1,localhost,::1`),
  ]
  return [
    `cd "$HOME" &&`, 'exec env', ...variables, `JAN_HOME=${root}/home`,
    ...(name === undefined || name.trim() === '' ? [] : [`JAN_HOST_NAME=${shellQuote(name.trim())}`]),
    'XDG_DOCUMENTS_DIR="${XDG_DOCUMENTS_DIR:-$HOME/Documents}"',
    `${root}/current/node/bin/node`, `${root}/current/jan/node_modules/@janhq/jan/lib/bin.js`,
    '--profile', 'edge', '--no-open', '--port', String(port),
  ].join(' ')
}
