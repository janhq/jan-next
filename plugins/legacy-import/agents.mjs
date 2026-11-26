import { open, readFile, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Readers for the coding agents whose sessions can be brought into Jan. Each reader
 * lists a source folder and rewrites one transcript into the `messages.jsonl` shape
 * {@link convertThread} reads, so the event writer stays shared with the Jan import.
 */

const jsonLines = text => text.split(/\r?\n/).flatMap(line => {
  if (!line.trim()) return []
  // A transcript being written can end on a half line; skip it rather than fail the whole session.
  try { return [JSON.parse(line)] } catch { return [] }
})
const oneLine = value => String(value ?? '').replace(/\s+/g, ' ').trim()
// Agents wrap commands and injected context in tags; a heading is the words a person typed.
const heading = value => clip(oneLine(String(value ?? '').replace(/<[^>]*>/g, ' ')))
const clip = (text, length = 90) => text.length > length ? `${text.slice(0, length - 1)}…` : text
// convertThread reads thread.created in seconds.
const seconds = ms => ms === undefined ? undefined : ms / 1000
const time = value => {
  const parsed = typeof value === 'number' ? value : Date.parse(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}
const text = value => typeof value === 'string' ? value : JSON.stringify(value ?? null)
const isImage = part => part?.type === 'image'
// Agents send their own context inside user messages: a part that is one tag block (<environment_context>,
// <recommended_plugins>, …) or Codex's "# AGENTS.md instructions" part is not what the person typed.
const injectedPart = value => /^\s*<([a-zA-Z_][\w-]*)>[\s\S]*<\/\1>\s*$/.test(value) || /^\s*# AGENTS\.md instructions/.test(value)

/** The folder each agent writes sessions to, relative to the user's home. */
export const defaultFolders = () => ({
  claude: join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'projects'),
  codex: join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'sessions'),
  omp: join(homedir(), '.omp', 'agent', 'sessions'),
})

/** Names shown for each source. */
export const sourceLabels = { jan: 'Jan', claude: 'Claude Code', codex: 'Codex', omp: 'OMP' }

async function walk(directory, depth) {
  let entries
  try { entries = await readdir(directory, { withFileTypes: true }) } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
  const nested = await mapLimit(entries.filter(entry => entry.isDirectory() && depth > 0), entry => walk(join(directory, entry.name), depth - 1))
  return [...entries.filter(entry => entry.isFile() && entry.name.endsWith('.jsonl')).map(entry => join(directory, entry.name)), ...nested.flat()]
}

/**
 * Map with a bounded number of reads in flight. Listing a folder of thousands of transcripts
 * is bound by per-file latency (virus scanners on Windows), not by bytes, so serial reads take minutes.
 * @param {T[]} items - what to visit.
 * @param {(item: T) => Promise<R>} visit - the read.
 * @returns {Promise<R[]>} results in input order.
 */
export async function mapLimit(items, visit, limit = 24) {
  const results = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const at = next++; results[at] = await visit(items[at]) }
  }))
  return results
}

const matchesId = id => typeof id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}$/.test(id)

/**
 * Anthropic-style content blocks shared by Claude Code user turns: text, images and tool results.
 * @param {object[]} blocks - the `content` array of one record.
 * @returns {object[]} Jan message parts.
 */
const userParts = blocks => blocks.flatMap(block => {
  if (block.type === 'text') return [{ type: 'text', text: { value: String(block.text ?? '') } }]
  if (isImage(block) && block.source?.type === 'base64') return [{ type: 'image_url', image_url: { url: `data:${block.source.media_type};base64,${block.source.data}` } }]
  return []
})

const resultText = content => Array.isArray(content)
  ? content.map(part => part.type === 'text' ? part.text : part.type === 'tool_reference' ? `[tool: ${part.tool_name}]` : '').filter(Boolean).join('\n')
  : text(content)

/**
 * Claude Code writes one JSONL per session. An assistant message is split across
 * records that share `message.id` (one per block), and tool results come back as
 * `user` records carrying `tool_result` blocks.
 * @param {string} body - the file content.
 * @param {string} id - the session id.
 * @returns {{ thread: object, messages: object[], losses: string[] }} the session.
 */
