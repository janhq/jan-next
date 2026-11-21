/**
 * The saved-Hosts list (`$JAN_HOME/hosts/connections.json`) and the paired-device list
 * (`$JAN_HOME/hosts/devices.json`). Connections hold no secret: a remote Host's login link is
 * kept in Jan's credential store, so copying the hosts folder to another machine never copies
 * anyone's access. Devices hold only a hash of each device token, so reading the file cannot
 * be turned into a login.
 */
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { withFileLock as lockFile, writeFileAtomic } from '@janhq/jan-atomic-write'

// The lock file lives beside its target, and a fresh home has no hosts folder yet.
async function withFileLock(file, task) {
  await mkdir(dirname(file), { recursive: true })
  return lockFile(file, task)
}

const NAME_LIMIT = 64
const FORMAT = 1

/** A store failure the page shows as is; `code` names the field the person must fix. */
export class HostsError extends Error {
  /**
   * @param {string} code - stable reason, such as `name-taken`.
   * @param {string} message - English sentence for the page.
   */
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

async function readList(file, key) {
  let text
  try {
    text = await readFile(file, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
  const parsed = JSON.parse(text)
  if (parsed?.version !== FORMAT || !Array.isArray(parsed[key])) {
    throw new HostsError('format', `${file} is not a Jan hosts file of version ${FORMAT}.`)
  }
  return parsed[key]
}

function writeList(file, key, list) {
  return writeFileAtomic(file, `${JSON.stringify({ version: FORMAT, [key]: list }, null, 2)}\n`, { mode: 0o600 })
}

function name(value) {
  if (typeof value !== 'string' || !value.trim()) throw new HostsError('name', 'Give the Host a name.')
  const trimmed = value.trim()
  if (trimmed.length > NAME_LIMIT) throw new HostsError('name', `Use at most ${NAME_LIMIT} characters for the name.`)
  return trimmed
}

/**
 * Normalize a pasted Jan link to its application root. The query is dropped because it may
 * carry the one-time login token, which is stored separately.
 * @param {string} value - a `jan web` URL, with or without `?token=`.
 * @returns {{ url: string, token: string | undefined }} the clean root and the token it carried.
 */
export function parseHostUrl(value) {
  let url
  try {
    url = new URL(String(value ?? '').trim())
  } catch {
    throw new HostsError('url', 'Paste the full address, starting with http:// or https://.')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new HostsError('url', 'Paste the full address, starting with http:// or https://.')
  }
  if (url.username || url.password) throw new HostsError('url', 'Remove the user name and password from the address.')
  const token = url.searchParams.get('token') ?? undefined
  const path = url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`
  return { url: `${url.protocol}//${url.host.toLowerCase()}${path}`, token }
}

/**
 * Read `user@host:port` the way `ssh` does: user and port are optional.
 * @param {string} value - SSH destination.
 * @returns {{ user: string | undefined, host: string, port: number }} the parts.
 */
export function parseSshTarget(value) {
  const match = /^(?:([^@\s:]+)@)?([^@\s:]+|\[[0-9a-fA-F:]+\])(?::(\d{1,5}))?$/.exec(String(value ?? '').trim())
  const port = match?.[3] === undefined ? 22 : Number(match[3])
  // `-` would let a host name be read by ssh as an option.
  if (!match || match[2].startsWith('-') || match[1]?.startsWith('-') || port < 1 || port > 65535) {
    throw new HostsError('ssh', 'Write the SSH host as user@host or user@host:port.')
  }
  return { user: match[1], host: match[2].replace(/^\[|\]$/g, '').toLowerCase(), port }
}

function sshKey({ user, host, port }) {
  return `${user ?? ''}@${host}:${port}`
}

/** Saved Hosts and paired devices under one home. */
export class HostsStore {
  /** @param {string} directory - `$JAN_HOME/hosts`. */
  constructor(directory) {
    this.connectionsFile = join(directory, 'connections.json')
    this.devicesFile = join(directory, 'devices.json')
  }

  /** @returns {Promise<object[]>} saved connections, oldest first. */
  connections() {
    return readList(this.connectionsFile, 'connections')
  }

  /**
   * Add or edit a connection. Names are unique ignoring case, and two entries never point at
   * the same address, because the person could not tell them apart in the list.
   * @param {object} input - `{ id?, name, kind: 'url' | 'ssh', url?, ssh?, remotePort? }`.
   * @returns {Promise<{ connection: object, token: string | undefined }>} the saved entry and any pasted token.
   */
  saveConnection(input) {
    return withFileLock(this.connectionsFile, async () => {
      const list = await this.connections()
      const entry = { id: input.id ?? randomUUID(), name: name(input.name), kind: input.kind }
      let token
      if (input.kind === 'url') {
        const parsed = parseHostUrl(input.url)
        entry.url = parsed.url
        token = parsed.token
      } else if (input.kind === 'ssh') {
        const target = parseSshTarget(input.ssh)
        const remotePort = Number(input.remotePort ?? 3080)
        if (!Number.isInteger(remotePort) || remotePort < 1 || remotePort > 65535) {
          throw new HostsError('remotePort', 'Use the port `jan web` listens on over there, a number from 1 to 65535.')
        }
        const command = String(input.command ?? '').trim() || 'jan'
        const profile = String(input.profile ?? '').trim() || 'web'
        // Both reach the remote shell as words of one command line.
        if (!/^[A-Za-z0-9_./~+-]+$/.test(command) || !/^[A-Za-z0-9_-]+$/.test(profile)) {
          throw new HostsError('command', 'The Jan command and profile may use only letters, digits and ./~_+-.')
        }
        Object.assign(entry, { ssh: sshKey(target), remotePort, command, profile })
      } else {
        throw new HostsError('kind', 'Choose Address or SSH.')
      }
      const others = list.filter(item => item.id !== entry.id)
      if (input.id !== undefined && others.length === list.length) throw new HostsError('missing', 'That Host was removed.')
      if (others.some(item => item.name.toLowerCase() === entry.name.toLowerCase())) {
        throw new HostsError('name-taken', `Another Host is already called ${entry.name}.`)
      }
      const where = item => item.kind === 'url' ? item.url : `${item.ssh}/${item.remotePort}`
      if (others.some(item => where(item) === where(entry))) throw new HostsError('duplicate', 'This address is already saved.')
      const index = list.findIndex(item => item.id === entry.id)
      if (index === -1) list.push({ ...entry, addedAt: Date.now() })
      else list[index] = { ...list[index], ...entry }
      await writeList(this.connectionsFile, 'connections', list)
      return { connection: list[index === -1 ? list.length - 1 : index], token }
    })
  }

  /**
   * @param {string} id - connection to forget.
   * @returns {Promise<void>} resolves when the entry is gone.
   */
  removeConnection(id) {
    return withFileLock(this.connectionsFile, async () => {
      const list = await this.connections()
      await writeList(this.connectionsFile, 'connections', list.filter(item => item.id !== id))
    })
  }

  /** @returns {Promise<object[]>} paired devices without their token hashes. */
  async devices() {
    return (await readList(this.devicesFile, 'devices')).map(({ hash: _hash, ...device }) => device)
  }

  /**
   * Create a device record and return the only copy of its token.
   * @param {string} label - what the person calls the device, for example "Phone".
   * @returns {Promise<{ device: object, token: string }>} the record and its secret.
   */
  pairDevice(label) {
    return withFileLock(this.devicesFile, async () => {
      const list = await readList(this.devicesFile, 'devices')
      const token = randomBytes(32).toString('base64url')
      const device = { id: randomUUID(), name: name(label), pairedAt: Date.now() }
      list.push({ ...device, hash: hashToken(token) })
      await writeList(this.devicesFile, 'devices', list)
      return { device, token }
    })
  }

  /**
   * @param {string} id - device whose token stops working now.
   * @returns {Promise<void>} resolves when the record is gone.
   */
  revokeDevice(id) {
    return withFileLock(this.devicesFile, async () => {
      const list = await readList(this.devicesFile, 'devices')
      await writeList(this.devicesFile, 'devices', list.filter(item => item.id !== id))
    })
  }

  /** @returns {Promise<Map<string, string>>} device id by token hash, for checking every gateway request in memory. */
  async deviceHashes() {
    return new Map((await readList(this.devicesFile, 'devices')).map(item => [item.hash, item.id]))
  }

  /**
   * @param {string} id - device seen on the gateway.
   * @returns {Promise<void>} resolves when `lastSeenAt` is written; a device revoked meanwhile stays gone.
   */
  touchDevice(id) {
    return withFileLock(this.devicesFile, async () => {
      const list = await readList(this.devicesFile, 'devices')
      const device = list.find(item => item.id === id)
      if (device === undefined) return
      device.lastSeenAt = Date.now()
      await writeList(this.devicesFile, 'devices', list)
    })
  }
}

/**
 * Find the device a presented token belongs to.
 * @param {Map<string, string>} hashes - from {@link HostsStore.deviceHashes}.
 * @param {string | undefined} token - token from the pairing link or the device cookie.
 * @returns {string | undefined} the device id, or undefined for an unknown or revoked token.
 */
export function deviceFor(hashes, token) {
  if (typeof token !== 'string' || !token) return undefined
  const presented = Buffer.from(hashToken(token), 'hex')
  for (const [hash, id] of hashes) {
    const stored = Buffer.from(hash, 'hex')
    if (stored.length === presented.length && timingSafeEqual(stored, presented)) return id
  }
  return undefined
}

function hashToken(token) {
  return createHash('sha256').update(String(token)).digest('hex')
}
