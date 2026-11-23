import { credentialKey, credentialRef } from '@janhq/jan-credentials'
import { beginSignIn, failureReason, hostOf, needsSignIn, signedInTokens, signInFailure } from './mcp-auth.mjs'
import { readFile, stat, realpath, writeFile, rename, unlink } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { registerApi } from '@janhq/jan-plugin-api'
import yaml from 'js-yaml'
import { clearFailure, recordFailure, takeLaunchAudit, trackStart } from './startup-health.mjs'
import { createMcpRegistry } from './mcp-registry.mjs'
import { iconSources } from './registry-icons.mjs'
import { RECOMMENDED_CONNECTORS, installRecommended } from './recommended-connectors.mjs'
import { composioMcpUrl, createComposioSession } from './composio.mjs'

// One registry client per Host process, so its short cache survives settings reloads.
const mcpRegistry = createMcpRegistry()
// Sign-ins outlive a settings reload: the browser may return after Jan reloaded this plugin, so the
// pending flow and the mount that finishes it live at module level.
const pendingSignIns = new Map()
let liveMount

function cancelSignIn(name) {
  const pending = pendingSignIns.get(name)
  pendingSignIns.delete(name)
  pending?.cancel?.()
}

// Hosted servers whose own sign-in does not admit Jan, and the local server that takes the same
// account's personal access token instead.
const TOKEN_ROUTES = {
  'mcp.figma.com': {
    title: 'Figma', env: 'FIGMA_API_KEY',
    help: 'Create one in Figma under Settings, Security, Personal access tokens, with read access to files.',
    helpUrl: 'https://help.figma.com/hc/en-us/articles/8085703771159-Manage-personal-access-tokens',
    command: 'npx', args: ['-y', 'figma-developer-mcp@0.13.2', '--stdio', '--no-telemetry'],
    // The local server accepts any token and fails only when a tool runs, so Jan asks Figma first.
    verify: async (token) => {
      const response = await fetch('https://api.figma.com/v1/me', { headers: { 'X-Figma-Token': token }, signal: AbortSignal.timeout(15_000) })
      if (response.status === 401 || response.status === 403) throw new Error('Figma did not accept this token. Check that you copied all of it and that it has not expired.')
      if (!response.ok) throw new Error(`Figma could not check the token (HTTP ${response.status}). Try again in a moment.`)
      const me = await response.json()
      return me.email ?? me.handle
    },
  },
}

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

function composioServer({ name, enabled = false, transport, url, userId, credentialRef: ref }) {
  if (name !== 'composio' || typeof enabled !== 'boolean' || transport !== 'streamable-http'
    || typeof userId !== 'string' || !/^jan_[a-f0-9-]{36}$/.test(userId)
    || typeof ref !== 'string' || !/^COMPOSIO_API_KEY_[A-F0-9]{32}$/.test(ref)) throw new Error('Invalid Composio connector configuration.')
  return { name, connector: 'composio', enabled, transport, url: composioMcpUrl(url), userId, credentialRef: ref }
}

const composio = row => row?.connector === 'composio'

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
  let host
  try { host = new URL(value.url).hostname } catch { return 'server' }
  // An address or a single-label host such as localhost says nothing about the service.
  if (/^[\d.]+$|^\[|^[^.]+$/.test(host)) return 'local-server'
  return host.split('.').slice(-2, -1)[0] || 'server'
}

// JSON with comments and trailing commas, as VS Code and Zed settings files allow.
function parseLoose(text) {
  try { return JSON.parse(text) } catch { /* try the relaxed form */ }
  // Both passes consume quoted strings whole so commas and comment markers inside them stay literal.
  const stripped = text.replace(/("(?:\\.|[^"\\])*")|\/\/[^\r\n]*|\/\*[\s\S]*?\*\//g, (_match, string) => string ?? ' ')
    .replace(/("(?:\\.|[^"\\])*")|,(\s*)(?=[}\]])/g, (_match, string, space) => string ?? space).trim()
  try { return JSON.parse(stripped) } catch { /* a fragment such as `"name": { ... }` copied out of a larger file */ }
  return JSON.parse(`{${stripped.replace(/^,|,$/g, '')}}`)
}

