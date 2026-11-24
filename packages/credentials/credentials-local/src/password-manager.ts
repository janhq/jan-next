import { execFile, type ExecFileException } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { delimiter, isAbsolute, join } from 'node:path'
import type { LaunchEnvironmentSnapshot } from '@janhq/jan-launch-environment'

/** Run one `op` or `bw` command with the given arguments and return its standard output. */
export type VaultCliRunner = (command: 'op' | 'bw', args: readonly string[]) => Promise<string>

type Manager = 'op' | 'bw'
type ErrorCode = 'invalid-reference' | 'missing-cli' | 'locked' | 'not-found' | 'ambiguous' | 'timeout' | 'cli-failed'

const messages = {
  op: {
    'invalid-reference': 'Enter a valid 1Password secret reference.',
    'missing-cli': 'Install the 1Password CLI (`op`) and make sure Jan can find it.',
    locked: 'Unlock 1Password or sign in to its CLI, then try again.',
    'not-found': 'That item or field was not found in 1Password.',
    ambiguous: 'That item or field was not found in 1Password.',
    timeout: 'The 1Password CLI did not answer in time. Try again.',
    'cli-failed': 'Jan could not read the 1Password CLI result. Check your CLI setup and try again.',
  },
  bw: {
    'invalid-reference': 'Enter a valid Bitwarden secret reference.',
    'missing-cli': 'Install the Bitwarden CLI (`bw`) and make sure Jan can find it.',
    locked: 'Unlock Bitwarden and make `BW_SESSION` available to Jan, then try again.',
    'not-found': 'That item or field was not found in Bitwarden.',
    ambiguous: 'More than one Bitwarden item matches. Use the item ID instead.',
    timeout: 'Jan could not read the Bitwarden CLI result. Check your CLI setup and try again.',
    'cli-failed': 'Jan could not read the Bitwarden CLI result. Check your CLI setup and try again.',
  },
} satisfies Record<Manager, Record<ErrorCode, string>>

function vaultError(manager: Manager, code: ErrorCode): Error {
  return Object.assign(new Error(messages[manager][code]), { code })
}

const TIMEOUT_MS = 5000
const MAX_OUTPUT_BYTES = 1024 * 1024
const OS_ENV = [
  'HOME', 'USER', 'LOGNAME', 'TMPDIR', 'TMP', 'TEMP', 'PATH',
  'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS',
  'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'SystemRoot', 'WINDIR',
]
const MANAGER_ENV = {
  op: ['OP_ACCOUNT', 'OP_BIOMETRIC_UNLOCK_ENABLED', 'OP_CONFIG_DIR', 'OP_CONNECT_HOST',
    'OP_CONNECT_TOKEN', 'OP_SESSION', 'OP_SERVICE_ACCOUNT_TOKEN'],
  bw: ['BW_SESSION', 'BITWARDENCLI_APPDATA_DIR', 'NODE_EXTRA_CA_CERTS'],
}

function cliEnv(snapshot: LaunchEnvironmentSnapshot, command: Manager): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const name of [...OS_ENV, ...MANAGER_ENV[command]]) {
    const value = snapshot.getFrom(name, ['process'])?.value
    if (value !== undefined) env[name] = value
  }
  if (command === 'op') {
    env['OP_CACHE'] = 'false'
    env['OP_DEBUG'] = 'false'
  }
  return env
}