export function claudeSession(body, id) {
  const records = jsonLines(body)
  const losses = new Set()
  const messages = []
  const byMessage = new Map()
  let title, cwd, created
  for (const record of records) {
    if (record.type === 'ai-title' && typeof record.aiTitle === 'string') title = record.aiTitle
    cwd ??= record.cwd
    created ??= time(record.timestamp)
    if (record.isSidechain) { losses.add('Sub-agent side conversations are not imported.'); continue }
    const at = time(record.timestamp) ?? created ?? 0
    if (record.type === 'user' && record.message) {
      if (record.isMeta) continue
      const content = record.message.content
      const parts = typeof content === 'string' ? [{ type: 'text', text: { value: content } }] : userParts(content ?? [])
      if (Array.isArray(content)) for (const block of content) {
        if (block.type !== 'tool_result') continue
        messages.push({ id: `${record.uuid}:${block.tool_use_id}`, role: 'tool', tool_call_id: block.tool_use_id, created_at: at, status: block.is_error ? 'error' : 'ready', content: [{ type: 'text', text: { value: resultText(block.content) } }] })
      }
      if (parts.length) messages.push({ id: record.uuid, role: 'user', created_at: at, content: parts })
    } else if (record.type === 'assistant' && record.message) {
      const key = record.message.id ?? record.uuid
      let message = byMessage.get(key)
      if (!message) {
        message = { id: key, role: 'assistant', created_at: at, status: 'ready', content: [], metadata: {}, model: record.message.model }
        byMessage.set(key, message)
        messages.push(message)
      }
      for (const block of record.message.content ?? []) {
        if (block.type === 'text') message.content.push({ type: 'text', text: { value: block.text } })
        else if (block.type === 'thinking') { if (block.thinking) message.content.push({ type: 'reasoning', text: { value: block.thinking } }) }
        else if (block.type === 'tool_use') message.content.push({ type: 'tool_call', tool_call_id: block.id, tool_name: block.name, input: block.input ?? {} })
        else losses.add(`Unsupported content ${block.type} was skipped.`)
      }
      const usage = record.message.usage
      if (usage) message.metadata.usage = { inputTokens: usage.input_tokens ?? 0, outputTokens: usage.output_tokens ?? 0, cacheReadTokens: usage.cache_read_input_tokens ?? 0, cacheWriteTokens: usage.cache_creation_input_tokens ?? 0 }
      if (record.message.stop_reason === 'max_tokens') message.metadata.finishReason = 'length'
    }
  }
  const first = messages.find(message => message.role === 'user')
  const opening = heading(first?.content.map(part => part.text?.value).join(' '))
  return {
    thread: { id, title: oneLine(title) || opening || 'Claude Code session', created: seconds(created), model: { provider: 'anthropic', id: [...byMessage.values()].find(message => message.model)?.model ?? 'claude' }, cwd },
    messages: messages.map(({ model, ...message }) => message),
    losses: [...losses],
  }
}

/**
 * OMP stores `message` records whose `content` is a list of text, thinking, image
 * and `toolCall` blocks; tool results are separate `toolResult` messages keyed by `toolCallId`.
 * Images are kept as `blob:sha256:` references outside the transcript and are not carried.
 * @param {string} body - the file content.
 * @param {string} id - the session id.
 * @returns {{ thread: object, messages: object[], losses: string[] }} the session.
 */
