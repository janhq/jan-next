import { readFile, readdir, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve, join, extname, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import z from '@janhq/schemastery'
import { registerApi } from '@janhq/jan-plugin-api'
import { convertThread, coworkMessages, threadUpdated } from './convert.mjs'

export const Config = z.object({
  // The first-launch offer: `dismissed` once the user answered it.
  offer: z.dict(z.any()).default({}).volatile(),
})
export const inject = ['webServer', 'connection', 'settings', 'sessions', 'sessionPersistence', 'workspaceRegistry', 'attachments']
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
  const list = async ({ folder }) => {
    const source = await realpath(folderOf(folder))
    const entries = await readdir(join(source, 'threads'), { withFileTypes: true })
    const threads = []
    for (const entry of entries) {
      if (!entry.isDirectory() || !validId(entry.name)) continue
      try {
        const { thread, kind, messages } = await readThread(source, entry.name)
        threads.push({ id: thread.id, title: titleOf(thread), kind, messageCount: messages.length, updated: threadUpdated(thread, messages), alreadyImported: await exists(`jan-${thread.id}`) || (typeof thread.metadata?.dshSession?.id === 'string' && await exists(thread.metadata.dshSession.id)) })
      } catch (error) {
        threads.push({ id: entry.name, title: entry.name, messageCount: 0, error: errorText(error) })
      }
    }
    threads.sort((a, b) => (b.updated ?? 0) - (a.updated ?? 0))
    return { folder: source, threads }
  }
  // Offered once on first launch when the earlier Jan left chats that are not
  // here yet; a relocated Jan folder is only reachable from Settings.
  const offer = async () => {
    if (config.offer?.get()?.dismissed === true) return { show: false, count: 0 }
    try {
      const { threads } = await list({})
      const count = threads.filter(thread => !thread.error && !thread.alreadyImported && thread.messageCount > 0).length
      return { show: count > 0, count }
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
          data = await readFile(path); name = path.split(/[\\/]/).at(-1)
          mediaType = ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' })[extname(path).toLowerCase()]
          if (!mediaType) throw new Error('unrecognized local image format')
        }
        images.set(`${message.id}:${index}`, { attachment: await ctx.attachments.saveImage({ data, mediaType, ...(name ? { name } : {}) }) })
      } catch (error) { images.set(`${message.id}:${index}`, { error: errorText(error) }) }
    }
    return images
  }
  const importSelected = async ({ folder, ids }) => {
    if (job?.running) throw new Error('A Jan import is already running.')
    if (!Array.isArray(ids) || !ids.length || ids.some(id => !validId(id))) throw new Error('Select valid Jan thread IDs.')
    const unique = [...new Set(ids)]
    job = { running: true, total: unique.length, done: 0, current: null, results: [] }
    const run = job
    try {
      const source = await realpath(folderOf(folder))
      const workspace = await ctx.workspaceRegistry.initializeDefault(async () => process.cwd())
      if (!workspace) throw new Error('The default workspace is unavailable. Restore it before importing.')
      for (const id of unique) {
        const sessionId = `jan-${id}`
        try {
          const { thread, messages, losses } = await readThread(source, id)
          run.current = titleOf(thread)
          const linkedId = thread.metadata?.dshSession?.id
          if (await exists(sessionId) || (typeof linkedId === 'string' && await exists(linkedId))) {
            // Retry workspace membership when a prior import persisted successfully but attachment failed.
            if (await exists(sessionId)) await workspace.attachSession(sessionId)
            run.results.push({ id, status: 'already imported', sessionId: await exists(sessionId) ? sessionId : linkedId })
          } else if (!messages.length) {
            run.results.push({ id, status: 'skipped', reason: 'empty chat' })
          } else {
            const converted = convertThread(thread, messages, await saveImages(source, messages))
            const prepared = ctx.sessions.prepare(sessionId, { seed: converted.events, meta: { createdAt: converted.createdAt, cwd: workspace.path, isSeeded: false } })
            const handle = await ctx.sessionPersistence.create(prepared.header)
            try { await handle.append(converted.events); await handle.flush() } finally { await handle.close() }
            // The Chats list reads titles from the projection cache, which only
            // live sessions write; fold the imported log once so the row is titled.
            ctx.get('sessionProjectionCache')?.coldSnapshot(prepared.header, prepared.inheritedEventCount, converted.events)
            await workspace.attachSession(sessionId)
            run.results.push({ id, status: 'imported', sessionId, losses: [...losses, ...converted.losses] })
          }
        } catch (error) { run.results.push({ id, status: 'failed', reason: errorText(error) }) }
        run.done++
      }
      return { results: run.results }
    } catch (error) {
      run.error = errorText(error)
      throw error
    } finally { run.running = false; run.current = null }
  }
  const progress = async () => job
  ctx.effect(() => registerApi(ctx, 'legacy-import', { list, import: importSelected, progress, offer, dismissOffer }), 'Jan read-only import API')
}
