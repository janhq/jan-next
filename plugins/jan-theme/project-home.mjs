/** Project overview operations for registered workspaces and their explicitly linked folders. */
import { readFileSync } from 'node:fs'
import { readFile, readdir, lstat, stat, writeFile, rename, unlink, open, mkdir, realpath } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative, sep } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { JSON_SCHEMA, load as loadYaml } from 'js-yaml'
import { registerApi } from '@janhq/jan-plugin-api'
import { mcpToolOrigin } from '@janhq/jan-mcp-client'

const FILES = { instructions: 'AGENTS.md', memory: 'AGENTS.local.md' }
// The instruction loader's own default budget; a larger file would be truncated for the agent.
const MAX_TEXT_BYTES = 65_536
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024
// Base64 expands uploads by a third; leave room for the JSON envelope and file name.
const MAX_REQUEST_BYTES = 34 * 1024 * 1024
const MAX_LISTED = 300
const MAX_CONTEXT_ESTIMATE_BYTES = 4 * 1024 * 1024
const MAX_PREVIEW_BYTES = 4 * 1024 * 1024
const MAX_ICON_BYTES = 256 * 1024
const MAX_LINKS = 32
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const HIDDEN_FILES = new Set(['.git', 'node_modules'])
const EMPTY_SETTINGS = { identity: null, linkedFolders: [] }

/** @param {import('@janhq/cordis').Context} ctx @param {unknown} id */
function getProject(ctx, id) {
  const workspace = typeof id === 'string' ? ctx.get('workspaceRegistry')?.get(id) : undefined
  if (workspace === undefined) throw new Error('This project is no longer registered in Jan.')
  return workspace
}

function within(root, path) {
  const child = relative(root, path)
  return child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child)
}

function projectSettings(ctx) {
  const cache = new Map()
  const pending = new Map()
  const settingsPath = (id) => ctx.get('janHomePath')('project-home', `${createHash('sha256').update(id).digest('hex')}.json`)
  const read = (id) => {
    if (cache.has(id)) return cache.get(id)
    const path = settingsPath(id)
    let value
    try { value = JSON.parse(readFileSync(path, 'utf8')) } catch (error) {
      if (error?.code === 'ENOENT') return EMPTY_SETTINGS
      throw error
    }
    cache.set(id, value)
    return value
  }
  const update = (id, patch) => {
    const task = (pending.get(id) ?? Promise.resolve()).catch(() => { }).then(async () => {
      const next = patch(read(id))
      const path = settingsPath(id)
      await mkdir(dirname(path), { recursive: true })
      await writeAtomic(path, JSON.stringify(next), 0o600)
      cache.set(id, next)
      return next
    })
    pending.set(id, task)
    return task.finally(() => { if (pending.get(id) === task) pending.delete(id) })
  }
  return { read, update }
}

function identityOf(name, color, icon) {
  if (typeof name !== 'string' || name.length > 120) throw new Error('Use a project name of 120 characters or fewer.')
  if (color !== null && (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color))) throw new Error('Choose a valid project color.')
  let parsed = null
  if (icon !== null) {
    if (!icon || typeof icon.value !== 'string') throw new Error('Choose a project icon.')
    if (icon.kind === 'emoji') {
      const value = icon.value.trim()
      const graphemes = new Intl.Segmenter().segment(value)[Symbol.iterator]()
      if (value.length > 32 || !/[\p{Extended_Pictographic}\p{Regional_Indicator}\u20e3]/u.test(value) || graphemes.next().done || !graphemes.next().done) throw new Error('Enter one emoji.')
      parsed = { kind: 'emoji', value }
    } else if (icon.kind === 'png') {
      if (icon.value.length > Math.ceil(MAX_ICON_BYTES / 3) * 4) throw new Error('Choose a PNG under 256 KB.')
      const bytes = Buffer.from(icon.value, 'base64')
      if (bytes.length < 33 || bytes.length > MAX_ICON_BYTES || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)
        || bytes.toString('ascii', 12, 16) !== 'IHDR' || ![16, 20].every(offset => bytes.readUInt32BE(offset) > 0 && bytes.readUInt32BE(offset) <= 2048)) {
        throw new Error('Choose a PNG under 256 KB and at most 2048 pixels wide and tall.')
      }
      parsed = { kind: 'png', value: bytes.toString('base64') }
    } else if (icon.kind === 'favicon') {
      const value = icon.value.trim().toLowerCase()
      if (value.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])$/i.test(value)) throw new Error('Enter a domain such as example.com.')
      parsed = { kind: 'favicon', value }
    } else throw new Error('Choose a project icon.')
  }
  return { name: name.trim(), color: color?.toLowerCase() ?? null, icon: parsed }
}

