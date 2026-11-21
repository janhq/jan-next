/**
 * The Hosts named in the user's OpenSSH config, for one-click import. Only the names and the
 * HostName, User and Port written in each `Host` block are read, for display; an imported
 * Host connects by its alias, so ssh itself still applies every option, Include and Match.
 */
import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join } from 'node:path'

const MAX_INCLUDE_DEPTH = 8

/** @returns {string} the per-user ssh config path. */
export function sshConfigPath() {
  return join(homedir(), '.ssh', 'config')
}

function words(line) {
  const found = []
  const pattern = /"([^"]*)"|(\S+)/g
  for (let match = pattern.exec(line); match !== null; match = pattern.exec(line)) found.push(match[1] ?? match[2])
  return found
}

function wildcard(pattern) {
  const source = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')
  return new RegExp(`^${source}$`)
}

// ssh reads a relative Include from ~/.ssh and expands a wildcard in the file name.
async function includeFiles(value) {
  const expanded = value.startsWith('~') ? join(homedir(), value.slice(1)) : value
  const full = isAbsolute(expanded) ? expanded : join(homedir(), '.ssh', expanded)
  const name = basename(full)
  if (!/[*?]/.test(name)) return [full]
  const matcher = wildcard(name)
  try {
    return (await readdir(dirname(full))).filter(entry => matcher.test(entry)).sort().map(entry => join(dirname(full), entry))
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
}

async function readConfig(file, depth, hosts) {
  let text
  try {
    text = await readFile(file, 'utf8')
  } catch (error) {
    // A missing Include target is not an error to ssh either.
    if (error?.code === 'ENOENT' || error?.code === 'EISDIR') return
    throw error
  }
  let block = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    const [keyword = '', ...rest] = words(line.replace(/^(\S+?)\s*=\s*/, '$1 '))
    const key = keyword.toLowerCase()
    if (key === 'host') {
      // Patterns (`*`, `?`) and negations name no single computer, so they are not offered.
      block = rest.filter(alias => !/[*?!]/.test(alias)).map((alias) => {
        const existing = hosts.get(alias.toLowerCase())
        if (existing !== undefined) return existing
        const host = { alias, file }
        hosts.set(alias.toLowerCase(), host)
        return host
      })
    } else if (key === 'match') {
      block = []
    } else if (key === 'include' && depth < MAX_INCLUDE_DEPTH) {
      for (const value of rest) for (const included of await includeFiles(value)) await readConfig(included, depth + 1, hosts)
    } else if (key === 'hostname' || key === 'user' || key === 'port') {
      // ssh keeps the first value it reads for each option.
      const field = key === 'hostname' ? 'hostName' : key
      for (const host of block) if (host[field] === undefined) host[field] = rest[0]
    }
  }
}

/**
 * Read the concrete Host aliases from an ssh config and every file it includes.
 * @param {string} [file] - config to read; defaults to `~/.ssh/config`.
 * @returns {Promise<{ alias: string, hostName?: string, user?: string, port?: string, file: string }[]>} one entry per alias, in file order.
 */
export async function sshConfigHosts(file = sshConfigPath()) {
  const hosts = new Map()
  await readConfig(file, 0, hosts)
  return [...hosts.values()]
}
