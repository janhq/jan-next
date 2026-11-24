/** Project overview operations for registered workspaces and their explicitly linked folders. */
import { readFileSync } from 'node:fs'
import { readFile, readdir, lstat, stat, writeFile, rename, unlink, open, mkdir, realpath } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative, sep } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { JSON_SCHEMA, load as loadYaml } from 'js-yaml'
import { registerApi } from '@janhq/jan-plugin-api'

const FILES = { instructions: 'AGENTS.md', memory: 'AGENTS.local.md' }
// The instruction loader's own default budget; a larger file would be truncated for the agent.
const MAX_TEXT_BYTES = 65_536
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024
// Base64 expands uploads by a third; leave room for the JSON envelope and file name.
const MAX_REQUEST_BYTES = 34 * 1024 * 1024
const MAX_LISTED = 300
const MAX_PREVIEW_BYTES = 4 * 1024 * 1024
const MAX_ICON_BYTES = 256 * 1024
const MAX_LINKS = 32
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const HIDDEN_FILES = new Set(['.git', 'node_modules'])
const EMPTY_SETTINGS = { identity: null, linkedFolders: [], disabledSkillFolders: [], disabledSkills: [] }
const MAX_SKILL_TOGGLES = 2000

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
    // Files written before skill toggles existed lack both lists.
    value = { ...EMPTY_SETTINGS, ...value }
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