async function contextPath(workspace, settings, folderId, parts = []) {
  if (!Array.isArray(parts) || parts.length > 128 || parts.some(part => typeof part !== 'string' || !part || part === '.' || part === '..' || /[\\/\0:]/.test(part) || HIDDEN_FILES.has(part))) {
    throw new Error('Choose a file or folder inside this project.')
  }
  const linked = folderId === undefined ? undefined : settings.read(workspace.id).linkedFolders.find(folder => folder.id === folderId)
  if (folderId !== undefined && linked === undefined) throw new Error('This folder is no longer linked.')
  const root = await realpath(linked?.path ?? workspace.path)
  // Replacing a linked directory with a symlink must not grant access to its new target.
  if (linked !== undefined && relative(linked.path, root) !== '') throw new Error('This linked folder moved. Remove it and link it again.')
  const target = await realpath(join(root, ...parts))
  if (!within(root, target)) throw new Error('This item points outside the selected folder.')
  return target
}

const IMAGE_TYPES = new Map(Object.entries({ '.avif': 'avif', '.gif': 'gif', '.ico': 'x-icon', '.jpeg': 'jpeg', '.jpg': 'jpeg', '.png': 'png', '.svg': 'svg+xml', '.webp': 'webp', '.bmp': 'bmp' }))
const LANGUAGES = { '.cjs': 'javascript', '.mjs': 'javascript', '.ts': 'typescript', '.js': 'javascript', '.py': 'python', '.rb': 'ruby', '.sh': 'bash', '.yml': 'yaml', '.htm': 'html', '.h': 'c', '.cc': 'cpp', '.rs': 'rust' }
const CONTEXT_TEXT_EXTENSIONS = new Set([
  ...Object.keys(LANGUAGES), '.bash', '.c', '.cfg', '.conf', '.cpp', '.cs', '.css', '.csv', '.go', '.hpp', '.html', '.ini',
  '.java', '.json', '.jsonc', '.jsonl', '.jsx', '.kt', '.log', '.lua', '.markdown', '.md', '.mdx', '.php', '.ps1', '.rst',
  '.sass', '.scss', '.sql', '.svg', '.swift', '.toml', '.tsv', '.tsx', '.txt', '.xml', '.yaml', '.zsh',
])
const CONTEXT_TEXT_NAMES = new Set(['.editorconfig', '.gitattributes', '.gitignore', '.npmrc', 'dockerfile', 'license', 'makefile', 'readme'])

// Use one token per four UTF-8 bytes for both rail estimates; no model tokenizer is selected here.
const tokensFromBytes = byteCount => Math.ceil(byteCount / 4)

async function readPreview(target) {
  // Check before open as well as after it, so a directory or FIFO is never treated as a document.
  if (!(await stat(target)).isFile()) throw new Error('Choose a regular file to preview.')
  const handle = await open(target, 'r')
  try {
    const info = await handle.stat()
    if (info.size > MAX_PREVIEW_BYTES) throw new Error('Files over 4 MB cannot be previewed here.')
    // Read into a buffer of the checked size, so a file that grows after stat stays bounded.
    const { buffer, bytesRead } = await handle.read({ buffer: Buffer.alloc(info.size), position: 0 })
    const bytes = buffer.subarray(0, bytesRead)
    const suffix = extname(target).toLowerCase()
    const image = IMAGE_TYPES.get(suffix)
    if (image !== undefined) return { kind: 'image', url: `data:image/${image};base64,${bytes.toString('base64')}` }
    if (/\.(md|mdx|markdown)$/.test(suffix)) return { kind: 'markdown', text: decodeText(bytes) }
    return { kind: 'code', text: decodeText(bytes), lang: LANGUAGES[suffix] ?? suffix.slice(1) }
  } finally { await handle.close() }
}

function decodeText(bytes) {
  try {
    if (bytes.includes(0)) throw new Error()
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch { throw new Error('This file is not UTF-8 text or a supported image.') }
}

// VS Code uses JSON with comments and trailing commas; retain all quoted strings verbatim.
const jsonc = (text) => JSON.parse(text
  .replace(/"(?:\\.|[^"\\])*"|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g, token => token.startsWith('"') ? token : '')
  .replace(/"(?:\\.|[^"\\])*"|,(?=\s*[}\]])/g, token => token.startsWith('"') ? token : ''))