export function ompSession(body, id) {
  const records = jsonLines(body)
  const losses = new Set()
  const messages = []
  let header, title, checkpoint
  for (const record of records) {
    if (record.type === 'session') header = record
    else if (record.type === 'title' && typeof record.title === 'string') title = record.title
    else if (record.type === 'compaction' && typeof record.summary === 'string' && record.summary.trim()) checkpoint = record
    if (record.type !== 'message') continue
    const { message } = record
    const at = time(message.timestamp) ?? time(record.timestamp) ?? 0
    const blocks = typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : message.content ?? []
    if (message.role === 'user' || message.role === 'developer') {
      const parts = blocks.flatMap(block => block.type === 'text' ? [{ type: 'text', text: { value: block.text } }] : (losses.add('Images are not imported from OMP sessions.'), []))
      if (parts.length) messages.push({ id: record.id, role: 'user', created_at: at, content: parts })
    } else if (message.role === 'assistant') {
      const content = blocks.flatMap(block => {
        if (block.type === 'text') return [{ type: 'text', text: { value: block.text } }]
        if (block.type === 'thinking') return block.thinking ? [{ type: 'reasoning', text: { value: block.thinking } }] : []
        if (block.type === 'toolCall') return [{ type: 'tool_call', tool_call_id: block.id, tool_name: block.name, input: block.arguments ?? {} }]
        return []
      })
      const usage = message.usage
      messages.push({
        id: record.id, role: 'assistant', created_at: at, content,
        status: message.stopReason === 'aborted' ? 'stopped' : message.stopReason === 'error' ? 'error' : 'ready',
        metadata: { ...(usage ? { usage: { inputTokens: usage.input ?? 0, outputTokens: usage.output ?? 0, cacheReadTokens: usage.cacheRead ?? 0, cacheWriteTokens: usage.cacheWrite ?? 0 } } : {}), ...(message.stopReason === 'length' ? { finishReason: 'length' } : {}) },
        model: message.model, provider: message.provider,
      })
    } else if (message.role === 'toolResult') {
      const result = blocks.flatMap(block => block.type === 'text' ? [block.text] : (losses.add('Images in tool results are not imported from OMP sessions.'), [])).join('\n')
      messages.push({ id: record.id, role: 'tool', tool_call_id: message.toolCallId, created_at: at, status: message.isError ? 'error' : 'ready', content: [{ type: 'text', text: { value: result } }] })
    }
  }
  const model = messages.findLast(message => message.model)
  const first = messages.find(message => message.role === 'user')
  return {
    thread: { id, title: oneLine(title) || heading(first?.content[0]?.text?.value) || 'OMP session', created: seconds(time(header?.timestamp)), model: { provider: model?.provider ?? 'omp', id: model?.model ?? 'unknown' }, cwd: header?.cwd, ompContext: checkpoint === undefined ? {} : { summary: checkpoint.summary, firstKeptEntryId: checkpoint.firstKeptEntryId } },
    messages: messages.map(({ model: _model, provider: _provider, ...message }) => message),
    losses: [...losses],
  }
}

/**
 * Codex writes `rollout-*.jsonl` with `session_meta`, `turn_context` and `response_item`
 * lines: `message` (role user/assistant), `reasoning`, `function_call`/`custom_tool_call` and
 * their `_output` lines matched by `call_id`; `event_msg` lines carry token counts.
 * @param {string} body - the file content.
 * @param {string} id - the session id.
 * @returns {{ thread: object, messages: object[], losses: string[] }} the session.
 */
export function codexSession(body, id) {
  const records = jsonLines(body)
  const losses = new Set()
  const messages = []
  let meta, model, current
  const assistant = at => {
    if (!current) {
      current = { id: `${id}:a${messages.length}`, role: 'assistant', created_at: at, status: 'ready', content: [], metadata: {} }
      messages.push(current)
    }
    return current
  }
  const blockText = payload => (payload.content ?? []).map(part => part.text ?? '').join('')
  for (const record of records) {
    const at = time(record.timestamp) ?? 0
    const { payload } = record
    if (record.type === 'session_meta') meta = payload
    else if (record.type === 'turn_context') model = payload?.model ?? model
    else if (record.type === 'response_item') {
      if (payload.type === 'message' && payload.role === 'user') {
        current = undefined
        const parts = (payload.content ?? []).map(part => part.text ?? '')
        const value = parts.filter(part => !injectedPart(part)).join('')
        // Codex injects environment and instruction context as user messages; they are not what the person typed.
        if (value.trim()) messages.push({ id: `${id}:u${messages.length}`, role: 'user', created_at: at, content: [{ type: 'text', text: { value } }] })
      } else if (payload.type === 'message' && payload.role === 'assistant') {
        assistant(at).content.push({ type: 'text', text: { value: blockText(payload) } })
      } else if (payload.type === 'reasoning') {
        const summary = (payload.summary ?? []).map(part => part.text ?? '').join('\n')
        if (summary) assistant(at).content.push({ type: 'reasoning', text: { value: summary } })
        else losses.add('Encrypted reasoning is not imported.')
      } else if (payload.type === 'function_call' || payload.type === 'custom_tool_call') {
        let input = payload.arguments ?? payload.input
        if (typeof input === 'string') { try { input = JSON.parse(input) } catch { input = { input } } }
        assistant(at).content.push({ type: 'tool_call', tool_call_id: payload.call_id, tool_name: payload.name, input: input ?? {} })
      } else if (payload.type === 'function_call_output' || payload.type === 'custom_tool_call_output') {
        const output = typeof payload.output === 'string' ? payload.output : payload.output?.content ?? text(payload.output)
        messages.push({ id: `${id}:r${messages.length}`, role: 'tool', tool_call_id: payload.call_id, created_at: at, status: 'ready', content: [{ type: 'text', text: { value: output } }] })
        current = undefined
      }
    } else if (record.type === 'event_msg' && payload?.type === 'token_count' && payload.info?.last_token_usage && current) {
      const usage = payload.info.last_token_usage
      current.metadata.usage = { inputTokens: Math.max((usage.input_tokens ?? 0) - (usage.cached_input_tokens ?? 0), 0), outputTokens: usage.output_tokens ?? 0, cacheReadTokens: usage.cached_input_tokens ?? 0 }
    }
  }
  const first = messages.find(message => message.role === 'user')
  return {
    thread: { id, title: heading(first?.content[0]?.text?.value) || 'Codex session', created: seconds(time(meta?.timestamp) ?? time(records[0]?.timestamp)), model: { provider: meta?.model_provider ?? 'openai', id: model ?? 'unknown' }, cwd: meta?.cwd },
    messages,
    losses: [...losses],
  }
}

