import { credentialKey } from '@janhq/jan-credentials'
import { readFile, stat, realpath, writeFile, rename, unlink } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { registerApi } from '@janhq/jan-plugin-api'
import yaml from 'js-yaml'
import { clearFailure, recordFailure, takeLaunchAudit, trackStart } from './startup-health.mjs'
import { createMcpRegistry } from './mcp-registry.mjs'
import { iconSources } from './registry-icons.mjs'
import { RECOMMENDED_CONNECTORS, installRecommended } from './recommended-connectors.mjs'

// One registry client per Host process, so its short cache survives settings reloads.
const mcpRegistry = createMcpRegistry()

const plain = value => value && typeof value === 'object' && !Array.isArray(value)
const strings = value => plain(value) && Object.values(value).every(item => typeof item === 'string')
// Server names allow capitals and underscores; credential key segments do not.
// Names that already fit keep `mcp-<name>`, so stored secrets stay where they
// are; the rest go hex-encoded under `mcpx-`, which no plain key can start with.
export const mcpSecretId = name => /^[a-z0-9-]+$/.test(name) ? `mcp-${name}` : `mcpx-${Buffer.from(name).toString('hex')}`
// What Settings shows for one tool: its description and each top-level argument.
const toolInfo = ({ name, description, parameters }) => {
  const properties = plain(parameters?.properties) ? parameters.properties : {}
  const required = new Set(Array.isArray(parameters?.required) ? parameters.required : [])
  return {
    name, description: typeof description === 'string' ? description.trim() : '',
    args: Object.entries(properties).map(([arg, schema]) => ({
      name: arg, required: required.has(arg),
      type: Array.isArray(schema?.type) ? schema.type.join(' | ') : schema?.type ?? (Array.isArray(schema?.enum) ? 'enum' : ''),
      description: typeof schema?.description === 'string' ? schema.description.trim() : '',
    })),
  }
}