// Rows name files under the project path as the user sees it; containment is
// checked against its resolved path, since a temp or symlinked root resolves elsewhere.
async function readInventory(ctx, root) {
  const real = await realpath(root)
  const inventory = { skills: [], mcp: [], plugins: [], errors: {} }
  const add = (kind, name, path, loaded = false) => inventory[kind].push({ name, path, loaded })
  const scan = async (kind, path, operation) => {
    try { await operation() } catch (error) {
      if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') (inventory.errors[kind] ??= []).push(path)
    }
  }
  const parse = async (path, parser) => {
    const source = await realpath(path)
    if (!within(real, source) || !(await stat(source)).isFile()) return null
    return parser(await readFile(source, 'utf8'))
  }
  function addCordisRows(rows, path) {
    if (!Array.isArray(rows)) return
    for (const row of rows) {
      if (typeof row?.name === 'string') add('plugins', row.name, path)
      if (Array.isArray(row?.insert)) addCordisRows(row.insert, path)
      if (Array.isArray(row?.children)) addCordisRows(row.children, path)
    }
  }
  await Promise.all([
    scan('skills', root, async () => {
      for (const skill of await ctx.get('skills')?.list({ cwd: root }) ?? []) {
        if (skill.path && (skill.source === 'project-jan' || skill.source === 'project-agents')) add('skills', skill.name, skill.path, true)
      }
    }),
    ...['.claude/skills', 'skills'].map(dir => {
      const base = join(root, dir)
      return scan('skills', base, async () => {
        if (!within(real, await realpath(base))) return
        for (const entry of await readdir(base, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue
          const path = join(base, entry.name, 'SKILL.md')
          const actual = await realpath(path).catch(error => { if (error?.code !== 'ENOENT') throw error })
          if (actual && within(real, actual) && (await stat(actual)).isFile()) add('skills', entry.name, path)
        }
      })
    }),
    ...['.mcp.json', '.cursor/mcp.json', '.vscode/mcp.json'].map(name => {
      const path = join(root, name)
      return scan('mcp', path, async () => {
        const doc = await parse(path, jsonc)
        const servers = name === '.vscode/mcp.json' ? doc?.servers : doc?.mcpServers
        if (!servers || typeof servers !== 'object' || Array.isArray(servers)) throw new Error('Missing server map')
        for (const key of Object.keys(servers)) add('mcp', key, path)
      })
    }),
    scan('plugins', join(root, 'package.json'), async () => {
      const path = join(root, 'package.json')
      const manifest = await parse(path, JSON.parse)
      const bundles = (manifest?.jan ?? manifest?.dsh)?.profile?.bundles
      if (Array.isArray(bundles)) for (const name of bundles) if (typeof name === 'string') add('plugins', name, path)
    }),
    ...['cordis.yml', 'cordis.patch.yml'].map(name => {
      const path = join(root, name)
      return scan('plugins', path, async () => {
        const doc = await parse(path, text => loadYaml(text, { schema: JSON_SCHEMA }))
        addCordisRows(doc, path)
      })
    }),
  ])
  for (const kind of ['skills', 'mcp', 'plugins']) {
    inventory[kind].sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path))
  }
  return inventory
}

const emptyUsage = () => ({ inputTokens: 0, outputTokens: 0, workingMs: 0, cost: null })

function sessionUsage({ events, inheritedEventCount }) {
  const totals = emptyUsage()
  let started, activeTurn, last
  // Forks carry history already billed to their parent. Observe only the events they own.
  for (let i = inheritedEventCount; i < events.length; i++) {
    const { type, time, data } = events[i]
    if (type === 'turn/start') { started = time; activeTurn = data.turn }
    if (type === 'turn/end' && activeTurn === data.turn && started !== undefined) {
      totals.workingMs += Math.max(0, time - started)
      started = undefined
    }
    if (type === 'llm/retry-started' && last?.turn === data.turn && last.step === data.step) last = undefined
    if (type !== 'assistant/message' && type !== 'assistant/attempt') continue
    // Durable stream records wrap provider chunks: { type: 'chunk', chunk: { type: 'usage', usage } }.
    const usage = (type === 'assistant/message' ? data.usage : undefined)
      ?? data.stream?.findLast(record => record.type === 'chunk' && record.chunk?.type === 'usage')?.chunk.usage
    if (usage === undefined) continue
    const input = usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
    const output = usage.outputTokens
    const previous = last?.turn === data.turn && last.step === data.step ? last : undefined
    totals.inputTokens += input - (previous?.input ?? 0)
    totals.outputTokens += output - (previous?.output ?? 0)
    last = { turn: data.turn, step: data.step, input, output }
  }
  // The durable TokenUsage contract does not store a monetary amount.
  return totals
}

function usageReader(ctx) {
  const cache = new Map()
  const read = async (id) => {
    const query = ctx.get('sessionQuery')
    if (!query) throw new Error('Session usage is unavailable.')
    const observation = await query.observeSession(id, { projectionMode: 'none' })
    try {
      const previous = cache.get(id)
      const { cursor, revision, source } = observation
      const usage = previous?.cursor === cursor && previous.revision === revision && previous.source === source
        ? previous.usage : sessionUsage(observation)
      cache.delete(id)
      if (cache.size >= 1024) cache.delete(cache.keys().next().value)
      cache.set(id, { cursor, revision, source, usage })
      return usage
    } finally { observation[Symbol.dispose]() }
  }
  return async (workspace) => {
    const ids = workspace.sessionIds ?? []
    const result = { ...emptyUsage(), skipped: 0 }
    for (let i = 0; i < ids.length; i += 4) {
      const batch = await Promise.allSettled(ids.slice(i, i + 4).map(read))
      for (const entry of batch) {
        if (entry.status === 'rejected') { result.skipped++; continue }
        result.inputTokens += entry.value.inputTokens
        result.outputTokens += entry.value.outputTokens
        result.workingMs += entry.value.workingMs
      }
    }
    return result
  }
}