const readers = { claude: claudeSession, codex: codexSession, omp: ompSession }
// A session ID built from its path inside the agent's folder: it starts with a letter or digit,
// uses only [a-zA-Z0-9_-], and stays under the 120 characters a Jan session ID leaves after its source prefix.
const idOf = (path, folder) => path.slice(folder.length + 1).replace(/\.jsonl$/, '').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+/, '').slice(-120).replace(/^-+/, '')

/**
 * The first 64 KB of a transcript tells a list row what it needs: the title, the project folder,
 * the first thing the person asked and the start time. A transcript can be tens of megabytes, so a
 * list never parses a whole file.
 * @param {string} path - the transcript.
 * @returns {Promise<{ title: string, cwd?: string, started?: number }>} what the head shows.
 */
export async function sessionHead(path) {
  const handle = await open(path, 'r')
  let title = '', first = '', cwd, started, carry = ''
  try {
    const buffer = Buffer.alloc(65536)
    // Codex writes ~100 KB of instructions before the first prompt, so read on until one shows, within 1 MB.
    for (let position = 0; position < 1048576 && !(title && cwd) && !(first && cwd && started);) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position)
      if (bytesRead === 0) break
      position += bytesRead
      const text = carry + buffer.toString('utf8', 0, bytesRead)
      const cut = text.lastIndexOf('\n') + 1
      carry = text.slice(cut)
      for (const record of jsonLines(text.slice(0, cut))) {
        if (record.type === 'title' || record.type === 'ai-title') title ||= oneLine(record.title ?? record.aiTitle)
        cwd ??= record.cwd ?? record.payload?.cwd
        started ??= time(record.timestamp)
        const message = record.message ?? (record.type === 'response_item' && record.payload?.type === 'message' ? record.payload : undefined)
        if (first || message?.role !== 'user' || record.isMeta) continue
        const content = message.content
        const parts = typeof content === 'string' ? [content] : (content ?? []).filter(part => part.type !== 'tool_result').map(part => part.text ?? '')
        const value = parts.filter(part => part.trim() && !injectedPart(part)).join(' ')
        if (value.trim()) first = heading(value)
      }
    }
  } finally { await handle.close() }
  return { title: title || first, cwd, started }
}

/**
 * Find every session file of one agent.
 * @param {'claude'|'codex'|'omp'} source - which agent.
 * @param {string} folder - the agent's sessions folder.
 * @returns {Promise<{ id: string, path: string, size: number, updated: number }[]>} files, newest first.
 */
export async function listSessionFiles(source, folder) {
  // Codex nests sessions under YYYY/MM/DD. Claude Code and OMP keep one file per session in a project
  // folder; the folder beside each OMP session holds its sub-agent transcripts and change log, which are not sessions.
  const depth = source === 'codex' ? 3 : 1
  const found = await mapLimit(await walk(folder, depth), async path => {
    const info = await stat(path)
    return info.size === 0 ? undefined : { id: idOf(path, folder), path, size: info.size, updated: info.mtimeMs }
  })
  return found.filter(Boolean).sort((a, b) => b.updated - a.updated)
}

/**
 * Read one session of an agent.
 * @param {'claude'|'codex'|'omp'} source - which agent.
 * @param {{ id: string, path: string }} file - an entry from {@link listSessionFiles}.
 * @returns {Promise<{ thread: object, messages: object[], losses: string[] }>} the session.
 */
export async function readSessionFile(source, file) {
  if (!matchesId(file.id)) throw new Error('Invalid session ID.')
  return readers[source](await readFile(file.path, 'utf8'), file.id)
}