function server(input) {
  if (!plain(input)) throw new Error('Enter an MCP server configuration.')
  const { name, transport = input.url ? 'streamable-http' : 'stdio', enabled = false } = input
  if (JSON.stringify(input).includes('${')) throw new Error('Environment-variable interpolation is not supported here. Replace ${...} references with explicit values in the credential fields before saving.')
  if (typeof name !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/.test(name)) throw new Error('Use 1 to 32 letters, numbers, underscores or hyphens for the server name.')
  if (typeof enabled !== 'boolean') throw new Error('Enabled must be true or false.')
  if (transport === 'stdio') {
    if (typeof input.command !== 'string' || !input.command.trim()) throw new Error('Enter the executable command.')
    if (!Array.isArray(input.args ?? []) || !(input.args ?? []).every(value => typeof value === 'string')) throw new Error('Arguments must be a JSON array of strings.')
    if (!strings(input.env ?? {})) throw new Error('Environment must be a JSON object of text values.')
    if (input.cwd && (typeof input.cwd !== 'string' || !isAbsolute(input.cwd))) throw new Error('Working directory must be an absolute path.')
    return { name, enabled, transport, command: input.command.trim(), args: input.args ?? [], ...(input.cwd ? { cwd: input.cwd } : {}), env: input.env ?? {} }
  }
  if (transport !== 'streamable-http') throw new Error('Supported transports: stdio and Streamable HTTP. Legacy SSE requires a compatible adapter.')
  let url
  try { url = new URL(input.url) } catch { throw new Error('Enter a valid HTTP or HTTPS MCP endpoint.') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Use an HTTP or HTTPS endpoint without URL credentials, query secrets or fragments. Put authentication in headers.')
  if (!strings(input.headers ?? {})) throw new Error('Headers must be a JSON object of text values.')
  return { name, enabled, transport, url: url.href, headers: input.headers ?? {} }
}

// Fields other apps write that carry no meaning for Jan: Cursor's `autoApprove`/`alwaysAllow`,
// Claude Code's `timeout`, Zed's `source`/`settings`, VS Code's `dev`/`gallery`/`version`, a free-form description.
const IGNORED = ['autoApprove', 'alwaysAllow', 'timeout', 'description', 'dev', 'source', 'settings', 'gallery', 'version']

function importedServer(name, value) {
  if (!plain(value)) throw new Error(`${name}: expected a server object.`)
  // Zed nests the launch under `command: { path, args, env }`.
  if (plain(value.command)) value = { ...value, command: value.command.path, args: value.command.args ?? value.args, env: value.command.env ?? value.env }
  // Some apps say `serverUrl` (Windsurf) or `httpUrl` (Gemini CLI) for a remote endpoint.
  if (!value.url && (value.serverUrl || value.httpUrl)) value = { ...value, url: value.serverUrl ?? value.httpUrl }
  const allowed = ['command', 'args', 'env', 'cwd', 'url', 'headers', 'type', 'transport', 'disabled', 'enabled', 'serverUrl', 'httpUrl', ...IGNORED]
  const unsupported = Object.keys(value).filter(key => !allowed.includes(key))
  if (unsupported.length) throw new Error(`${name}: unsupported fields ${unsupported.join(', ')}. Review them before importing.`)
  const type = value.transport ?? value.type
  if (type && !['stdio', 'http', 'streamable-http', 'streamableHttp'].includes(type)) throw new Error(`${name}: transport ${type} is unsupported. Legacy SSE is not Streamable HTTP.`)
  if (value.url && value.command) throw new Error(`${name}: choose either a URL or an executable.`)
  const { command, args, env, cwd, url, headers } = value
  return server({
    name: safeName(name), enabled: false, transport: type === 'http' || type === 'streamableHttp' ? 'streamable-http' : type,
    ...(command === undefined ? {} : { command }), ...(args === undefined ? {} : { args }), ...(env === undefined ? {} : { env }),
    ...(cwd === undefined ? {} : { cwd }), ...(url === undefined ? {} : { url }), ...(headers === undefined ? {} : { headers }),
  })
}

// Server names from other apps may hold dots, spaces or `@`; Jan keeps 32 letters, digits, `_` and `-`.
const safeName = name => name.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'server'

// The server map inside whatever a person pastes: Claude Desktop and Cursor (`mcpServers`), VS Code
// (`servers`, also nested under `mcp`), Zed (`context_servers`), the bare map, or one server on its own.
function serverMap(document) {
  for (const value of [document.mcpServers, document.servers, document.mcp?.servers, document.context_servers]) if (plain(value)) return value
  if (typeof document.command === 'string' || plain(document.command) || typeof document.url === 'string') {
    const named = typeof document.name === 'string' ? document.name : undefined
    const { name: _name, ...rest } = document
    return { [named ?? guessName(document)]: rest }
  }
  if (Object.values(document).length > 0 && Object.values(document).every(value => plain(value) && (value.command !== undefined || value.url !== undefined || value.serverUrl !== undefined || value.httpUrl !== undefined))) return document
  return undefined
}

// A name for a pasted lone server: its npm package or its endpoint's host.
function guessName(value) {
  const pkg = (value.args ?? []).find(arg => typeof arg === 'string' && !arg.startsWith('-'))
  if (pkg) {
    // `@playwright/mcp` names the scope; `@modelcontextprotocol/server-github` names the package.
    const [scope, base = scope] = pkg.replace(/(.)@[^@/]*$/, '$1').replace(/^@/, '').split('/')
    const name = base.replace(/^(mcp-server-|server-|mcp-)|(-mcp-server|-mcp)$/g, '')
    return ['mcp', 'server', ''].includes(name) ? scope : name
  }
  try { return new URL(value.url).hostname.split('.').slice(-2, -1)[0] ?? 'server' } catch { return 'server' }
}

// JSON with comments and trailing commas, as VS Code and Zed settings files allow.
function parseLoose(text) {
  try { return JSON.parse(text) } catch { /* try the relaxed form */ }
  const stripped = text.replace(/("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (match, string) => string ?? '').replace(/,(\s*[}\]])/g, '$1').trim()
  try { return JSON.parse(stripped) } catch { /* a fragment such as `"name": { ... }` copied out of a larger file */ }
  return JSON.parse(`{${stripped.replace(/^,|,$/g, '')}}`)
}

// A single line that is not JSON: an endpoint URL, or a command such as `npx -y @scope/server`.
function lineServer(text) {
  const line = text.trim()
  if (!line || line.includes('\n') || /^[[{"]/.test(line)) return undefined
  if (/^https?:\/\//i.test(line)) return { url: line }
  const words = line.match(/"[^"]*"|'[^']*'|\S+/g)?.map(word => word.replace(/^(["'])(.*)\1$/, '$2')) ?? []
  return words.length ? { command: words[0], args: words.slice(1) } : undefined
}

/** The servers in a paste, disabled and with Jan-safe names; throws a sentence saying what is wrong. */
export function imported(text) {
  let document = lineServer(text)
  if (!document) {
    try { document = parseLoose(text) } catch { throw new Error('Paste MCP JSON from Jan, Claude Desktop, Cursor, VS Code, Windsurf or Zed, a command, or an endpoint URL. Codex TOML and plugin manifests are not MCP JSON.') }
  }
  const map = plain(document) ? serverMap(document) : undefined
  if (!map) throw new Error('No MCP servers were found. Paste an object with mcpServers, servers or context_servers, or a single server with a command or url.')
  const rows = Object.entries(map)
  if (!rows.length) throw new Error('No MCP servers were found.')
  const parsed = rows.map(([name, value]) => importedServer(name, value))
  const seen = new Set()
  for (const row of parsed) {
    if (seen.has(row.name)) throw new Error(`Two servers become ${row.name}. Rename one before importing.`)
    seen.add(row.name)
  }
  return parsed
}

export async function mountAgentSettings(ctx, config) {
  const editor = ctx.get('configEditor')
  const entry = ctx.fiber.entry
  const credentials = ctx.get('credentials')
  if (!editor || !entry || !credentials) throw new Error('Agent settings require the profile editor and credential store.')
  const key = name => credentialKey('jan-theme', mcpSecretId(name))
  const configuredServers = config.mcpServers ?? []
  const servers = []
  const skippedServers = []
  for (const [index, row] of configuredServers.entries()) {
    try {
      const parsed = server(row)
      servers.push({ ...row, enabled: parsed.enabled, transport: parsed.transport })
    } catch (error) {
      skippedServers.push(row)
      ctx.logger.warn(`Skipping invalid MCP server configuration at row ${index + 1}: ${error.message}`)
    }
  }
  const status = new Map()
  const mcp = await import('@janhq/jan-mcp-client')
  // Servers start in the background: a slow or broken one must not hold up
  // the rest of Jan. Once every start settles, the failed ones are switched
  // off in one save, so the next launch does not try them again.
  const starts = servers.map(async (row) => {
    if (!row.enabled) { status.set(row.name, 'Disabled'); return undefined }
    try {
      const secret = (await credentials.readRecord(key(row.name)))?.payload ?? {}
      await ctx.plugin(mcp, { ...row, serverName: row.name, env: secret.env ?? {}, headers: secret.headers ?? {}, failOnStartupError: true })
      status.set(row.name, 'Connected at startup')
      return undefined
    } catch (error) {
      status.set(row.name, 'Connection failed. Check the command, endpoint and credentials, then reconnect.')
      const cause = error instanceof Error && error.cause instanceof Error ? `\n${error.cause.stack ?? error.cause.message}` : ''
      return { name: row.name, message: (error instanceof Error ? error.stack ?? error.message : String(error)) + cause }
    }
  })
  if (config.skillDirectories?.length) {
    const filesystem = await import('@janhq/jan-skill-filesystem')
    await ctx.plugin(filesystem, { providerName: 'jan-theme-custom', includeDefaultRoots: false, customSkillDirs: config.skillDirectories })
  }
  const publicRows = async () => Promise.all(servers.map(async row => {
    const tools = ctx.tools.definitions().filter(tool => tool.name.startsWith(`mcp__${row.name}__`)).map(toolInfo)
    const failed = row.enabled && !tools.length && status.get(row.name)?.startsWith('Connection failed')
    const state = !row.enabled ? 'disabled' : tools.length ? 'ready' : failed ? 'failed' : 'empty'
    const secret = (await credentials.readRecord(key(row.name)))?.payload
    const secretConfigured = Object.keys(secret?.env ?? {}).length + Object.keys(secret?.headers ?? {}).length > 0
    const { name, enabled, transport } = row
    const endpoint = transport === 'stdio'
      ? { command: row.command, args: row.args, cwd: row.cwd }
      : { url: row.url }
    return { name, enabled, transport, ...endpoint, secretConfigured, tools, state, status: !enabled ? 'Disabled' : tools.length ? `${tools.length} tools available` : status.get(name) ?? 'No tools available' }
  }))
  const persist = change => editor.edit(entry, current => ({ ...current, ...change(current) }))
  // A reload or shutdown cancels starts still in flight; those are not broken servers.
  let live = true
  ctx.effect(() => () => { live = false }, 'jan-theme: MCP startup audit')
  // After a settings save the row in Settings reports the failure; only launch switches servers off.
  const launch = takeLaunchAudit()
  void trackStart(Promise.all(starts).then(async (results) => {
    const failed = results.filter(Boolean)
    if (!launch || !live || !failed.length) return
    for (const item of failed) recordFailure({ kind: 'mcp', id: item.name, name: item.name, message: item.message, disabled: true })
    const names = new Set(failed.map(item => item.name))
    try {
      // Saving reloads this plugin; the recorded failures outlive the reload.
      await persist(current => ({ mcpServers: (current.mcpServers ?? []).map(row => names.has(row?.name) ? { ...row, enabled: false } : row) }))
    } catch (error) {
      for (const item of failed) recordFailure({ kind: 'mcp', id: item.name, name: item.name, message: `Turning it off failed: ${String(error)}`, disabled: false })
    }
  }))
  const saveRows = async rows => {
    const seen = new Set()
    for (const row of rows) {
      if (seen.has(row.name)) throw new Error(`Duplicate MCP server name: ${row.name}`)
      seen.add(row.name)
    }
    const previous = new Map()
    const sanitized = []
    try {
      for (const row of rows) {
        const { env, headers, ...publicRow } = row
        if (env !== undefined || headers !== undefined) {
          const old = await credentials.readRecord(key(row.name))
          previous.set(row.name, old)
          await credentials.modifyRecord(key(row.name), () => ({ kind: 'grant', payload: { env: env ?? {}, headers: headers ?? {} } }))
        }
        sanitized.push(publicRow)
      }
      await persist(current => {
        if (JSON.stringify(current.mcpServers ?? []) !== JSON.stringify(configuredServers)) throw new Error('MCP settings changed in another window. Reopen this section before saving.')
        return { mcpServers: [...sanitized, ...skippedServers] }
      })
    } catch (failure) {
      for (const [name, old] of previous) {
        if (old) await credentials.modifyRecord(key(name), () => old)
        else await credentials.deleteRecord(key(name))
      }
      throw failure
    }
    return { saved: true }
  }
  // Other Host plugins can import missing servers without passing credentials through an RPC.
  const configuredNames = () => configuredServers.map(row => row?.name).filter(name => typeof name === 'string')
  ctx.provide('janMcpSettings', {
    configuredNames,
    async importMissing(document) {
      const existing = new Set(configuredNames())
      const entries = Object.entries(document)
      const rows = entries.filter(([name]) => !existing.has(name)).map(([name, value]) => importedServer(name, value))
      if (rows.length) await saveRows([...servers, ...rows])
      return { imported: rows.length, already: entries.length - rows.length, names: entries.map(([name]) => name), added: rows.map(row => row.name) }
    },
  })
  const skill = async name => {
    const value = await ctx.skills.get(name)
    if (!value?.path) throw new Error('This skill has no editable instruction file.')
    const path = await realpath(value.path)
    const info = await stat(path)
    if (!info.isFile() || info.size > 1024 * 1024) throw new Error('Only instruction files up to 1 MiB can be edited.')
    return { path, info }
  }
  ctx.effect(() => registerApi(ctx, 'agent-settings', {
    list: async () => ({
      servers: await publicRows(),
      directories: config.skillDirectories ?? [],
      canPickDirectory: ctx.get('directoryPicker')?.capability().kind === 'native',
      skills: await ctx.skills.snapshot(),
      recommended: RECOMMENDED_CONNECTORS.map(item => ({ ...item, installed: servers.some(row => row.name === item.serverName) })),
    }),
    searchRegistry: ({ query, since, cursor } = {}) => mcpRegistry.search({
      query: typeof query === 'string' ? query.slice(0, 200) : '',
      since: since === 'week' || since === 'month' ? since : undefined,
      cursor: typeof cursor === 'string' ? cursor : undefined,
    }),
    registryIcon: async ({ id } = {}) => {
      if (typeof id !== 'string' || id.length > 200) return null
      const recommended = RECOMMENDED_CONNECTORS.find(item => item.id === id)
      const fallback = recommended && iconSources({ websiteUrl: recommended.homepage })
      return await mcpRegistry.icon(recommended ? `recommended:${id}` : id, fallback) ?? null
    },
    async installRecommended({ id, confirmed }) {
      if (confirmed !== true) throw new Error('Review and confirm the installation first.')
      const item = RECOMMENDED_CONNECTORS.find(row => row.id === id)
      if (!item) throw new Error('Choose a recommended connector.')
      if (servers.some(row => row.name === item.serverName)) throw new Error(`${item.title} is already added. Remove it first to install it again.`)
      const profile = ctx.get('profileContext')
      if (!profile?.dir) throw new Error('Recommended connectors need a Jan profile.')
      const installed = await installRecommended(id, { baseDir: join(profile.dir, 'connectors') })
      const row = server(installed.server)
      const skills = await realpath(installed.skillsDirectory)
      await persist(current => {
        if (JSON.stringify(current.mcpServers ?? []) !== JSON.stringify(configuredServers)) throw new Error('MCP settings changed in another window. Reopen this section before installing.')
        const directories = current.skillDirectories ?? []
        return { mcpServers: [...(current.mcpServers ?? []), row], skillDirectories: directories.includes(skills) ? directories : [...directories, skills] }
      })
      return { saved: true }
    },
    async pickDirectory() {
      const capability = ctx.get('directoryPicker')?.capability()
      if (capability?.kind !== 'native') throw new Error('The native folder picker is unavailable. Enter an absolute path instead.')
      return capability.pick()
    },
    async saveServer({ value, originalName, replaceSecrets = false }) {
      const row = server(value)
      if (originalName && originalName !== row.name) throw new Error('Server names are stable. Add a new server to use a different name.')
      const exists = servers.some(item => item.name === row.name)
      if (!originalName && exists) throw new Error('That server name already exists. Edit the existing server instead.')
      if (!replaceSecrets && exists) { delete row.env; delete row.headers }
      return saveRows(exists ? servers.map(item => item.name === row.name ? row : item) : [...servers, row])
    },
    async toggle({ name, enabled }) {
      if (typeof enabled !== 'boolean' || !servers.some(row => row.name === name)) throw new Error('Choose an existing MCP server.')
      const result = await saveRows(servers.map(row => row.name === name ? { ...row, enabled } : row))
      clearFailure(`mcp:${name}`)
      return result
    },
    async remove({ name, confirmed }) {
      if (confirmed !== true || !servers.some(row => row.name === name)) throw new Error('Confirm removal of an existing server.')
      await saveRows(servers.filter(row => row.name !== name))
      await credentials.deleteRecord(key(name))
      clearFailure(`mcp:${name}`)
      return { saved: true }
    },
    // A pasted setup often repeats servers Jan already has; those are listed and left untouched.
    previewImport: ({ text }) => imported(text).map(({ env, headers, ...row }) => ({
      ...row, environmentKeys: Object.keys(env ?? {}), headerKeys: Object.keys(headers ?? {}), exists: servers.some(existing => existing.name === row.name),
    })),
    async importServers({ text, confirmed }) {
      if (confirmed !== true) throw new Error('Review and confirm the MCP import first.')
      const rows = imported(text).filter(row => !servers.some(existing => existing.name === row.name))
      if (!rows.length) throw new Error('Every server in this paste is already in Jan.')
      await saveRows([...servers, ...rows])
      return { saved: true, added: rows.map(row => row.name) }
    },
    async saveDirectories({ directories }) {
      if (!Array.isArray(directories) || !directories.every(path => typeof path === 'string' && isAbsolute(path))) throw new Error('Enter one absolute skill-folder path per line.')
      const resolved = []
      for (const path of directories) {
        const canonical = await realpath(path)
        if (!(await stat(canonical)).isDirectory()) throw new Error('Choose skill directories, not individual files.')
        if (!resolved.includes(canonical)) resolved.push(canonical)
      }
      await persist(() => ({ skillDirectories: resolved }))
      return { saved: true }
    },
    async readSkill({ name }) {
      const { path, info } = await skill(name)
      return { path, text: await readFile(path, 'utf8'), modified: info.mtimeMs }
    },
    async saveSkill({ name, text, modified }) {
      if (typeof text !== 'string' || Buffer.byteLength(text) > 1024 * 1024) throw new Error('Enter a skill instruction file up to 1 MiB.')
      const { path, info } = await skill(name)
      if (info.mtimeMs !== modified) throw new Error('This file changed elsewhere. Reopen it before saving.')
      const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
      const frontmatter = match && yaml.load(match[1])
      if (!plain(frontmatter) || frontmatter.name !== name || typeof frontmatter.description !== 'string' || !frontmatter.description.trim()) throw new Error('Keep YAML frontmatter with the same skill name and a nonempty description.')
      const temp = `${path}.${randomUUID()}.tmp`
      try { await writeFile(temp, text, { flag: 'wx', mode: info.mode }); await rename(temp, path) }
      finally { await unlink(temp).catch(() => { }) }
      return { path, text, modified: (await stat(path)).mtimeMs }
    },
  }), 'jan-theme: MCP and skill management')
}