async function listFiles(root) {
  const entries = await readdir(root, { withFileTypes: true })
  const visible = entries.filter(entry => !HIDDEN_FILES.has(entry.name))
    .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
  const rows = await Promise.all(visible.slice(0, MAX_LISTED).map(async (entry) => {
    const directory = entry.isDirectory()
    let size
    let modified
    try {
      const info = await lstat(join(root, entry.name))
      size = directory ? undefined : info.size
      modified = info.mtimeMs
    } catch (error) {
      // A file removed or locked between readdir and stat is still listed, without details.
      if (error?.code !== 'ENOENT' && error?.code !== 'EPERM' && error?.code !== 'EBUSY') throw error
    }
    return { name: entry.name, directory, size, modified }
  }))
  return { files: rows, truncated: visible.length > MAX_LISTED }
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

const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const SKILLS_READ = 'project_skills_read'
const SKILLS_CHANGE = 'project_skills_change'
const renderMessage = (_args, value) => [{ type: 'text', text: typeof value?.message === 'string' ? value.message : JSON.stringify(value) }]

/**
 * Register the agent's project skill tools: a read of the folders and skills its chat's project loads,
 * and an approved change of the same switches as the project page. A chat outside a project gets a refusal.
 */
function registerSkillTools(scope, projectSkills, projectFor) {
  const projectOf = (agent) => {
    const workspace = projectFor(agent?.session.header.cwd)
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
    const { folders } = await projectSkills.list(workspace)
    const state = args.enabled ? 'on' : 'off'
    if (typeof args.folder === 'string') {
      const folder = folders.find(entry => entry.path !== null && relative(entry.path, args.folder) === '')
      if (folder === undefined) throw new Error(`No skill folder ${JSON.stringify(args.folder)} is loaded in this project. Read the list again.`)
      return {
        workspace, kind: 'folder', target: folder.path, unchanged: folder.enabled === args.enabled, enabled: args.enabled,
        reason: `Turn ${state} skills from ${folder.label} (${folder.skills.length}) in project ${basename(workspace.path)}?`
      }
    }
    const skill = folders.flatMap(folder => folder.skills).find(entry => entry.name === args.skill)
    if (skill === undefined) throw new Error(`No skill named ${JSON.stringify(args.skill)} is loaded in this project. Read the list again.`)
    return {
      workspace, kind: 'skill', target: skill.name, unchanged: skill.enabled === args.enabled, enabled: args.enabled,
      reason: `Turn ${state} skill ${skill.name} in project ${basename(workspace.path)}?`
    }
  }
  scope.effect(function*() {
    yield scope.tools.register({
      name: SKILLS_READ,
      description: 'List the skill folders and skills this chat\'s Jan project loads, with the project\'s on/off switches. Use it before project_skills_change. Switches apply to this project only and never change skill files.',
      parameters: {
        type: 'object', additionalProperties: false, properties: {
          folder: { type: 'string', description: 'Optional folder path from an earlier read; adds each skill\'s description for that folder.' },
        }
      },
      output: { schema: {}, render: renderMessage },
      async execute(args, exec) {
        try {
          const { folders } = await projectSkills.list(projectOf(exec.agent))
          return {
            folders: folders.map(folder => {
              const detail = typeof args?.folder === 'string' && folder.path !== null && relative(folder.path, args.folder) === ''
              return {
                path: folder.path, label: folder.label, enabled: folder.enabled,
                skills: folder.skills.map(skill => detail ? { name: skill.name, enabled: skill.enabled, description: skill.description } : `${skill.name}${skill.enabled ? '' : ' (off)'}`)
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

/** Show a folder under the home directory as `~/…` so its row names the folder people recognise. */
function homeRelative(path) {
  const rest = relative(homedir(), path)
  return rest !== '' && !rest.startsWith('..') && !isAbsolute(rest) ? `~/${rest.split(sep).join('/')}` : path
}

/**
 * Group skills by the folder that holds them, `<root>/<name>/SKILL.md` or
 * `<root>/<name>.md`. A skill turned off by name or by its folder reads as off.
 * Skills without a file are grouped under `path: null`.
 */
export function skillFolders(skills, disabledFolders, disabledNames) {
  const folders = new Map()
  for (const skill of skills) {
    const file = skill.path
    const root = file === undefined ? null
      : basename(file) === 'SKILL.md' ? dirname(dirname(file)) : dirname(file)
    let folder = folders.get(root)
    if (folder === undefined) {
      folder = {
        path: root, label: root === null ? null : homeRelative(root), source: skill.source,
        enabled: root === null || !disabledFolders.some(path => relative(path, root) === ''),
        skills: [],
      }
      folders.set(root, folder)
    }
    folder.skills.push({ name: skill.name, description: skill.description, enabled: !disabledNames.has(skill.name), modelInvocable: skill.invocation.modelInvocable })
  }
  return [...folders.values()]
}

/** @param {import('@janhq/cordis').Context} ctx */
export function mountProjectHome(ctx) {
  const settings = projectSettings(ctx)
  const readUsage = usageReader(ctx)
  // A chat inside a project skips the skills and skill folders that project turned off.
  const projectFor = (cwd) => {
    if (typeof cwd !== 'string') return undefined
    let best
    for (const workspace of ctx.get('workspaceRegistry')?.list() ?? []) {
      if (within(workspace.path, cwd) && (best === undefined || workspace.path.length > best.path.length)) best = workspace
    }
    return best
  }
  ctx.inject(['skills'], (scope) => {
    scope.effect(() => scope.skills.registerFilter({
      name: 'jan-theme:project-skills',
      resolve: ({ cwd }) => {
        const workspace = projectFor(cwd)
        if (workspace === undefined) return undefined
        const { disabledSkillFolders, disabledSkills } = settings.read(workspace.id)
        if (disabledSkillFolders.length === 0 && disabledSkills.length === 0) return undefined
        const names = new Set(disabledSkills)
        return skill => !names.has(skill.name)
          && !(skill.path !== undefined && disabledSkillFolders.some(folder => within(folder, skill.path)))
      },
    }), 'jan-theme: project skill toggles')
  })
  const refreshSkills = () => { ctx.get('skills')?.refresh() }
  // One implementation behind the project page switches and the agent's skill tools.
  const projectSkills = {
    async list(workspace) {
      const registry = ctx.get('skills')
      if (registry === undefined) throw new Error('Skills are not available in this Jan build.')
      const { disabledSkillFolders, disabledSkills } = settings.read(workspace.id)
      // The default preset's scope adds its own skill folders, as a new chat here would see them.
      const lease = await ctx.get('agentPresets')?.acquireScope().catch(() => undefined)
      try {
        const all = await registry.list({ cwd: workspace.path, scope: lease?.key, unfiltered: true })
        return { folders: skillFolders(all, disabledSkillFolders, new Set(disabledSkills)) }
      } finally {
        await lease?.[Symbol.asyncDispose]()
      }
    },
    async setFolder(workspace, path, enabled) {
      if (typeof path !== 'string' || !isAbsolute(path) || typeof enabled !== 'boolean') throw new Error('Choose a skill folder to turn on or off.')
      const { disabledSkillFolders } = await settings.update(workspace.id, (current) => {
        const rest = current.disabledSkillFolders.filter(folder => relative(folder, path) !== '')
        if (!enabled && rest.length >= MAX_SKILL_TOGGLES) throw new Error('Too many skill folders are turned off in this project.')
        return { ...current, disabledSkillFolders: enabled ? rest : [...rest, path] }
      })
      refreshSkills()
      return disabledSkillFolders
    },
    async setSkill(workspace, name, enabled) {
      if (typeof name !== 'string' || !SKILL_NAME.test(name) || typeof enabled !== 'boolean') throw new Error('Choose a skill to turn on or off.')
      const { disabledSkills } = await settings.update(workspace.id, (current) => {
        const rest = current.disabledSkills.filter(skill => skill !== name)
        if (!enabled && rest.length >= MAX_SKILL_TOGGLES) throw new Error('Too many skills are turned off in this project.')
        return { ...current, disabledSkills: enabled ? rest : [...rest, name] }
      })
      refreshSkills()
      return disabledSkills
    },
  }
  ctx.inject(['tools'], (scope) => { registerSkillTools(scope, projectSkills, projectFor) })
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
        readText(join(root, FILES.instructions)), readText(join(root, FILES.memory)), listFiles(root), gitInfo(root),
        readInventory(ctx, root),
      ])
      return { path: root, instructions, memory, ...listing, git: gitState, inventory, ...settings.read(id) }
    },
    browse: async ({ workspaceId, folderId, parts }) => listFiles(await contextPath(getProject(ctx, workspaceId), settings, folderId, parts)),
    preview: async ({ workspaceId, folderId, parts }) => readPreview(await contextPath(getProject(ctx, workspaceId), settings, folderId, parts)),
    usage: ({ workspaceId }) => readUsage(getProject(ctx, workspaceId)),
    /** Every skill a chat in this project could see, grouped by folder, with this project's switches. */
    skills: ({ workspaceId }) => projectSkills.list(getProject(ctx, workspaceId)),
    setSkillFolder: ({ workspaceId, path, enabled }) => projectSkills.setFolder(getProject(ctx, workspaceId), path, enabled),
    setSkill: ({ workspaceId, name, enabled }) => projectSkills.setSkill(getProject(ctx, workspaceId), name, enabled),
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
