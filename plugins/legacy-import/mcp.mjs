import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { parse as parseToml } from 'smol-toml'

export const MCP_SOURCES = ['jan', 'claude', 'claude-desktop', 'codex', 'omp', 'cursor']
export const CONNECTORS_ONLY = ['claude-desktop', 'cursor']
export const SOURCE_NAMES = { jan: 'Earlier Jan', claude: 'Claude Code', 'claude-desktop': 'Claude Desktop', codex: 'Codex', omp: 'OMP', cursor: 'Cursor', orca: 'Orca' }

const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const entries = value => plain(value) ? Object.entries(value) : []
const variable = /^[A-Za-z_][A-Za-z0-9_]*$/
const headerName = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/
const fail = reason => { throw new Error(reason) }
const backendPath = value => typeof value === 'string' && isAbsolute(value)
const secretArg = /^(?:--?(?:headers?|authorization|cookie|(?:[\w-]+-)?(?:password|token|api[-_]?key|secret|credentials?))(?:=|$)|[^=]*?(?:TOKEN|PASSWORD|SECRET|API_KEY|CREDENTIALS?)=)|(?:^|[\s'"-])(?:authorization|proxy-authorization|cookie|x-api-key)\s*:/i
const secretUrl = /https?:\/\/[^\s]*?(?:[^/\s]+@|\?[^\s]+|#[^\s]+)/i

function fileSpecs(source, { home, env, platform, folder }) {
  switch (source) {
    case 'jan': return [{ path: join(folder, 'mcp_config.json'), label: 'mcp_config.json' }]
    case 'claude': return [
      { path: join(home, '.claude.json'), label: '.claude.json' },
      { path: join(env.CLAUDE_CONFIG_DIR || join(home, '.claude'), 'settings.json'), label: 'Claude Code settings.json' },
    ]
    case 'claude-desktop': return [{ path: join(
      platform === 'win32' ? env.APPDATA || join(home, 'AppData', 'Roaming')
        : platform === 'darwin' ? join(home, 'Library', 'Application Support') : env.XDG_CONFIG_HOME || join(home, '.config'),
      'Claude', 'claude_desktop_config.json'), label: 'claude_desktop_config.json' }]
    case 'codex': return [{ path: join(env.CODEX_HOME || join(home, '.codex'), 'config.toml'), label: 'Codex config.toml', parse: parseToml }]
    case 'omp': return [{ path: join(home, '.omp', 'agent', 'mcp.json'), label: 'OMP mcp.json' }]
    case 'cursor': return [{ path: join(home, '.cursor', 'mcp.json'), label: 'Cursor mcp.json' }]
    default: throw new Error('Choose a supported MCP source.')
  }
}

function lookup(env, name) {
  if (variable.test(name) && Object.hasOwn(env, name) && typeof env[name] === 'string' && env[name] !== '') return env[name]
  return undefined
}

function credentialValue(value, env, source) {
  if (typeof value !== 'string') fail('environment and header values must be text')
  if (source === 'omp') {
    if (value.startsWith('!')) fail('uses a command to obtain a credential; commands are not run during migration')
    const inherited = lookup(env, value)
    if (inherited !== undefined) return inherited
  }
  const resolved = value.replace(/\$\{([^}]+)\}/g, (_, expression) => {
    const parsed = source === 'cursor' ? /^env:([A-Za-z_]\w*)$/.exec(expression) : /^([A-Za-z_]\w*)(?::-(.*))?$/.exec(expression)
    if (!parsed) fail('uses a variable this app cannot resolve')
    const found = lookup(env, parsed[1]) ?? parsed[2]
    if (found === undefined) fail(`environment variable ${parsed[1]} is not available to Jan`)
    return found
  })
  if (resolved.includes('${')) fail('uses an unresolved variable')
  return resolved
}

function textRecord(value, type, convert) {
  if (value === undefined) return {}
  if (!plain(value)) fail(`${type} must be an object of text values`)
  return Object.fromEntries(Object.entries(value).map(([key, val]) => {
    if (type === 'headers' ? !headerName.test(key) : !key || /[=\0]/.test(key)) fail(`invalid ${type} name`)
    const text = convert(val)
    if (text.includes('${')) fail('uses an unresolved variable')
    if (type === 'headers' ? /[^\t\x20-\x7e\x80-\xff]/.test(text) : text.includes('\0')) fail(`invalid ${type} value`)
    return [key, text]
  }))
}

function environmentValue(env, name) {
  if (typeof name !== 'string' || !variable.test(name)) fail('invalid environment variable reference')
  const value = lookup(env, name)
  if (value === undefined) fail(`environment variable ${name} is not available to Jan`)
  return value
}

function normalize(value, { source, scope, env }) {
  if (!plain(value)) fail('not a server entry')
  if (value.command !== undefined && value.url !== undefined) fail('has both a command and a URL')
  const transport = value.transport ?? value.type ?? (value.url === undefined ? 'stdio' : 'http')
  if (!['stdio', 'http', 'streamable-http'].includes(transport)) fail('unsupported transport')
  if (source === 'codex' && value.environment_id && value.environment_id !== 'local') fail('uses a remote Codex executor')
  const omitted = []
  if (value.oauth !== undefined || (value.auth !== undefined && (source !== 'codex' || transport !== 'stdio'))) omitted.push('app-managed OAuth sign-in')
  if (value.http_headers_helper !== undefined || value.headersHelper !== undefined) omitted.push('credential helper command')
  if (['enabled_tools', 'disabled_tools', 'default_tools_approval_mode', 'tools'].some(key => Object.hasOwn(value, key))) omitted.push('tool filters and approval rules')
  if (['timeout', 'startup_timeout_sec', 'tool_timeout_sec'].some(key => Object.hasOwn(value, key))) omitted.push('source timeout settings')
  const substitute = text => credentialValue(text, env, source)
  if (transport === 'stdio') {
    const { command } = value
    const args = value.args ?? []
    const cwd = value.cwd ?? (backendPath(scope) ? scope : undefined)
    if (typeof command !== 'string' || !command.trim() || command.includes('\0')) fail('missing or invalid executable')
    if (!Array.isArray(args) || args.some(arg => typeof arg !== 'string' || arg.includes('\0'))) fail('arguments must be a list of text values')
    if (cwd !== undefined && cwd !== '' && (!backendPath(cwd) || cwd.includes('\0'))) fail('working directory is not an absolute path')
    if ([command, ...args, cwd ?? ''].some(item => item.includes('${'))) fail('uses a variable in a command, argument or working directory; add it manually')
    if ([command, ...args].some(item => secretArg.test(item) || secretUrl.test(item))) fail('may put a credential in a command argument or URL; move it to environment or headers first')
    const configured = textRecord(value.env, 'environment variables', substitute)
    const inherited = []
    if (source === 'codex' && value.env_vars !== undefined) {
      if (!Array.isArray(value.env_vars)) fail('invalid inherited environment variables')
      for (const item of value.env_vars) {
        if (plain(item) && item.source === 'remote') {
          if (!omitted.includes('remote environment variables')) omitted.push('remote environment variables')
          continue
        }
        const name = typeof item === 'string' ? item : item?.name
        if (!Object.hasOwn(configured, name)) inherited.push([name, environmentValue(env, name)])
      }
    }
    return { config: { transport, command, args, ...(cwd ? { cwd } : {}), env: { ...textRecord(Object.fromEntries(inherited), 'environment variables', text => text), ...configured } }, omitted }
  }
  let url
  try { url = new URL(value.url) } catch { fail('missing or invalid HTTP endpoint') }
  if (!['https:', 'http:'].includes(url.protocol)) fail('unsupported endpoint protocol')
  if (url.username || url.password || url.search || url.hash) fail('URL credentials, queries and fragments stay behind; put authentication in headers')
  if (value.url.includes('${')) fail('uses a variable in the endpoint URL; add it manually')
  const headers = new Map()
  const setHeader = ([name, text]) => headers.set(name.toLowerCase(), [name, text])
  Object.entries(textRecord(value.headers ?? value.http_headers, 'headers', substitute)).forEach(setHeader)
  if (source === 'codex') {
    Object.entries(textRecord(value.env_http_headers, 'headers', name => environmentValue(env, name))).forEach(setHeader)
    if (value.bearer_token_env_var !== undefined) setHeader(['Authorization', `Bearer ${environmentValue(env, value.bearer_token_env_var)}`])
  }
  return { config: { transport: 'streamable-http', url: url.href, headers: textRecord(Object.fromEntries(headers.values()), 'headers', text => text) }, omitted }
}

const nameOf = sourceName => sourceName.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'server'

/**
 * Parse one app's local configuration without running its commands or contacting its servers.
 * @param {string} source App id from MCP_SOURCES.
 * @param {object} [options] Source paths and environment; tests supply fixture roots and variables.
 * @returns {Promise<object>} Host-only server configs, redacted rows, and file issues.
 */
export async function readMcpSource(source, { home = homedir(), env = process.env, platform = process.platform, folder } = {}) {
  const files = fileSpecs(source, { home, env, platform, folder })
  const results = await Promise.all(files.map(async ({ path, label, parse = JSON.parse }) => {
    try {
      const document = parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''))
      const servers = source === 'codex' ? document?.mcp_servers : document?.mcpServers
      if (!plain(document) || (servers !== undefined && !plain(servers))) fail('invalid MCP configuration')
      return { document }
    } catch (error) {
      return error?.code === 'ENOENT' ? {} : { issue: { file: label, reason: `Could not read MCP configuration from ${label}. Check the file and try again.` } }
    }
  }))
  const documents = results.map(result => result.document)
  const issues = results.flatMap(result => result.issue ? [result.issue] : [])
  const [primary, settings] = documents
  const variables = source === 'claude' && plain(settings?.env) ? { ...env, ...settings.env } : env
  const globals = source === 'codex' ? entries(primary?.mcp_servers) : [...entries(primary?.mcpServers), ...entries(settings?.mcpServers)]
  const projects = source === 'claude' ? entries(primary?.projects) : []
  const candidates = [
    ...globals.map(([sourceName, value]) => ({ sourceName, value })),
    ...projects.flatMap(([scope, project]) => entries(project?.mcpServers).map(([sourceName, value]) => ({ sourceName, scope, value }))),
  ]
  const servers = Object.create(null)
  const rows = []
  const skipped = []
  const seen = new Map()
  for (const { sourceName, scope, value } of candidates) {
    try {
      const { config, omitted } = normalize(value, { source, scope, env: variables })
      const sameName = seen.get(sourceName) ?? []
      if (sameName.some(previous => isDeepStrictEqual(previous, config))) {
        skipped.push({ sourceName, ...(scope ? { scope } : {}), reason: 'duplicate definition in this source' })
        continue
      }
      sameName.push(config)
      seen.set(sourceName, sameName)
      const base = nameOf(sourceName)
      let name = base
      for (let index = 2; Object.hasOwn(servers, name); index++) name = `${base.slice(0, 31 - String(index).length)}-${index}`
      servers[name] = config
      rows.push({ name, sourceName, ...(scope ? { scope } : {}), credentials: Object.keys(config.env ?? config.headers).length, omitted })
    } catch (error) {
      skipped.push({ sourceName, ...(scope ? { scope } : {}), reason: error.message })
    }
  }
  return { found: documents.some(Boolean) || issues.length > 0, files: files.map(file => file.path), servers, rows, skipped, issues }
}

/**
 * Build the only MCP summary allowed on the browser and model surfaces.
 * @param {object} scan Result of readMcpSource.
 * @param {Set<string>} existing Configured server names in Jan Next.
 * @returns {object} Names, masked counts, and reasons; no commands, endpoints, or credential values.
 */
export function summarizeMcp(scan, existing) {
  const { rows, skipped, issues, files, found } = scan
  const items = rows.map(row => ({ ...row, status: existing.has(row.name) ? 'already here' : 'ready' }))
  return { found, files, rows: items, names: items.filter(row => row.status === 'ready').map(row => row.name), skipped, issues }
}