async function readText(path) {
  try { return await readFile(path, 'utf8') } catch (error) {
    if (error?.code === 'ENOENT') return ''
    throw error
  }
}

/** The file's modification time, or null while it does not exist; the editor's save precondition. */
async function modifiedAt(path) {
  try { return (await stat(path)).mtimeMs } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

function textFile(ctx, workspaceId, kind) {
  const file = Object.hasOwn(FILES, kind) ? FILES[kind] : undefined
  if (file === undefined) throw new Error('Choose instructions or memory.')
  return join(getProject(ctx, workspaceId).path, file)
}

/** Replace a file through a temporary sibling, so a failed write never leaves half a file. */
async function writeAtomic(path, text, mode) {
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, text, { encoding: 'utf8', mode, flag: 'wx' })
    await rename(temporary, path)
  } catch (error) {
    await unlink(temporary).catch(() => { /* The temporary file may never have been created. */ })
    throw error
  }
}

async function listFiles(root, summarize = false) {
  const entries = await readdir(root, { withFileTypes: true })
  const visible = entries.filter(entry => !HIDDEN_FILES.has(entry.name))
    .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
  let contextBytes = 0
  const rows = await Promise.all(visible.slice(0, MAX_LISTED).map(async (entry) => {
    const directory = entry.isDirectory()
    let size
    let modified
    try {
      const info = await lstat(join(root, entry.name))
      // Only estimate listed regular files with known text names, using their existing stat sizes.
      if (summarize && info.isFile() && info.size <= MAX_CONTEXT_ESTIMATE_BYTES
        && (CONTEXT_TEXT_EXTENSIONS.has(extname(entry.name).toLowerCase()) || CONTEXT_TEXT_NAMES.has(entry.name.toLowerCase()))) {
        contextBytes += info.size
      }
      size = directory ? undefined : info.size
      modified = info.mtimeMs
    } catch (error) {
      // A file removed or locked between readdir and stat is still listed, without details.
      if (error?.code !== 'ENOENT' && error?.code !== 'EPERM' && error?.code !== 'EBUSY') throw error
    }
    return { name: entry.name, directory, size, modified }
  }))
  return {
    files: rows, truncated: visible.length > MAX_LISTED,
    ...(summarize && { contextSummary: {
      fileCount: visible.reduce((count, entry) => count + Number(entry.isFile()), 0),
      estimatedTokens: tokensFromBytes(contextBytes),
    } }),
  }
}


function git(root, args) {
  return new Promise((resolve) => {
    // No Git, not a repository, no remote: each reads as "not detected" rather than an error.
    execFile('git', ['-C', root, ...args], { timeout: 3000, windowsHide: true }, (error, stdout) => {
      resolve(error ? undefined : stdout.trim() || undefined)
    })
  })
}

/**
 * A remote URL as a browsable repository: scp-like `git@host:owner/repo.git`, `ssh://` and `https://`.
 * @returns {{ host: string, name: string, url: string, github: boolean } | null}
 */
export function repositoryOf(remote) {
  const match = /^(?:[\w+.-]+:\/\/)?(?:[^@/]+@)?([^/:]+)(?::\d+)?[:/](.+?)(?:\.git)?\/?$/.exec(remote)
  if (match === null) return null
  const [, host, name] = match
  if (host === undefined || !/^[\w.-]+$/.test(host) || !/^[\w.-]+(?:\/[\w.-]+)+$/.test(name)) return null
  return { host, name, url: `https://${host}/${name}`, github: host.toLowerCase() === 'github.com' }
}

/** The checked-out branch and origin repository, or null outside a Git work tree. */
async function gitInfo(root) {
  if (await git(root, ['rev-parse', '--is-inside-work-tree']) !== 'true') return null
  const [branch, remote] = await Promise.all([git(root, ['branch', '--show-current']), git(root, ['remote', 'get-url', 'origin'])])
  return { branch: branch ?? null, repository: remote === undefined ? null : repositoryOf(remote) }
}

const CORE_TOOLS = new Set(['apply_patch', 'bash', 'edit', 'glob', 'grep', 'read', 'read_image', 'str_replace_editor', 'subagent', 'todo_write', 'write'])

function mcpState(state) {
  switch (state) {
    case 'ready': case 'connected': return 'connected'
    case 'needs-auth': case 'signing-in': case 'waiting-credentials': return 'auth'
    case 'connecting': case 'reconnecting': return 'connecting'
    case 'empty': return 'emptyServer'
    default: return 'unavailable'
  }
}

