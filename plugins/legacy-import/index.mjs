import { readFile, readdir, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve, join, extname, isAbsolute, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import z from '@janhq/schemastery'
import { credentialRef } from '@janhq/jan-credentials'
import { registerApi } from '@janhq/jan-plugin-api'
import { convertThread, coworkMessages, threadUpdated } from './convert.mjs'
import { defaultFolders, listSessionFiles, mapLimit, readSessionFile, sessionHead } from './agents.mjs'
import { janKeyNames, readJanKey } from './jan-secrets.mjs'
import { assistantPresetId, derivePreset, keyRef, providerProfile, readJanSettings } from './settings.mjs'

export const Config = z.object({
  // The first-launch offer: `dismissed` once the user answered it.
  offer: z.dict(z.any()).default({}).volatile(),
  // Jan assistants brought over, by preset id; each is registered as a preset at startup.
  assistants: z.dict(z.any()).default({}).volatile(),
})
export const inject = ['webServer', 'connection', 'settings', 'sessions', 'sessionPersistence', 'workspaceRegistry', 'attachments']
// The preset an imported assistant is built on: its tools and guidance, with
// the assistant's instructions as the persona.
const BASE_PRESET = 'standard'
const PROVIDERS_NS = 'llm-pi-ai'
const errorText = error => error instanceof Error ? error.message : String(error)
const validId = id => typeof id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(id)
const parseMessages = text => text.split(/\r?\n/).filter(line => line.trim()).map((line, index) => {
  try { return JSON.parse(line) } catch { throw new Error(`Invalid messages.jsonl at line ${index + 1}.`) }
})

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
    if (!AGENTS.includes(source)) throw new Error('Choose Jan, Claude Code, Codex or OMP.')
    return source
  }
  const agentId = (source, id) => `${source}-${id}`
  const agentFolder = async (source, folder) => realpath(folder ? resolve(folder) : defaultFolders()[source])
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
  const list = async ({ source = 'jan', folder, since }) => {
    if (source !== 'jan') return listAgent({ source: agentSource(source), folder, since })
    const janFolder = await realpath(folderOf(folder))
    const entries = await readdir(join(janFolder, 'threads'), { withFileTypes: true })
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
    return { folder: janFolder, threads, settings: await settingsSummary(janFolder) }
  }
  // What else Jan holds, for the import choices; never a secret value.
  const settingsSummary = async source => {
    try {
      const { providers, mcp, assistants } = await readJanSettings(source, await janKeyNames(source))
      const stored = config.assistants?.get() ?? {}
      return {
        providers: providers.map(({ id, route, hasKey }) => ({ id, route, hasKey })),
        mcp: { names: Object.keys(mcp.servers), renamed: mcp.renamed, skipped: mcp.skipped },
        assistants: assistants.map(({ id, name }) => ({ id, name, alreadyImported: Object.hasOwn(stored, id) })),
      }
    } catch (error) { return { error: errorText(error), providers: [], mcp: { names: [], renamed: {}, skipped: [] }, assistants: [] } }
  }
  // Offered once on first launch when the earlier Jan left chats that are not
  // here yet; a relocated Jan folder is only reachable from Settings.
  const offer = async () => {
    if (config.offer?.get()?.dismissed === true) return { show: false, count: 0 }
    try {
      const { threads, settings } = await list({})
      const count = threads.filter(thread => !thread.error && !thread.alreadyImported && thread.messageCount > 0).length
      // Names the settings that come along, so the offer says what it moves.
      const extras = [
        settings.providers.length ? 'model providers' : null,
        settings.mcp.names.length ? 'MCP servers' : null,
        settings.assistants.some(item => !item.alreadyImported) ? 'assistants' : null,
      ].filter(Boolean)
      return { show: count > 0, count, extras }
    } catch (error) {
      if (missing(error)) return { show: false, count: 0 }
      throw error
    }
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
  // The MCP servers as a document for the MCP settings import, which stores
  // their env and header values as credentials and adds them turned off.
  const mcpDocument = async ({ folder }) => {
    const { mcp } = await readJanSettings(await realpath(folderOf(folder)), [])
    return { text: JSON.stringify({ mcpServers: mcp.servers }), renamed: mcp.renamed, skipped: mcp.skipped }
  }
  const importSelected = async ({ source: origin = 'jan', folder, ids, providers = false, assistants = false }) => {
    if (job?.running) throw new Error('An import is already running.')
    if (origin !== 'jan') agentSource(origin)
    if (!Array.isArray(ids) || ids.some(id => !validId(id))) throw new Error('Select valid session IDs.')
    if (origin !== 'jan' && (providers || assistants)) throw new Error('Providers and assistants come only from Jan.')
    if (!ids.length && !providers && !assistants) throw new Error('Choose chats or settings to import.')
    const unique = [...new Set(ids)]
    job = { running: true, total: unique.length, done: 0, current: null, results: [], settings: { providers: [], assistants: [] } }
    const run = job
    try {
      const source = origin === 'jan' ? await realpath(folderOf(folder)) : await agentFolder(origin, folder)
      const agentFiles = origin === 'jan' ? undefined : new Map((await listSessionFiles(origin, source)).map(file => [file.id, file]))
      const janSettings = providers || assistants ? await readJanSettings(source, providers ? await janKeyNames(source) : []) : undefined
      if (providers) run.total += janSettings.providers.length
      if (assistants) run.total++
      // Assistants first, so imported chats can name their preset.
      if (assistants) {
        try { run.settings.assistants = await importAssistants(janSettings.assistants, run) } catch (error) { run.settings.assistantsError = errorText(error) }
        run.done++
      }
      if (providers) for (const row of janSettings.providers) {
        run.current = `Provider ${row.id}`
        try { run.settings.providers.push(await importProvider(source, row)) } catch (error) { run.settings.providers.push({ id: row.id, status: 'failed', reason: errorText(error) }) }
        run.done++
      }
      if (!unique.length) return { results: run.results, settings: run.settings }
      // A coding-agent session opens in the folder it ran in, so it can be continued there;
      // a Jan chat, or a session whose folder is gone, opens in the default workspace.
      let fallback
      const defaultWorkspace = async () => {
        fallback ??= await ctx.workspaceRegistry.initializeDefault(async () => process.cwd())
        if (!fallback) throw new Error('The default workspace is unavailable. Restore it before importing.')
        return fallback
      }
      const workspaceFor = async cwd => {
        if (typeof cwd !== 'string' || !isAbsolute(cwd)) return defaultWorkspace()
        try { if ((await stat(cwd)).isDirectory()) return await ctx.workspaceRegistry.create(cwd) } catch (error) { if (!missing(error)) throw error }
        return defaultWorkspace()
      }
      for (const id of unique) {
        const sessionId = origin === 'jan' ? `jan-${id}` : agentId(origin, id)
        try {
          const file = agentFiles?.get(id)
          if (agentFiles && !file) throw new Error('This session file is no longer in the folder.')
          const { thread, messages, losses } = file ? await readSessionFile(origin, file) : await readThread(source, id)
          run.current = titleOf(thread)
          const linkedId = thread.metadata?.dshSession?.id
          const partial = await exists(sessionId) && await partialImport(sessionId, thread, messages)
          if (!partial && (await exists(sessionId) || (typeof linkedId === 'string' && await exists(linkedId)))) {
            // Retry workspace membership when a prior import persisted successfully but attachment failed.
            if (await exists(sessionId)) await (await workspaceFor(origin === 'jan' ? undefined : (await ctx.sessionPersistence.stat(sessionId))?.header.cwd)).attachSession(sessionId)
            run.results.push({ id, status: 'already imported', sessionId: await exists(sessionId) ? sessionId : linkedId })
          } else if (!messages.length) {
            run.results.push({ id, status: 'skipped', reason: 'empty chat' })
          } else {
            const converted = convertThread(thread, messages, await saveImages(source, messages))
            const workspace = await workspaceFor(origin === 'jan' ? undefined : thread.cwd)
            let header, inheritedEventCount, handle
            if (partial) {
              // Finish a log an earlier run created but did not fill; its stored prefix stays as written.
              handle = await ctx.sessionPersistence.open(sessionId, 'write')
              header = handle.header
              inheritedEventCount = handle.inheritedEventCount
            } else {
              const prepared = ctx.sessions.prepare(sessionId, { seed: converted.events, meta: { createdAt: converted.createdAt, cwd: workspace.path, isSeeded: false } })
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
            await (partial && origin !== 'jan' ? await workspaceFor(header.cwd) : workspace).attachSession(sessionId)
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
  ctx.effect(() => registerApi(ctx, 'legacy-import', { list, import: importSelected, progress, offer, dismissOffer, mcpDocument }), 'Jan read-only import API')
}