// A single line that is not JSON: an endpoint URL, or a command such as `npx -y @scope/server`.
function lineServer(text) {
  const line = text.trim()
  if (!line || /[\r\n]/.test(line) || /^[[{"]|^\/[/*]/.test(line)) return undefined
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
      if (composio(row)) { servers.push(composioServer(row)); continue }
      const parsed = server(row)
      servers.push({ ...row, enabled: parsed.enabled, transport: parsed.transport, ...(parsed.url && { url: parsed.url }) })
    } catch (error) {
      skippedServers.push(row)
      ctx.logger.warn(`Skipping invalid MCP server configuration at row ${index + 1}: ${error.message}`)
    }
  }
  // A reload or shutdown cancels starts still in flight; those are not broken servers.
  let live = true
  ctx.effect(() => () => {
    live = false
    for (const timer of refreshTimers.values()) clearTimeout(timer)
  }, 'jan-theme: MCP startup audit')
  // What each server is doing now, for its row: connecting, connected, failed or waiting for sign-in.
  const status = new Map()
  const handles = new Map()
  const refreshTimers = new Map()
  const mcp = await import('@janhq/jan-mcp-client')
  const oauthKey = name => credentialKey('jan-theme', `oauth-${mcpSecretId(name)}`)
  // Unbound legacy grants cannot prove which endpoint authorized them. Require a new sign-in.
  const boundGrant = (row, grant) => grant?.endpoint === row.url ? grant : undefined
  const readGrant = async row => boundGrant(row, (await credentials.readRecord(oauthKey(row.name)))?.payload)
  const acceptsSignIn = (name, endpoint) => servers.some(row => !composio(row) && row.name === name && row.enabled && row.transport === 'streamable-http' && row.url === endpoint)
  for (const [name, pending] of pendingSignIns) {
    if (!acceptsSignIn(name, pending.endpoint)) cancelSignIn(name)
  }
  // Servers start in the background: a slow or broken one must not hold up
  // the rest of Jan. Once every start settles at launch, the failed ones are
  // switched off in one save, so the next launch does not try them again.
  // A server waiting for sign-in is not broken and stays on, showing Sign in.
  async function start(row) {
    clearTimeout(refreshTimers.get(row.name))
    if (!row.enabled) { status.set(row.name, { phase: 'disabled' }); return undefined }
    status.set(row.name, { phase: 'connecting', since: Date.now() })
    let handle
    try {
      let connection
      let signedIn
      if (composio(row)) {
        connection = {
          transport: row.transport, serverName: row.name, url: row.url,
          headers: { 'x-api-key': `\${credential:${row.credentialRef}}` }, expandTemplates: true, followRedirects: false, failOnStartupError: true,
        }
      } else {
        const secret = (await credentials.readRecord(key(row.name)))?.payload ?? {}
        const headers = { ...secret.headers }
        if (row.transport === 'streamable-http' && !Object.keys(headers).some(name => name.toLowerCase() === 'authorization')) {
          const saved = await readGrant(row)
          signedIn = await signedInTokens(row.url, saved, next => credentials.modifyRecord(oauthKey(row.name), current => {
            const grant = boundGrant(row, current?.payload)
            if (grant?.tokens?.access_token === saved.tokens.access_token) return { kind: 'grant', payload: next }
          }))
          if (signedIn) headers.Authorization = `Bearer ${signedIn.accessToken}`
        }
        connection = { ...row, serverName: row.name, env: secret.env ?? {}, headers, failOnStartupError: true }
      }
      if (!live) return undefined
      handle = ctx.plugin(mcp, connection)
      handles.set(row.name, handle)
      await handle
      if (!live || handles.get(row.name) !== handle) return undefined
      status.set(row.name, { phase: 'connected' })
      // Only refreshable grants can renew before expiry; otherwise let the current token finish.
      if (signedIn?.expiresAt !== undefined) {
        const now = Date.now()
        const reconnectAt = signedIn.refreshable ? Math.max(now + 10_000, signedIn.expiresAt - 60_000) : signedIn.expiresAt
        const schedule = () => {
          const delay = reconnectAt - Date.now()
          // Timers beyond Node's maximum delay run almost immediately instead of waiting.
          if (delay > 2_147_483_647) refreshTimers.set(row.name, setTimeout(schedule, 2_147_483_647))
          else refreshTimers.set(row.name, setTimeout(() => { void restart(row.name) }, Math.max(0, delay)))
        }
        schedule()
      }
      return undefined
    } catch (error) {
      if (!live || (handle && handles.get(row.name) !== handle)) return undefined
      if (composio(row)) {
        const [statusCode, message] = needsSignIn(error)
          ? ['composio-invalid-key', 'Composio did not accept the project API key.']
          : ['composio-unavailable', 'Jan could not connect to Composio.']
        status.set(row.name, { phase: 'failed', message, statusCode })
        return { name: row.name, message }
      }
      if (row.transport === 'streamable-http' && needsSignIn(error)) {
        status.set(row.name, { phase: 'needs-auth', message: `${hostOf(row.url)} asks you to sign in before Jan can use it.` })
        return undefined
      }
      status.set(row.name, { phase: 'failed', message: failureReason(error) })
      const cause = error instanceof Error && error.cause instanceof Error ? `\n${error.cause.stack ?? error.cause.message}` : ''
      return { name: row.name, message: (error instanceof Error ? error.stack ?? error.message : String(error)) + cause }
    }
  }
  // One server reconnects without reloading the others; its row shows Connecting meanwhile.
  async function restart(name) {
    const row = servers.find(item => item.name === name)
    if (!row || !live) return
    const previous = handles.get(name)
    handles.delete(name)
    status.set(name, { phase: 'connecting', since: Date.now() })
    await previous?.dispose().catch(() => {})
    await start(row)
  }
  const starts = servers.map(start)
  liveMount = {
    restart, credentials, oauthKey, acceptsSignIn,
    signInFailed: (name, error, signInRefused = false) => {
      const row = servers.find(item => item.name === name)
      if (!composio(row) && row?.transport === 'streamable-http') status.set(name, { phase: 'needs-auth', message: /cancelled/i.test(error?.message ?? '') ? 'Sign-in cancelled.' : signInFailure(row.url, error), signInRefused })
    },
  }
  if (config.skillDirectories?.length) {
    const filesystem = await import('@janhq/jan-skill-filesystem')
    await ctx.plugin(filesystem, { providerName: 'jan-theme-custom', includeDefaultRoots: false, customSkillDirs: config.skillDirectories })
  }
  const signInLabel = (row) => row.transport === 'streamable-http' && TOKEN_ROUTES[hostOf(row.url)]
  const publicRows = async () => Promise.all(servers.map(async row => {
    const tools = ctx.tools.definitions().filter(tool => tool.name.startsWith(`mcp__${row.name}__`)).map(toolInfo)
    const current = status.get(row.name) ?? { phase: 'connecting' }
    const pending = pendingSignIns.get(row.name)
    const signingIn = pending?.endpoint === row.url ? pending : undefined
    const state = !row.enabled ? 'disabled'
      : signingIn ? 'signing-in'
        : tools.length ? 'ready'
          : current.phase === 'connected' ? 'empty' : current.phase
    const managed = composio(row)
    const secret = managed ? undefined : (await credentials.readRecord(key(row.name)))?.payload
    const grant = !managed && row.transport === 'streamable-http' ? await readGrant(row) : undefined
    const signedIn = !!grant?.tokens?.access_token && (grant.expiresAt === undefined || grant.expiresAt > Date.now())
    const secretConfigured = managed
      ? (await credentials.describe(credentialRef(row.credentialRef)).catch(() => undefined))?.configured === true
      : Object.keys(secret?.env ?? {}).length + Object.keys(secret?.headers ?? {}).length > 0
    const { name, enabled, transport } = row
    const endpoint = transport === 'stdio'
      ? { command: row.command, args: row.args, cwd: row.cwd }
      : managed ? {} : { url: row.url }
    const message = state === 'signing-in' ? 'Finish signing in in your browser. Jan connects as soon as you approve.'
      : state === 'ready' ? (tools.length === 1 ? '1 tool available' : `${tools.length} tools available`)
        : state === 'connecting' ? 'Connecting…'
          : state === 'empty' ? 'Connected, but the server offers no tools.'
            : current.message ?? 'Disabled'
    const route = !managed && signInLabel(row)
    return {
      name, enabled, transport, ...endpoint, secretConfigured, signedIn, tools, state, status: message, signInRefused: !!current.signInRefused,
      ...(managed && { connector: row.connector, ...(current.statusCode && { statusCode: current.statusCode }) }),
      ...(signingIn?.url && { signInUrl: signingIn.url }),
      ...(route && { tokenRoute: { title: route.title, help: route.help, helpUrl: route.helpUrl } }),
    }
  }))
  const persist = change => editor.edit(entry, current => ({ ...current, ...change(current) }))
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
  // Config writes reload the plugin. Once the new config is committed, a cleanup
  // failure must not make the successful save look like it failed or leak store details.
  const unsetComposio = async ref => {
    try { await credentials.unset(credentialRef(ref)) }
    catch { ctx.logger.warn('Jan could not remove an unused Composio credential.') }
  }
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
      // A custom same-name row does not count as the managed connector.
      recommended: RECOMMENDED_CONNECTORS.map(item => ({ ...item, installed: servers.some(row => row.name === item.serverName && (item.setup !== 'project-key' || composio(row))) })),
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
    async connectComposio({ apiKey }) {
      const value = typeof apiKey === 'string' ? apiKey.trim() : ''
      if (!/^[!-~]+$/.test(value)) throw new Error('composio-invalid-key')
      const previous = servers.find(row => row.name === 'composio')
      if (!composio(previous) && configuredNames().includes('composio')) throw new Error('composio-name-conflict')
      const userId = previous?.userId ?? `jan_${randomUUID()}`
      const { url } = await createComposioSession(value, userId)
      const ref = credentialRef(`COMPOSIO_API_KEY_${randomUUID().replaceAll('-', '').toUpperCase()}`)
      const row = { name: 'composio', connector: 'composio', enabled: previous?.enabled ?? true, transport: 'streamable-http', url, userId, credentialRef: ref }
      try {
        await credentials.set(ref, value)
        await saveRows(previous ? servers.map(item => item === previous ? row : item) : [...servers, row])
      } catch {
        await unsetComposio(ref)
        throw new Error('composio-save-failed')
      }
      if (previous) await unsetComposio(previous.credentialRef)
      clearFailure('mcp:composio')
      return { saved: true }
    },
    async installRecommended({ id, confirmed }) {
      if (confirmed !== true) throw new Error('Review and confirm the installation first.')
      const item = RECOMMENDED_CONNECTORS.find(row => row.id === id && row.setup === 'local-install')
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
      const existing = servers.find(item => item.name === row.name)
      if (composio(existing)) throw new Error('composio-use-project-key')
      const exists = existing !== undefined
      if (!originalName && exists) throw new Error('That server name already exists. Edit the existing server instead.')
      if (!replaceSecrets && exists) { delete row.env; delete row.headers }
      return saveRows(exists ? servers.map(item => item.name === row.name ? row : item) : [...servers, row])
    },
    async toggle({ name, enabled }) {
      if (typeof enabled !== 'boolean' || !servers.some(row => row.name === name)) throw new Error('Choose an existing MCP server.')
      if (!enabled) cancelSignIn(name)
      const result = await saveRows(servers.map(row => row.name === name ? { ...row, enabled } : row))
      clearFailure(`mcp:${name}`)
      return result
    },
    async remove({ name, confirmed }) {
      const row = servers.find(item => item.name === name)
      if (confirmed !== true || !row) throw new Error('Confirm removal of an existing server.')
      cancelSignIn(name)
      await saveRows(servers.filter(row => row.name !== name))
      if (composio(row)) await unsetComposio(row.credentialRef)
      else {
        await credentials.deleteRecord(key(name))
        await credentials.deleteRecord(oauthKey(name))
      }
      clearFailure(`mcp:${name}`)
      return { saved: true }
    },
    // Try again: reconnect one server in place. The row shows Connecting until the attempt settles.
    reconnect({ name }) {
      if (!servers.some(row => row.name === name && row.enabled)) throw new Error('Choose an enabled MCP server.')
      clearFailure(`mcp:${name}`)
      void restart(name)
      return { started: true }
    },
    // Sign in: returns the page the person opens in their browser; the row waits until it returns.
    async signIn({ name }) {
      const row = servers.find(item => item.name === name)
      if (composio(row)) throw new Error('composio-use-project-key')
      if (!row?.enabled || row.transport !== 'streamable-http') throw new Error('Only enabled remote MCP servers can sign in.')
      cancelSignIn(name)
      const pending = { endpoint: row.url }
      pendingSignIns.set(name, pending)
      const isCurrent = () => pendingSignIns.get(name) === pending && liveMount?.acceptsSignIn(name, pending.endpoint)
      let flow
      try {
        flow = await beginSignIn(pending.endpoint, async record => {
          if (!isCurrent()) return
          const { credentials, oauthKey } = liveMount
          await credentials.modifyRecord(oauthKey(name), () => {
            if (isCurrent()) return { kind: 'grant', payload: { ...record, endpoint: pending.endpoint } }
          })
        })
      } catch (error) {
        if (isCurrent()) {
          pendingSignIns.delete(name)
          ctx.logger.warn(`Sign-in to ${row.url} could not start: ${error instanceof Error ? error.message : String(error)}`)
          liveMount.signInFailed(name, error, true)
        }
        return { started: false }
      }
      pending.url = flow.url
      pending.cancel = flow.cancel
      flow.done.then(
        () => { if (isCurrent()) { pendingSignIns.delete(name); return liveMount.restart(name) } },
        error => { if (isCurrent()) { pendingSignIns.delete(name); liveMount.signInFailed(name, error) } },
      )
      if (!isCurrent()) { flow.cancel(); return { started: false } }
      return { started: true, ...(flow.url && { url: flow.url }) }
    },
    cancelSignIn({ name }) {
      if (pendingSignIns.has(name)) {
        cancelSignIn(name)
        liveMount?.signInFailed(name, new Error('Sign-in cancelled.'))
      }
      return { cancelled: true }
    },
    // An access token instead of signing in: sent as `Authorization: Bearer`, or, for a hosted server
    // with a token route, handed to that route's local server, which replaces the remote endpoint.
    async useToken({ name, token }) {
      const row = servers.find(item => item.name === name)
      if (composio(row)) throw new Error('composio-use-project-key')
      if (!row) throw new Error('Choose an existing MCP server.')
      if (typeof token !== 'string' || !token.trim() || /\s/.test(token.trim())) throw new Error('Paste the access token, without spaces.')
      const value = token.trim()
      const route = row.transport === 'streamable-http' && TOKEN_ROUTES[hostOf(row.url)]
      cancelSignIn(name)
      if (route) {
        // Throws a sentence the row shows when Figma rejects the token, before anything is saved.
        await route.verify(value)
        const local = { name, enabled: true, transport: 'stdio', command: route.command, args: route.args, env: { [route.env]: value }, headers: {} }
        return saveRows(servers.map(item => item.name === name ? local : item))
      }
      const secret = (await credentials.readRecord(key(name)))?.payload ?? {}
      await credentials.modifyRecord(key(name), () => ({ kind: 'grant', payload: { env: secret.env ?? {}, headers: { ...secret.headers, Authorization: `Bearer ${value}` } } }))
      void restart(name)
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