function classifyFailure(command: Manager, error: ExecFileException, stderr: string): ErrorCode {
  if (error.code === 'ENOENT') return 'missing-cli'
  if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return 'cli-failed'
  if (error.killed) return 'timeout'
  if (command === 'bw' && /more than one result was found|more than one item matches/i.test(stderr)) return 'ambiguous'
  if (/not (?:currently )?(?:signed|logged) in|not authenticated|session (?:has expired|is expired|is invalid)|vault is locked|account is locked|you must (?:sign|log) in|no accounts? (?:configured|found)|session token (?:is invalid|has expired)/i.test(stderr)) return 'locked'
  if (/(?:^|\W)not found\.|could(?: not|n't) find|(?:field|item|vault) .*not found|no (?:totp|password|username|notes) available/i.test(stderr)) return 'not-found'
  return 'cli-failed'
}

/**
 * Runs a single resolution, sharing one timeout between a lookup and any TOTP request.
 * @param snapshot - the launch environment whose PATH and session variables the CLI receives.
 * @returns a runner for `op` or `bw` commands within that one deadline.
 */
export function vaultCli(snapshot: LaunchEnvironmentSnapshot): VaultCliRunner {
  const deadline = performance.now() + TIMEOUT_MS
  return async (command, args) => {
    const env = cliEnv(snapshot, command)
    // Empty and relative PATH entries would execute programs from the project.
    const directories = (env['PATH'] ?? '').split(delimiter).filter(isAbsolute)
    if (directories.length === 0) throw vaultError(command, 'missing-cli')
    env['PATH'] = directories.join(delimiter)
    let executable: string = command
    if (process.platform === 'win32') {
      // libuv searches cwd before PATH on Windows for a bare executable name.
      // Select an absolute .exe from launch PATH; never run a .cmd via a shell.
      executable = ''
      for (const directory of directories) {
        if (performance.now() >= deadline) throw vaultError(command, 'timeout')
        const candidate = join(directory, `${command}.exe`)
        if ((await stat(candidate).catch(() => undefined))?.isFile()) {
          executable = candidate
          break
        }
      }
      if (!executable) throw vaultError(command, 'missing-cli')
    }
    const timeout = Math.ceil(deadline - performance.now())
    if (timeout <= 0) throw vaultError(command, 'timeout')
    const { promise, resolve, reject } = Promise.withResolvers<string>()
    try {
      const child = execFile(executable, [...args], {
        env, timeout, maxBuffer: MAX_OUTPUT_BYTES, encoding: 'utf8',
        shell: false, windowsHide: true, killSignal: 'SIGKILL',
      }, (error, stdout, stderr) => {
        if (error !== null) reject(vaultError(command, classifyFailure(command, error, stderr)))
        else resolve(stdout)
      })
      child.stdin?.end()
    } catch {
      reject(vaultError(command, 'cli-failed'))
    }
    return promise
  }
}

function nonEmptyField(value: unknown, manager: Manager): string {
  if (typeof value !== 'string' || value.length === 0) throw vaultError(manager, 'not-found')
  return value
}

function object(value: unknown): Record<string, unknown> | undefined {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
}

const OP_SEGMENT = /^[A-Za-z0-9_. -]+$/
const CONTROL = /[\x00-\x1f\x7f]/
const BITWARDEN_ID = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i
const bitwardenArgs = (kind: 'item' | 'totp', id: string) => ['--nointeraction', '--raw', 'get', kind, '--', id]

function decodeSegment(segment: string): string {
  let decoded: string
  try { decoded = decodeURIComponent(segment) } catch { throw vaultError('bw', 'invalid-reference') }
  if (!decoded.trim() || CONTROL.test(decoded)) throw vaultError('bw', 'invalid-reference')
  return decoded
}

/**
 * Interpret a saved pointer once, never its returned value or any ambient fallback.
 * @param value - the saved `op://` or `bw://` reference.
 * @param run - the CLI runner for this resolution, from {@link vaultCli}.
 * @returns the secret the password manager returns.
 */
export async function resolvePasswordManagerValue(value: string, run: VaultCliRunner): Promise<string> {
  if (value.startsWith('op://')) {
    const parts = value.slice(5).split('/')
    if ((parts.length !== 3 && parts.length !== 4) || parts.some(part => !part.trim() || !OP_SEGMENT.test(part))) {
      throw vaultError('op', 'invalid-reference')
    }
    return nonEmptyField(await run('op', ['read', '--no-newline', value]), 'op')
  }
  if (!value.startsWith('bw://')) return value

  const [itemSegment, fieldSegment, ...extra] = value.slice(5).split('/')
  if (itemSegment === undefined || fieldSegment === undefined || extra.length > 0 || CONTROL.test(value) || /[?#]/.test(value)) {
    throw vaultError('bw', 'invalid-reference')
  }
  const item = decodeSegment(itemSegment)
  const field = decodeSegment(fieldSegment)
  const output = await run('bw', bitwardenArgs('item', item))
  let result: Record<string, unknown> | undefined
  try { result = object(JSON.parse(output)) } catch { throw vaultError('bw', 'cli-failed') }
  const id = result?.['id']
  const name = result?.['name']
  if (result === undefined || typeof id !== 'string' || !BITWARDEN_ID.test(id) || typeof name !== 'string') {
    throw vaultError('bw', 'cli-failed')
  }
  // `bw get item` accepts partial matches. A miss must not use another item's secret.
  if (BITWARDEN_ID.test(item) ? id.toLowerCase() !== item.toLowerCase() : name !== item) throw vaultError('bw', 'not-found')
  const login = object(result['login'])
  switch (field) {
    case 'password': case 'username': return nonEmptyField(login?.[field], 'bw')
    case 'notes': return nonEmptyField(result['notes'], 'bw')
    case 'totp': {
      nonEmptyField(login?.['totp'], 'bw')
      const totp = await run('bw', bitwardenArgs('totp', id))
      if (!/^\d{6,8}$/.test(totp)) throw vaultError('bw', 'cli-failed')
      return totp
    }
    default: {
      const fields = result['fields']
      const matches = Array.isArray(fields) ? fields.map(object).filter(entry => entry?.['name'] === field) : []
      return nonEmptyField(matches.length === 1 ? matches[0]?.['value'] : undefined, 'bw')
    }
  }
}
