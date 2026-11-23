import { readFile, readdir, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve, join, extname, isAbsolute, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import z from '@janhq/schemastery'
import { credentialRef } from '@janhq/jan-credentials'
import { registerApi } from '@janhq/jan-plugin-api'
import { convertThread, coworkMessages, threadUpdated } from './convert.mjs'
import { defaultFolders, listSessionFiles, mapLimit, readSessionFile, sessionHead } from './agents.mjs'
import { orcaWorkspaces, workspaceOf } from './orca.mjs'
import { janKeyNames, readJanKey } from './jan-secrets.mjs'
import { assistantPresetId, derivePreset, keyRef, providerProfile, readJanSettings } from './settings.mjs'
import { CONNECTORS_ONLY, MCP_SOURCES, readMcpSource, summarizeMcp } from './mcp.mjs'
import { importSkills, readSkillSource } from './skills.mjs'
import { resolveAgentsHome, resolveJanHome } from '@janhq/jan-home-paths'
import { DEFAULT_MIGRATION_DAYS, migrationPreview, registerMigrateSkill, registerMigrateTools } from './migrate.mjs'

export const Config = z.object({
  // The first-launch offer: `dismissed` once the user answered it.
  offer: z.dict(z.any()).default({}).volatile(),
  // Jan assistants brought over, by preset id; each is registered as a preset at startup.
  assistants: z.dict(z.any()).default({}).volatile(),
})
export const inject = ['webServer', 'connection', 'settings', 'sessions', 'sessionPersistence', 'workspaceRegistry', 'workspaceController', 'attachments']
// The preset an imported assistant is built on: its tools and guidance, with
// the assistant's instructions as the persona.
const BASE_PRESET = 'standard'
const PROVIDERS_NS = 'llm-pi-ai'
const errorText = error => error instanceof Error ? error.message : String(error)
const validId = id => typeof id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(id)
const parseMessages = text => text.split(/\r?\n/).filter(line => line.trim()).map((line, index) => {
  try { return JSON.parse(line) } catch { throw new Error(`Invalid messages.jsonl at line ${index + 1}.`) }
})
const selectedRows = (rows, ids) => ids === undefined ? rows : rows.filter(row => ids.has(row.id))
const ensureUnchanged = (label, before, current) => {
  if (!isDeepStrictEqual(before, current)) throw new Error(`${label} changed since the import form opened. Open the form and try again.`)
}

export function apply(ctx, config = {}) {
  const entry = ctx.fiber.entry?.options.id
  // The running (or last finished) import, read by `progress` so the page can
  // draw a bar and pick the run back up after the user leaves and returns.
  let job = null
  // Jan's default data folder; a relocated one is entered explicitly.
  const defaultFolder = () => process.platform === 'win32'
    ? join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'Jan', 'data')
    : process.platform === 'darwin'
      ? join(homedir(), 'Library', 'Application Support', 'Jan', 'data')
      : join(process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), 'Jan', 'data')
  const folderOf = folder => folder ? resolve(folder) : defaultFolder()
  const missing = error => error?.code === 'ENOENT'
  // A chat thread keeps messages.jsonl; a Cowork thread keeps cowork.json; a
  // thread with neither was opened and never used.
  const readThread = async (folder, id) => {
    if (!validId(id)) throw new Error('Invalid Jan thread ID.')
    const directory = join(folder, 'threads', id)
    const thread = JSON.parse(await readFile(join(directory, 'thread.json'), 'utf8'))
    if (thread.id !== id) throw new Error('Thread ID does not match its folder.')
    try {
      return { thread, kind: 'chat', messages: parseMessages(await readFile(join(directory, 'messages.jsonl'), 'utf8')), losses: [] }
    } catch (error) { if (!missing(error)) throw error }
    try {
      const cowork = coworkMessages(thread, JSON.parse(await readFile(join(directory, 'cowork.json'), 'utf8')))
      return { thread, kind: 'cowork', ...cowork }
    } catch (error) { if (!missing(error)) throw error }
    return { thread, kind: 'chat', messages: [], losses: [] }
  }
  const titleOf = thread => String(thread.title || '').replace(/\s+/g, ' ').trim() || 'Untitled Jan chat'
  const exists = async id => Boolean(ctx.sessions.get(id) || await ctx.sessionPersistence.stat(id))
  // Stored events of a session no live Agent holds; undefined when it is live or absent.
  const storedLength = async id => {
    if (ctx.sessions.get(id)) return undefined
    const snapshot = await ctx.sessionPersistence.stat(id)
    if (!snapshot) return undefined
    if (typeof snapshot.eventCount === 'number') return snapshot.eventCount
    const handle = await ctx.sessionPersistence.open(id, 'read')
    try { return (await handle.read()).events.length } finally { await handle.close() }
  }
  // Storage has no delete, so a chat whose import stopped after create is resumed,
  // not reported as imported. Images only change block content, never the event count.
  // A source that kept growing after its import (a coding agent still running) also converts
  // to more events, but its stored log already closed its last turn; only a stored log that is
  // an exact prefix of the conversion is resumed, so appending never splits a turn.
  const partialImport = async (sessionId, thread, messages) => {
    const stored = await storedLength(sessionId)
    if (stored === undefined || !messages.length) return false
    const events = convertThread(thread, messages).events
    if (stored >= events.length) return false
    const handle = await ctx.sessionPersistence.open(sessionId, 'read')
    let written
    try { written = (await handle.read()).events } finally { await handle.close() }
    // Saved images give blocks new ids, so the prefix check compares event kind and position only.
    return written.every((event, index) => event.type === events[index].type
      && event.data?.turn === events[index].data?.turn && event.data?.step === events[index].data?.step)
  }
  const imported = async (thread, messages) => {
    const sessionId = `jan-${thread.id}`
    if (await exists(sessionId)) return !await partialImport(sessionId, thread, messages)
    return typeof thread.metadata?.dshSession?.id === 'string' && await exists(thread.metadata.dshSession.id)
  }
  // Other coding agents keep one JSONL transcript per session in a folder of their own.
  const AGENTS = ['claude', 'codex', 'omp']
  const agentSource = source => {
    if (!AGENTS.includes(source)) throw new Error('Choose a source with chat history.')
    return source
  }
  const agentId = (source, id) => `${source}-${id}`
  const agentFolder = async (source, folder) => realpath(folder ? resolve(folder) : defaultFolders()[source])
  // Orca runs these agents in its workspaces; their transcripts stay in each agent's own folder.
  // Row and session ids carry the agent prefix, so a session imported here and from its agent's
  // own source is the same Jan session.
  const orcaFiles = async () => (await Promise.all(AGENTS.map(async agent => {
    try { return (await listSessionFiles(agent, await agentFolder(agent))).map(file => ({ ...file, agent, key: agentId(agent, file.id) })) } catch (error) {
      if (missing(error)) return []
      throw error
    }
  }))).flat().sort((a, b) => b.updated - a.updated)
  const listOrca = async ({ since }) => {
    const [workspaces, all] = await Promise.all([orcaWorkspaces(), orcaFiles()])
    const files = typeof since === 'number' ? all.filter(file => file.updated >= since) : all
    const rows = await mapLimit(files, async file => {
      try {
        const head = await sessionHead(file.path)
        const workspace = workspaceOf(workspaces, head.cwd)
        if (!workspace) return undefined
        return {
          id: file.key, title: head.title || file.id, agent: file.agent, project: workspace.path, workspace: workspace.name, projectName: workspace.project,
          size: file.size, updated: file.updated, alreadyImported: await exists(file.key),
        }
      } catch { return undefined }
    })
    // `folder` is the page's marker that this list is current; Orca has no folder of its own.
    return { source: 'orca', folder: 'orca', threads: rows.filter(Boolean), workspaces: workspaces.length, older: all.length - files.length }
  }
  // An Orca session opens in a Jan workspace over its Orca workspace's folder, titled as Orca shows it.
  const orcaWorkspaceFor = async (workspaces, cwd) => {
    const found = workspaceOf(workspaces, cwd)
    if (!found) return undefined
    try { return await ctx.workspaceRegistry.create(found.path, found.project && found.project !== found.name ? `${found.project} · ${found.name}` : found.name) } catch (error) {
      if (missing(error)) return undefined
      throw error
    }
  }
  // `since` (epoch ms) keeps the list to recent sessions; a coding agent can hold thousands, and
  // each listed one costs a file read and a store lookup.
  const listAgent = async ({ source, folder, since }) => {
    let root
    try { root = await agentFolder(source, folder) } catch (error) {
      if (!missing(error)) throw error
      return { source, folder: folder ? resolve(folder) : defaultFolders()[source], threads: [], missing: true }
    }
    const all = await listSessionFiles(source, root)
    const files = typeof since === 'number' ? all.filter(file => file.updated >= since) : all
    const threads = await mapLimit(files, async file => {
      try {
        const head = await sessionHead(file.path)
        return { id: file.id, title: head.title || file.id, project: head.cwd, size: file.size, updated: file.updated, alreadyImported: await exists(agentId(source, file.id)) }
      } catch (error) { return { id: file.id, title: file.id, size: file.size, error: errorText(error) } }
    })
    return { source, folder: root, threads, older: all.length - files.length }
  }
  const list = async ({ source = 'jan', folder, since }, approval) => {
    if (source === 'orca') return listOrca({ since })
    if (!MCP_SOURCES.includes(source)) throw new Error('Choose a supported migration source.')
    if (source !== 'jan') {
      const [conversations, settings] = await Promise.all([
        CONNECTORS_ONLY.includes(source) ? { source, threads: [] } : listAgent({ source, folder, since }).catch(() => ({
          source, folder: folder || defaultFolders()[source], threads: [], missing: true, chatError: 'Could not scan chat files. Check the folder and try again.',
        })),
        settingsSummary(source, undefined, approval),
      ])
      return { ...conversations, settings }
    }
    let janFolder
    try { janFolder = await realpath(folderOf(folder)) } catch (error) {
      if (!missing(error)) throw error
      return { source, folder: folderOf(folder), threads: [], missing: true }
    }
    let entries = []
    try { entries = await readdir(join(janFolder, 'threads'), { withFileTypes: true }) } catch (error) {
      if (!missing(error)) throw error
    }
    const threads = []
    for (const entry of entries) {
      if (!entry.isDirectory() || !validId(entry.name)) continue
      try {
        const { thread, kind, messages } = await readThread(janFolder, entry.name)
        threads.push({ id: thread.id, title: titleOf(thread), kind, messageCount: messages.length, updated: threadUpdated(thread, messages), alreadyImported: await imported(thread, messages) })
      } catch (error) {
        threads.push({ id: entry.name, title: entry.name, messageCount: 0, error: errorText(error) })
      }
    }
    threads.sort((a, b) => (b.updated ?? 0) - (a.updated ?? 0))
    return { source, folder: janFolder, threads, settings: await settingsSummary(source, janFolder, approval) }
  }
  const settingsSummary = async (source, folder, approval) => {
    const scan = await readMcpSource(source, { folder })
    if (approval) approval.mcp = scan
    const mcp = summarizeMcp(scan, new Set(ctx.get('janMcpSettings')?.configuredNames?.()))
    const result = { mcp, providers: [], assistants: [] }
    if (source !== 'jan') {
      try {
        result.skills = await skillScan(source)
        if (approval) approval.skills = result.skills
      } catch { result.skills = { error: 'Could not read skills. Check the skills folder and try again.' } }
      return result
    }
    try {
      const janSettings = await readJanSettings(folder, await janKeyNames(folder))
      if (approval) approval.janSettings = janSettings
      const { providers, assistants } = janSettings
      const stored = config.assistants?.get() ?? {}
      const routes = ctx.get('settings')?.describe().find(item => item.ns === PROVIDERS_NS)?.value?.providers ?? {}
      const credentials = ctx.get('credentials')
      result.providers = await Promise.all(providers.map(async ({ id, route, hasKey }) => {
        const existing = Object.hasOwn(routes, route) ? routes[route] : undefined
        const ref = existing?.apiKeyEnv || keyRef(route)
        const keyAlreadyConfigured = Boolean(hasKey && credentials && (await credentials.describe(credentialRef(ref))).configured)
        return { id, route, hasKey, keyAlreadyConfigured, alreadyImported: Boolean(existing) }
      }))
      result.assistants = assistants.map(({ id, name }) => ({ id, name, alreadyImported: Object.hasOwn(stored, id) }))
    } catch { result.error = 'Could not read earlier Jan settings. Check the source folder and try again.' }
    return result
  }
  // Skills land in Jan's own skills folder, the one its skill loader reads first.
  const skillScan = source => readSkillSource(source, { janHome: resolveJanHome(), agentsHome: resolveAgentsHome() })
  const preview = ({ source, days = DEFAULT_MIGRATION_DAYS } = {}) => migrationPreview(list, { source, days })
  const offer = async () => {
    if (config.offer?.get()?.dismissed === true) return { show: false }
    const { sources } = await preview()
    return { show: sources.some(row => row.ready || row.settings?.mcp.names.length
      || row.settings?.providers.some(item => !item.alreadyImported || (item.hasKey && !item.keyAlreadyConfigured))
      || row.settings?.assistants.some(item => !item.alreadyImported)), sources }
  }
  const dismissOffer = async () => {
    const settings = ctx.get('settings')
    if (!settings || !entry) throw new Error('Settings are unavailable. Try again from Settings -> Built-in plugins.')
    await settings.update(entry, { offer: { dismissed: true } })
  }
  const saveImages = async (folder, messages) => {
    const images = new Map()
    for (const message of messages) for (const [index, part] of (message.content ?? []).entries()) {
      if (part.type !== 'image_url') continue
      try {
        const url = part.image_url?.url
        if (typeof url !== 'string') throw new Error('missing URL')
        let data, mediaType, name
        const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/.exec(url)
        if (match) { mediaType = match[1]; data = Buffer.from(match[2], 'base64') }
        else {
          if (/^https?:/i.test(url)) throw new Error('remote images are not downloaded')
          const path = url.startsWith('file:') ? fileURLToPath(url) : isAbsolute(url) ? url : resolve(folder, url)
          const actual = await realpath(path)
          if (!actual.startsWith(`${folder}${sep}`)) throw new Error('image is outside the Jan data folder')
          data = await readFile(actual); name = path.split(/[\\/]/).at(-1)
          mediaType = ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' })[extname(path).toLowerCase()]
          if (!mediaType) throw new Error('unrecognized local image format')
        }
        images.set(`${message.id}:${index}`, { attachment: await ctx.attachments.saveImage({ data, mediaType, ...(name ? { name } : {}) }) })
      } catch (error) { images.set(`${message.id}:${index}`, { error: errorText(error) }) }
    }
    return images
  }
  // Jan assistants registered as presets in this run of the plugin, by id.
  const mountedPresets = new Map()
  const mountAssistant = async (presets, base, record) => {
    if (mountedPresets.has(record.id)) return
    mountedPresets.set(record.id, await presets.register(derivePreset(base, record)))
  }
  // The base preset's declaration can register after this plugin starts.
  const basePreset = async presets => {
    for (let attempt = 0; attempt < 60; attempt++) {
      if ((await presets.list()).some(preset => preset.id === BASE_PRESET)) return presets.definitionFor(BASE_PRESET)
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    throw new Error(`The ${BASE_PRESET} agent preset never registered.`)
  }
  ctx.effect(() => {
    let stopped = false
    void (async () => {
      const records = Object.values(config.assistants?.get() ?? {})
      const presets = ctx.get('agentPresets')
      if (!records.length || !presets) return
      const base = await basePreset(presets)
      for (const record of records) {
        if (stopped) return
        try { await mountAssistant(presets, base, record) } catch (error) { ctx.logger?.warn?.(`Jan assistant ${record.name}: ${errorText(error)}`) }
      }
    })().catch(error => ctx.logger?.warn?.(`Jan assistants: ${errorText(error)}`))
    return () => {
      stopped = true
      for (const dispose of mountedPresets.values()) void dispose().catch(() => { })
      mountedPresets.clear()
    }
  }, 'Jan assistants as agent presets')
  const importAssistants = async (records, run) => {
    const settings = ctx.get('settings')
    const presets = ctx.get('agentPresets')
    if (!settings || !entry || !presets) throw new Error('Agent presets are unavailable, so assistants cannot come over.')
    run.current = 'Assistants'
    const stored = config.assistants?.get() ?? {}
    const added = records.filter(record => !Object.hasOwn(stored, record.id))
    if (added.length) await settings.update(entry, { assistants: Object.fromEntries(added.map(record => [record.id, record])) })
    const base = await basePreset(presets)
    return Promise.all(records.map(async record => {
      try {
        await mountAssistant(presets, base, record)
        return { id: record.id, name: record.name, status: Object.hasOwn(stored, record.id) ? 'already here' : 'imported' }
      } catch (error) { return { id: record.id, name: record.name, status: 'failed', reason: errorText(error) } }
    }))
  }
  // A provider becomes an `llm-pi-ai` route; its key is read from Jan's
  // keyring (the OS may ask to allow it) and stored as a jan-next credential.
  // Routes and keys already here are kept.
  const importProvider = async (source, row) => {
    const settings = ctx.get('settings')
    const credentials = ctx.get('credentials')
    if (!settings || !credentials) throw new Error('Model provider settings are unavailable.')
    const descriptor = settings.describe().find(item => item.ns === PROVIDERS_NS)
    if (!descriptor) throw new Error('Model provider settings are unavailable.')
    const existing = descriptor.value?.providers?.[row.route]
    const ref = typeof existing?.apiKeyEnv === 'string' && existing.apiKeyEnv ? existing.apiKeyEnv : keyRef(row.route)
    let key = 'none'
    let reason
    if (row.hasKey) {
      const read = await readJanKey(source, row.id)
      if ('error' in read) { key = 'not read'; reason = read.error }
      else if ((await credentials.describe(credentialRef(ref))).configured) key = 'kept'
      else { await credentials.set(credentialRef(ref), read.key); key = 'imported' }
    }
    const named = key === 'imported' || key === 'kept'
    const ops = !existing ? [{ op: 'set', path: ['providers', row.route], value: providerProfile(row, named ? ref : undefined) }]
      : named && !existing.apiKeyEnv ? [{ op: 'set', path: ['providers', row.route, 'apiKeyEnv'], value: ref }] : []
    if (ops.length) await settings.mutate(PROVIDERS_NS, ops)
    return { id: row.id, route: row.route, status: existing ? 'already here' : 'imported', key, ...(reason ? { reason } : {}) }
  }
  // Keep these selections separate from the redacted MCP summary sent to the form.
  const selectMcp = (scan, names) => {
    if (names === undefined) return scan
    const chosen = new Set(names)
    return { ...scan, rows: scan.rows.filter(row => chosen.has(row.name)),
      servers: Object.fromEntries(Object.entries(scan.servers).filter(([name]) => chosen.has(name))) }
  }
  const importMcp = async scan => {
    const settings = ctx.get('janMcpSettings')
    const summary = summarizeMcp(scan, new Set(settings?.configuredNames?.()))
    let error
    let added = []
    if (summary.names.length) {
      if (!settings) error = 'MCP settings are unavailable. Turn on Jan Theme and try again.'
      else {
        try { added = (await settings.importMissing(scan.servers)).added } catch {
          error = 'Could not save MCP servers or their credentials. Check MCP settings and try again.'
        }
      }
    }
    const rows = summary.rows.map(row => ({ ...row, status: row.status === 'already here' ? row.status
      : error ? 'failed' : added.includes(row.name) ? 'imported' : 'already here' }))
    return { imported: added.length, already: rows.filter(row => row.status === 'already here').length,
      names: rows.map(row => row.name), rows, skipped: scan.skipped, issues: scan.issues, ...(error ? { error } : {}) }
  }
  const importSelected = async ({ source: origin = 'jan', folder, ids, providers, providerIds, assistants, assistantIds, mcp = false, mcpNames, skills = false, skillNames, instructions = false, runId }, approval) => {
    if (job?.running) throw new Error('An import is already running.')
    const orca = origin === 'orca'
    if (!orca && !MCP_SOURCES.includes(origin)) throw new Error('Choose a supported migration source.')
    if (!Array.isArray(ids) || ids.some(id => !validId(id))) throw new Error('Select valid session IDs.')
    if (CONNECTORS_ONLY.includes(origin) && ids.length) throw new Error('This source only imports MCP servers, not chats.')
    const providerSelection = providerIds === undefined ? undefined : new Set(providerIds)
    const assistantSelection = assistantIds === undefined ? undefined : new Set(assistantIds)
    const withProviders = providerSelection === undefined ? providers === true : providerSelection.size > 0
    const withAssistants = assistantSelection === undefined ? assistants === true : assistantSelection.size > 0
    if (origin !== 'jan' && (withProviders || withAssistants)) throw new Error('Model providers and assistants come only from the earlier Jan app.')
    if (orca && (mcp || skills || instructions)) throw new Error('Import MCP servers and skills from the app that configured them.')
    if (origin === 'jan' && (skills || instructions)) throw new Error('Skills come from Claude Code, Codex, OMP and Cursor.')
    if (!ids.length && !withProviders && !withAssistants && !mcp && !skills && !instructions) throw new Error('Choose chats or settings to import.')
    const unique = [...new Set(ids)]
    job = { running: true, total: unique.length, done: 0, current: null, results: [], settings: { providers: [], assistants: [] }, ...(typeof runId === 'string' ? { runId } : {}) }
    const run = job
    try {
      const source = origin === 'jan' ? await realpath(folderOf(folder)) : !unique.length || orca ? undefined : await agentFolder(origin, folder)
      if (approval && source !== undefined) ensureUnchanged('The source folder', folder, source)
      const agentFiles = origin === 'jan' || !unique.length ? undefined
        : orca ? new Map((await orcaFiles()).map(file => [file.key, file]))
          : new Map((await listSessionFiles(origin, source)).map(file => [file.id, { ...file, agent: origin, key: agentId(origin, file.id) }]))
      const workspaces = orca ? await orcaWorkspaces() : undefined
      const janSettings = withProviders || withAssistants ? await readJanSettings(source, withProviders ? await janKeyNames(source) : []) : undefined
      const providerRows = withProviders ? selectedRows(janSettings.providers, providerSelection) : []
      const assistantRows = withAssistants ? selectedRows(janSettings.assistants, assistantSelection) : []
      const skillSource = approval && (skills || instructions) ? await skillScan(origin) : undefined
      const mcpSource = mcp ? selectMcp(await readMcpSource(origin, { folder: source }), mcpNames) : undefined
      // Check all selected settings before writing any of them. Unselected additions should not block an import.
      if (approval) {
        if (withProviders) ensureUnchanged('The selected model providers', selectedRows(approval.janSettings.providers, providerSelection), providerRows)
        if (withAssistants) ensureUnchanged('The selected assistants', selectedRows(approval.janSettings.assistants, assistantSelection), assistantRows)
        if (mcpSource) {
          const approved = selectMcp(approval.mcp, mcpNames)
          ensureUnchanged('The selected MCP configuration', [approved.rows, approved.servers], [mcpSource.rows, mcpSource.servers])
        }
        if (skills) {
          const chosen = new Set(skillNames)
          const paths = scan => scan.skills.filter(row => chosen.has(row.name)).map(row => [row.name, row.path])
          ensureUnchanged('The selected skill folders', [approval.skills.linked, paths(approval.skills)], [skillSource.linked, paths(skillSource)])
        }
        if (instructions) ensureUnchanged('The global instructions file', approval.skills.instructions?.path, skillSource.instructions?.path)
      }
      run.total += providerRows.length
      if (withAssistants) run.total++
      if (skills || instructions) {
        run.total++
        run.current = 'Skills'
        try { run.settings.skills = await importSkills(skillSource ?? await skillScan(origin), { skills, names: skillNames, instructions }) } catch { run.settings.skills = { error: 'Could not copy skills. Scan the source again.' } }
        run.done++
      }
      if (mcp) {
        run.total++
        run.current = 'MCP servers'
        try { run.settings.mcp = await importMcp(mcpSource) } catch { run.settings.mcp = { error: 'Could not read MCP configuration. Scan the source again.' } }
        run.done++
      }
      // Assistants first, so imported chats can name their preset.
      if (withAssistants) {
        try { run.settings.assistants = await importAssistants(assistantRows, run) } catch (error) { run.settings.assistantsError = errorText(error) }
        run.done++
      }
      for (const row of providerRows) {
        run.current = `Provider ${row.id}`
        try { run.settings.providers.push(await importProvider(source, row)) } catch (error) { run.settings.providers.push({ id: row.id, status: 'failed', reason: errorText(error) }) }
        run.done++
      }
      if (!unique.length) return { results: run.results, settings: run.settings }
      // Initialize only for a new import that has no usable source directory.
      let defaultInitialization
      const defaultWorkspace = async () => {
        if (ctx.workspaceRegistry.defaultWorkspace === undefined) {
          defaultInitialization ??= ctx.workspaceController.initializeDefault(new AbortController().signal)
          await defaultInitialization
        }
        return ctx.workspaceRegistry.defaultWorkspace
      }
      const storedWorkspace = async cwd => {
        if (cwd === undefined) return undefined
        try { return await ctx.workspaceRegistry.resolveByPath(cwd) } catch (error) { if (!missing(error)) throw error }
      }
      const workspaceFor = async cwd => {
        if (typeof cwd !== 'string' || !isAbsolute(cwd)) return defaultWorkspace()
        try { if ((await stat(cwd)).isDirectory()) return await ctx.workspaceRegistry.create(cwd) } catch (error) { if (!missing(error)) throw error }
        return defaultWorkspace()
      }
      // An Orca session's folder is its Orca workspace, titled as Orca names it.
      const orcaWorkspace = async cwd => orca ? await orcaWorkspaceFor(workspaces, cwd) : undefined
      const sessionWorkspace = async cwd => await orcaWorkspace(cwd) ?? workspaceFor(cwd)
      const storedSessionWorkspace = async cwd => await orcaWorkspace(cwd) ?? storedWorkspace(cwd)
      for (const id of unique) {
        const file = agentFiles?.get(id)
        const sessionId = origin === 'jan' ? `jan-${id}` : file?.key ?? agentId(origin, id)
        try {
          if (agentFiles && !file) throw new Error('This session file is no longer in the folder.')
          const { thread, messages, losses } = file ? await readSessionFile(file.agent, file) : await readThread(source, id)
          run.current = titleOf(thread)
          const linkedId = thread.metadata?.dshSession?.id
          const partial = await exists(sessionId) && await partialImport(sessionId, thread, messages)
          if (!partial && (await exists(sessionId) || (typeof linkedId === 'string' && await exists(linkedId)))) {
            // Retry workspace membership when a prior import persisted successfully but attachment failed.
            const stored = ctx.sessions.get(sessionId)?.header ?? (await ctx.sessionPersistence.stat(sessionId))?.header
            await (await storedSessionWorkspace(stored?.cwd))?.attachSession(sessionId)
            run.results.push({ id, status: 'already imported', sessionId: stored ? sessionId : linkedId })
          } else if (!messages.length) {
            run.results.push({ id, status: 'skipped', reason: 'empty chat' })
          } else {
            const converted = convertThread(thread, messages, await saveImages(source, messages))
            let workspace
            let header, inheritedEventCount, handle
            if (partial) {
              // Finish a log an earlier run created but did not fill; its stored prefix stays as written.
              handle = await ctx.sessionPersistence.open(sessionId, 'write')
              header = handle.header
              inheritedEventCount = handle.inheritedEventCount
            } else {
              workspace = await sessionWorkspace(origin === 'jan' ? undefined : thread.cwd)
              const prepared = ctx.sessions.prepare(sessionId, { seed: converted.events, meta: { createdAt: converted.createdAt, ...(workspace ? { cwd: workspace.path } : {}), isSeeded: false } })
              // A chat with an imported assistant keeps running as that assistant.
              const preset = typeof thread.assistants?.[0]?.id === 'string' ? assistantPresetId(thread.assistants[0].id) : undefined
              header = preset && mountedPresets.has(preset) ? { ...prepared.header, agentPreset: preset } : prepared.header
              inheritedEventCount = prepared.inheritedEventCount
              handle = await ctx.sessionPersistence.create(header)
            }
            try {
              const written = partial ? (await handle.read()).events.length : 0
              if (written < converted.events.length) await handle.append(converted.events.slice(written))
              await handle.flush()
            } finally { await handle.close() }
            // The Chats list reads titles from the projection cache, which only
            // live sessions write; fold the imported log once so the row is titled.
            ctx.get('sessionProjectionCache')?.coldSnapshot(header, inheritedEventCount, converted.events)
            // A resumed partial log keeps the folder its header was written with.
            await (partial ? await storedSessionWorkspace(header.cwd) : workspace)?.attachSession(sessionId)
            run.results.push({ id, status: 'imported', sessionId, losses: [...losses, ...converted.losses] })
          }
        } catch (error) { run.results.push({ id, status: 'failed', reason: errorText(error) }) }
        run.done++
      }
      return { results: run.results, settings: run.settings }
    } catch (error) {
      run.error = errorText(error)
      throw error
    } finally { run.running = false; run.current = null }
  }
  const progress = async () => job
  // Keep normalized definitions and their credentials on the Host. Each form gets its own scan ID.
  const settingsScans = new Map()
  ctx.effect(() => registerApi(ctx, 'legacy-import', {
    async list(request) {
      const approval = {}
      const listed = await list(request, approval)
      if (!approval.mcp) return listed
      const scanId = randomUUID()
      settingsScans.set(scanId, { source: listed.source, folder: listed.folder, approval, names: listed.settings.mcp.names })
      if (settingsScans.size > 16) settingsScans.delete(settingsScans.keys().next().value)
      return { ...listed, scanId }
    },
    import(request) {
      if (!request.mcp) return importSelected(request)
      const scan = settingsScans.get(request.scanId)
      if (!scan || scan.source !== (request.source ?? 'jan') || scan.folder !== request.folder) {
        throw new Error('Scan the source again before importing MCP servers.')
      }
      const mcpNames = request.mcpNames ?? scan.names
      if (!Array.isArray(mcpNames) || mcpNames.some(name => !scan.names.includes(name))) {
        throw new Error('Choose MCP servers from the current scan.')
      }
      return importSelected({ ...request, mcpNames }, scan.approval)
    },
    progress, preview, offer, dismissOffer,
  }), 'Jan import API')
  ctx.inject(['skills'], scope => { registerMigrateSkill(scope) })
  ctx.inject(['tools'], scope => { registerMigrateTools(scope, { list, importSelected }) })
}
