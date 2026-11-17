import { readFile, readdir, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve, join, extname, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerApi } from '@janhq/jan-plugin-api'
import { convertThread, threadTime } from './convert.mjs'

export const inject = ['webServer', 'connection', 'sessions', 'sessionPersistence', 'workspaceRegistry', 'attachments']
const errorText = error => error instanceof Error ? error.message : String(error)
const validId = id => typeof id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(id)
const parseMessages = text => text.split(/\r?\n/).filter(line => line.trim()).map((line, index) => {
  try { return JSON.parse(line) } catch { throw new Error(`Invalid messages.jsonl at line ${index + 1}.`) }
})

export function apply(ctx) {
  let importing = false
  // Jan's default data folder; a relocated one is entered explicitly.
  const defaultFolder = () => process.platform === 'win32'
    ? join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'Jan', 'data')
    : process.platform === 'darwin'
      ? join(homedir(), 'Library', 'Application Support', 'Jan', 'data')
      : join(process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), 'Jan', 'data')
  const folderOf = folder => folder ? resolve(folder) : defaultFolder()
  const readThread = async (folder, id) => {
    if (!validId(id)) throw new Error('Invalid Jan thread ID.')
    const directory = join(folder, 'threads', id)
    const thread = JSON.parse(await readFile(join(directory, 'thread.json'), 'utf8'))
    if (thread.id !== id) throw new Error('Thread ID does not match its folder.')
    const messages = parseMessages(await readFile(join(directory, 'messages.jsonl'), 'utf8'))
    return { thread, messages }
  }
  const exists = async id => Boolean(ctx.sessions.get(id) || await ctx.sessionPersistence.stat(id))
  const list = async ({ folder }) => {
    const source = await realpath(folderOf(folder))
    const entries = await readdir(join(source, 'threads'), { withFileTypes: true })
    const threads = []
    for (const entry of entries) {
      if (!entry.isDirectory() || !validId(entry.name)) continue
      try {
        const { thread, messages } = await readThread(source, entry.name)
        threads.push({ id: thread.id, title: thread.title || thread.id, messageCount: messages.length, updated: threadTime(thread.updated), alreadyImported: await exists(`jan-${thread.id}`) || (typeof thread.metadata?.dshSession?.id === 'string' && await exists(thread.metadata.dshSession.id)) })
      } catch (error) {
        threads.push({ id: entry.name, title: entry.name, messageCount: 0, error: errorText(error) })
      }
    }
    threads.sort((a, b) => (b.updated ?? 0) - (a.updated ?? 0))
    return { folder: source, threads }
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
    if (importing) throw new Error('A Jan import is already running.')
    if (!Array.isArray(ids) || !ids.length || ids.some(id => !validId(id))) throw new Error('Select valid Jan thread IDs.')
    importing = true
    try {
      const source = await realpath(folderOf(folder))
      const workspace = await ctx.workspaceRegistry.initializeDefault(async () => process.cwd())
      if (!workspace) throw new Error('The default workspace is unavailable. Restore it before importing.')
      const results = []
      for (const id of new Set(ids)) {
        const sessionId = `jan-${id}`
        try {
          const { thread, messages } = await readThread(source, id)
          const linkedId = thread.metadata?.dshSession?.id
          if (await exists(sessionId) || (typeof linkedId === 'string' && await exists(linkedId))) {
            // Retry workspace membership when a prior import persisted successfully but attachment failed.
            if (await exists(sessionId)) await workspace.attachSession(sessionId)
            results.push({ id, status: 'already imported', sessionId: await exists(sessionId) ? sessionId : linkedId }); continue
          }
          const converted = convertThread(thread, messages, await saveImages(source, messages))
          const prepared = ctx.sessions.prepare(sessionId, { seed: converted.events, meta: { createdAt: converted.createdAt, cwd: workspace.path, isSeeded: false } })
          const handle = await ctx.sessionPersistence.create(prepared.header)
          try { await handle.append(converted.events); await handle.flush() } finally { await handle.close() }
          // The Chats list reads titles from the projection cache, which only
          // live sessions write; fold the imported log once so the row is titled.
          ctx.get('sessionProjectionCache')?.coldSnapshot(prepared.header, prepared.inheritedEventCount, converted.events)
          await workspace.attachSession(sessionId)
          results.push({ id, status: 'imported', sessionId, losses: converted.losses })
        } catch (error) { results.push({ id, status: 'failed', reason: errorText(error) }) }
      }
      return { results }
    } finally { importing = false }
  }
  ctx.effect(() => registerApi(ctx, 'legacy-import', { list, import: importSelected }), 'Jan read-only import API')
}