/** Short display name of a plugin: `@janhq/jan-tool-image` -> `tool-image`. */
function pluginLabel(owner) {
  return owner.replace(/^@[^/]+\//, '').replace(/^jan-/, '')
}

async function projectToolRows(ctx, scoped, address) {
  const { mcpServers, tools } = await scoped.toolCatalog()
  const globalOff = new Set(scoped.read({ scope: 'global' }).toolsDisabled)
  const projectOff = new Set(scoped.read(address).toolsDisabled)
  const groups = { mcp: [], connectors: [], plugins: [] }
  const available = new Map(mcpServers.map(name => [name, { name, state: 'connected' }]))
  const toolsByServer = new Map()
  for (const definition of ctx.get('tools')?.definitions() ?? []) {
    const origin = mcpToolOrigin(definition)
    if (origin === undefined) continue
    const names = toolsByServer.get(origin.serverName) ?? []
    names.push(definition.name)
    toolsByServer.set(origin.serverName, names)
  }
  for (const { name, configured, status } of ctx.get('mcpManager')?.list() ?? []) {
    if (configured) available.set(name, { name, state: status.state })
  }
  for (const row of ctx.get('janMcpSettings')?.projectTools() ?? []) available.set(row.name, row)

  const add = (group, id, name, status, globallyOff, entries, inheritedOff = false) => {
    const enabled = !globallyOff && !inheritedOff && entries.some(entry => !globalOff.has(entry) && !projectOff.has(entry))
    groups[group].push({ id, name, status, globallyOff, enabled, entries, inheritedOff })
  }
  for (const { name, title = name, connector, state, tools: names } of available.values()) {
    const namespace = `mcp:${name}`
    const registered = names ?? toolsByServer.get(name) ?? []
    const globallyOff = state === 'disabled' || globalOff.has(namespace) || (registered.length !== 0 && registered.every(tool => globalOff.has(tool)))
    add(connector ? 'connectors' : 'mcp', name, title, mcpState(state), globallyOff, connector ? registered : [namespace], connector && projectOff.has(namespace))
  }
  // One row per registering package; a tool whose owner is unknown stands alone.
  const registry = ctx.get('tools')
  const ownerByTool = new Map()
  const lease = await ctx.get('agentPresets')?.acquireScope().catch(() => undefined)
  try {
    for (const definition of [...registry?.definitions() ?? [], ...lease === undefined ? [] : registry?.definitions(lease.key) ?? []]) {
      ownerByTool.set(definition.name, registry.ownerOf?.(definition))
    }
  } finally {
    await lease?.[Symbol.asyncDispose]()
  }
  const byOwner = new Map()
  for (const name of tools) {
    if (CORE_TOOLS.has(name) || name.startsWith('web_')) continue
    const owner = ownerByTool.get(name) ?? name
    byOwner.set(owner, [...byOwner.get(owner) ?? [], name])
  }
  for (const [owner, names] of byOwner) {
    add('plugins', owner, pluginLabel(owner), 'available', names.every(name => globalOff.has(name)), names)
  }
  for (const rows of Object.values(groups)) rows.sort((a, b) => a.name.localeCompare(b.name))
  return groups
}

const SKILLS_READ = 'project_skills_read'
const SKILLS_CHANGE = 'project_skills_change'
const renderMessage = (_args, value) => [{ type: 'text', text: typeof value?.message === 'string' ? value.message : JSON.stringify(value) }]

/**
 * Register the agent's project skill tools: a read of the folders and skills its chat's project loads,
 * and an approved change of the same switches as the project page. A chat outside a project gets a refusal.
 */
function registerSkillTools(scope, projectSkills) {
  const projectOf = (agent) => {
    const workspace = agent === undefined ? undefined : projectSkills.projectOf(agent)
    if (workspace === undefined) throw new Error('This chat is not in a Jan project, so it has no project skill switches.')
    return workspace
  }
  const prepared = new WeakMap()
  const plan = async (args, agent) => {
    if (args === null || typeof args !== 'object' || typeof args.enabled !== 'boolean'
      || (typeof args.folder === 'string') === (typeof args.skill === 'string')) {
      throw new Error('Name one skill or one folder path from project_skills_read, and whether to turn it on.')
    }
    const workspace = projectOf(agent)
    const { folders } = await projectSkills.list(workspace, agent)
    const state = args.enabled ? 'on' : 'off'
    if (typeof args.folder === 'string') {
      const folder = folders.find(entry => entry.path !== null && relative(entry.path, args.folder) === '')
      if (folder === undefined) throw new Error(`No skill folder ${JSON.stringify(args.folder)} is loaded in this project. Read the list again.`)
      if (args.enabled && folder.offAt !== undefined) throw new Error(`Skills from ${folder.label} are off in global settings, so this project cannot turn them on.`)
      return {
        workspace, kind: 'folder', target: folder.path, unchanged: folder.enabled === args.enabled, enabled: args.enabled,
        reason: `Turn ${state} skills from ${folder.label} (${folder.skills.length}) in project ${basename(workspace.path)}?`
      }
    }
    const candidates = folders.flatMap(folder => folder.skills).filter(entry => entry.name === args.skill)
    const skill = candidates.find(entry => entry.offAt === undefined) ?? candidates[0]
    if (skill === undefined) throw new Error(`No skill named ${JSON.stringify(args.skill)} is loaded in this project. Read the list again.`)
    if (args.enabled && skill.offAt !== undefined) throw new Error(`${skill.name} is off in global settings, so this project cannot turn it on.`)
    return {
      workspace, kind: 'skill', target: skill.name, unchanged: skill.enabled === args.enabled, enabled: args.enabled,
      reason: `Turn ${state} skill ${skill.name} in project ${basename(workspace.path)}?`
    }
  }
  scope.effect(function*() {
    yield scope.tools.register({
      name: SKILLS_READ,
      description: 'List the skill folders and skills this chat\'s Jan project loads, with the project\'s on/off switches. Use it before project_skills_change. Switches apply to this project only and never change skill files. An entry marked "off globally" is switched off in global settings and cannot be turned on per project.',
      parameters: {
        type: 'object', additionalProperties: false, properties: {
          folder: { type: 'string', description: 'Optional folder path from an earlier read; adds each skill\'s description for that folder.' },
        }
      },
      output: { schema: {}, render: renderMessage },
      async execute(args, exec) {
        try {
          const { folders } = await projectSkills.list(projectOf(exec.agent), exec.agent)
          return {
            folders: folders.map(folder => {
              const detail = typeof args?.folder === 'string' && folder.path !== null && relative(folder.path, args.folder) === ''
              return {
                path: folder.path, label: folder.label, enabled: folder.enabled, ...folder.offAt === undefined ? {} : { offGlobally: true },
                skills: folder.skills.map(skill => detail
                  ? { name: skill.name, enabled: skill.enabled, ...skill.offAt === undefined ? {} : { offGlobally: true }, description: skill.description }
                  : `${skill.name}${skill.offAt !== undefined ? ' (off globally)' : skill.enabled ? '' : ' (off)'}`)
              }
            })
          }
        } catch (error) {
          return { message: error instanceof Error ? error.message : String(error) }
        }
      },
      presentCall: () => ({ card: 'generic', title: 'Read project skills', kind: 'search' }),
    })
    yield scope.tools.register({
      name: SKILLS_CHANGE,
      description: 'Turn one skill or one skill folder on or off for this chat\'s Jan project, with one approval. These are the switches on the project page: other projects and the skill files are unchanged. The change applies from the next step in this project\'s chats.',
      parameters: {
        type: 'object', additionalProperties: false, required: ['enabled'], properties: {
          skill: { type: 'string', description: 'Skill name from project_skills_read. Give skill or folder, not both.' },
          folder: { type: 'string', description: 'Folder path from project_skills_read.' },
          enabled: { type: 'boolean', description: 'true turns it on, false turns it off.' },
        }
      },
      output: { schema: { type: 'object', additionalProperties: false, required: ['ok', 'message'], properties: { ok: { type: 'boolean' }, message: { type: 'string' } } }, render: renderMessage },
      async execute(_args, exec) {
        const change = prepared.get(exec)
        prepared.delete(exec)
        if (change === undefined) return { ok: false, message: 'Nothing changed. The request did not pass the approval gate.' }
        const state = change.enabled ? 'on' : 'off'
        if (change.unchanged) return { ok: true, message: `No change. ${change.target} is already ${state} in this project.` }
        try {
          exec.signal.throwIfAborted()
          if (change.kind === 'folder') await projectSkills.setFolder(change.workspace, change.target, change.enabled)
          else await projectSkills.setSkill(change.workspace, change.target, change.enabled)
        } catch (error) {
          return { ok: false, message: `Nothing changed. ${error instanceof Error ? error.message : String(error)}` }
        }
        return { ok: true, message: `Turned ${state} ${change.target} in this project. The skill list updates from the next step; see the Skills card on the project page.` }
      },
      presentCall: args => ({ card: 'generic', title: args?.enabled === false ? 'Turn off project skill' : 'Turn on project skill', kind: 'edit' }),
    })
    yield scope.on('tools/pre-execute', async (exec, next) => {
      const decision = await next()
      if (exec.name !== SKILLS_CHANGE || (decision.kind !== 'allow' && decision.kind !== 'ask')) return decision
      try {
        const change = await plan(exec.arguments, exec.agent)
        prepared.set(exec, change)
        if (change.unchanged) return { kind: 'allow' }
        const approval = scope.get('approval')
        if (decision.kind === 'allow' && exec.agent && approval
          && (approval.overrideOf(exec.agent.session) ?? approval.config.policy ?? 'ask') === 'never') return decision
        return { kind: 'ask', reason: change.reason }
      } catch (error) {
        return { kind: 'deny', reason: `Nothing changed. ${error instanceof Error ? error.message : String(error)}` }
      }
    })
  }, 'jan-theme: project skill tools')
}

/** @param {import('@janhq/cordis').Context} ctx */
export function mountProjectHome(ctx) {
  const settings = projectSettings(ctx)
  const readUsage = usageReader(ctx)
  // Project skill switches are the project layer of scoped settings, which also filters every skill lookup.
  const scoped = () => {
    const service = ctx.get('scopedSettings')
    if (service === undefined) throw new Error('Project switches are not available in this Jan build.')
    return service
  }
  const enabled = entry => !entry.off && entry.offAt === undefined
  // One implementation behind the project page switches and the agent's skill tools.
  const projectSkills = {
    projectOf(agent) {
      const id = ctx.get('scopedSettings')?.projectOf(agent.id, agent.session.header.cwd)
      return id === undefined ? undefined : ctx.get('workspaceRegistry')?.get(id)
    },
    async list(workspace, agent) {
      const settings = scoped()
      const { folders } = await (agent === undefined
        ? settings.skillCatalog({ scope: 'project', id: workspace.id })
        : settings.skillCatalogForProject(workspace.id, agent))
      return {
        folders: folders.map(folder => ({
          path: folder.path, label: folder.label, enabled: enabled(folder), ...folder.offAt === undefined ? {} : { offAt: folder.offAt },
          skills: folder.skills.map(skill => ({
            name: skill.name, description: skill.description, enabled: enabled(skill), ...skill.offAt === undefined ? {} : { offAt: skill.offAt },
          })),
        })),
      }
    },
    async setFolder(workspace, path, on) {
      if (typeof path !== 'string' || !isAbsolute(path) || typeof on !== 'boolean') throw new Error('Choose a skill folder to turn on or off.')
      return (await scoped().setSwitch({ scope: 'project', id: workspace.id }, 'skillFoldersDisabled', path, !on)).skillFoldersDisabled ?? []
    },
    async setSkill(workspace, name, on) {
      if (typeof name !== 'string' || name === '' || typeof on !== 'boolean') throw new Error('Choose a skill to turn on or off.')
      return (await scoped().setSwitch({ scope: 'project', id: workspace.id }, 'skillsDisabled', name, !on)).skillsDisabled ?? []
    },
  }
  ctx.inject(['tools'], (scope) => { registerSkillTools(scope, projectSkills) })
  ctx.inject(['systemPrompt'], (scope) => {
    scope.systemPrompt.context({
      name: 'jan-theme:project-linked-folders', order: 500, required: true, interpolate: false,
      text: ({ agent }) => {
        const cwd = agent?.session.header.cwd
        if (cwd === undefined) return ''
        const workspace = ctx.get('workspaceRegistry')?.list().find(candidate => relative(candidate.path, cwd) === '')
        if (!workspace) return ''
        const folders = settings.read(workspace.id).linkedFolders
        if (folders.length === 0) return ''
        return `User-linked reference folders for this project (absolute paths): ${JSON.stringify(folders.map(folder => folder.path))}. Inspect relevant files when needed using normal tool permissions. Linking does not grant access or preload file contents.`
      },
    })
  })
  ctx.effect(() => registerApi(ctx, 'project-home', {
    async read({ workspaceId }) {
      const { id, path: root } = getProject(ctx, workspaceId)
      const [instructions, memory, listing, gitState, inventory] = await Promise.all([
        readText(join(root, FILES.instructions)), readText(join(root, FILES.memory)), listFiles(root, true), gitInfo(root),
        readInventory(ctx, root),
      ])
      return { path: root, instructions, memory, ...listing, git: gitState, inventory, ...settings.read(id) }
    },
    browse: async ({ workspaceId, folderId, parts }) => listFiles(await contextPath(getProject(ctx, workspaceId), settings, folderId, parts)),
    preview: async ({ workspaceId, folderId, parts }) => readPreview(await contextPath(getProject(ctx, workspaceId), settings, folderId, parts)),
    usage: ({ workspaceId }) => readUsage(getProject(ctx, workspaceId)),
    /** Every skill a chat in this project could see, grouped by folder, with this project's switches. */
    async skills({ workspaceId, rescan }) {
      const workspace = getProject(ctx, workspaceId)
      if (rescan === true) ctx.get('skills')?.refresh()
      const { folders } = await projectSkills.list(workspace)
      let active = 0
      let total = 0
      let bytes = 0
      for (const folder of folders) {
        total += folder.skills.length
        if (!folder.enabled) continue
        for (const skill of folder.skills) {
          if (!skill.enabled) continue
          active++
          // Estimate full catalog rows (name and summary), not the bodies loaded on demand.
          bytes += Buffer.byteLength(skill.name) + Buffer.byteLength(skill.description) + 7 // Markdown and newline.
        }
      }
      return { folders, active, total, estimatedTokens: tokensFromBytes(bytes) }
    },
    setSkillFolder: ({ workspaceId, path, enabled }) => projectSkills.setFolder(getProject(ctx, workspaceId), path, enabled),
    setSkill: ({ workspaceId, name, enabled }) => projectSkills.setSkill(getProject(ctx, workspaceId), name, enabled),
    /** The live MCP, connector and plugin tools available to a project. */
    async tools({ workspaceId }) {
      const { id } = getProject(ctx, workspaceId)
      const groups = await projectToolRows(ctx, scoped(), { scope: 'project', id })
      return Object.fromEntries(Object.entries(groups).map(([group, rows]) => [group,
        rows.map(({ entries, inheritedOff, ...row }) => ({ ...row, canToggle: entries.length !== 0 && !inheritedOff })),
      ]))
    },
    async setTool({ workspaceId, group, id, enabled }) {
      const workspace = getProject(ctx, workspaceId)
      if (!['mcp', 'connectors', 'plugins'].includes(group) || typeof id !== 'string' || typeof enabled !== 'boolean') throw new Error('Choose a tool to turn on or off.')
      const address = { scope: 'project', id: workspace.id }
      const service = scoped()
      const row = (await projectToolRows(ctx, service, address))[group].find(candidate => candidate.id === id)
      if (!row || row.globallyOff || row.inheritedOff || row.entries.length === 0) throw new Error('This tool cannot be changed here. Refresh or check global settings.')
      for (const entry of row.entries) await service.setSwitch(address, 'toolsDisabled', entry, !enabled)
    },
    async linkFolder({ workspaceId, path }) {
      const workspace = getProject(ctx, workspaceId)
      if (typeof path !== 'string' || !isAbsolute(path)) throw new Error('Choose an external folder.')
      const [root, target] = await Promise.all([realpath(workspace.path), realpath(path)])
      if (within(root, target)) throw new Error('This folder is already inside the project.')
      if (!(await stat(target)).isDirectory()) throw new Error('Choose an external folder.')
      const { linkedFolders } = await settings.update(workspace.id, current => {
        if (current.linkedFolders.some(folder => relative(folder.path, target) === '')) throw new Error('This folder is already linked.')
        if (current.linkedFolders.length >= MAX_LINKS) throw new Error(`You can link up to ${MAX_LINKS} folders.`)
        return { ...current, linkedFolders: [...current.linkedFolders, { id: randomUUID(), name: basename(target) || target, path: target }] }
      })
      return linkedFolders
    },
    async unlinkFolder({ workspaceId, folderId }) {
      const workspace = getProject(ctx, workspaceId)
      const { linkedFolders } = await settings.update(workspace.id, current => ({
        ...current, linkedFolders: current.linkedFolders.filter(folder => folder.id !== folderId),
      }))
      return linkedFolders
    },
    async saveIdentity({ workspaceId, name, color, icon, reset }) {
      const workspace = getProject(ctx, workspaceId)
      const { identity } = await settings.update(workspace.id, current => ({
        ...current, identity: reset === true ? null : identityOf(name, color, icon),
      }))
      return identity
    },
    /** One instruction file and its modification time, read fresh when the editor opens. */
    async readText({ workspaceId, kind }) {
      const target = textFile(ctx, workspaceId, kind)
      const [text, modified] = await Promise.all([readText(target), modifiedAt(target)])
      return { text, modified }
    },
    /** Save only over the version the editor opened (`modified`, null for a file that did not exist). */
    async save({ workspaceId, kind, text, modified }) {
      if (typeof text !== 'string' || (modified !== null && typeof modified !== 'number')) throw new Error('Choose instructions or memory to save.')
      const target = textFile(ctx, workspaceId, kind)
      const contents = text.endsWith('\n') ? text : `${text}\n`
      if (Buffer.byteLength(contents) > MAX_TEXT_BYTES) throw new Error(`Keep this under ${MAX_TEXT_BYTES / 1024} KB; the agent reads no more than that.`)
      if (await modifiedAt(target) !== modified) throw new Error('This file changed elsewhere. Close the editor and open it again before saving.')
      // An emptied file is removed rather than left behind as an empty AGENTS.md.
      if (text.trim() === '') await unlink(target).catch((error) => { if (error?.code !== 'ENOENT') throw error })
      else await writeAtomic(target, contents)
      return { saved: true }
    },
    async addFile({ workspaceId, name, data }) {
      if (typeof name !== 'string' || typeof data !== 'string') throw new Error('Choose a file to add.')
      const safe = basename(name)
      if (safe === '' || safe === '.' || safe === '..' || safe !== name.split(/[\\/]/).at(-1)) throw new Error('That file name cannot be used.')
      const bytes = Buffer.from(data, 'base64')
      if (bytes.length > MAX_UPLOAD_BYTES) throw new Error(`Files over ${MAX_UPLOAD_BYTES / 1024 / 1024} MB cannot be added here.`)
      const root = getProject(ctx, workspaceId).path
      await mkdir(root, { recursive: true })
      // `wx` refuses to replace a file the project already has.
      let handle
      try { handle = await open(join(root, safe), 'wx') } catch (error) {
        if (error?.code === 'EEXIST') throw new Error(`${safe} is already in this project.`)
        throw error
      }
      try { await handle.writeFile(bytes) } finally { await handle.close() }
      return { added: safe }
    },
    async openFolder({ workspaceId, folderId, parts }) {
      const path = await contextPath(getProject(ctx, workspaceId), settings, folderId, parts)
      const controller = ctx.get('sessionController')
      if (!controller) throw new Error('The system file manager is not available.')
      return controller.openWorkspacePath({ path, action: 'open' }, AbortSignal.timeout(10_000))
    },
  }, { maxBodyBytes: MAX_REQUEST_BYTES }), 'jan-theme: project home')
}
