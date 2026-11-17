const jsonText = value => typeof value === 'string' ? value : JSON.stringify(value ?? null)
const textOf = part => typeof part.text === 'string' ? part.text : part.text?.value
// Jan stores thread times in seconds (sometimes fractional) and message times in milliseconds.
const secondsToMs = value => {
  if (value === null || value === undefined || value === '') return undefined
  const time = Math.round(Number(value) * 1000)
  return Number.isSafeInteger(time) && time > 0 ? time : undefined
}

/**
 * When a Jan thread started, in milliseconds. Older Jan builds left `created`
 * unset, so it falls back to `updated`, then to the first message's time.
 * @param {object} thread - the parsed thread.json.
 * @param {object[]} [messages] - the thread's messages, oldest first.
 * @returns {number} the start time.
 */
export const threadTime = (thread, messages = []) => {
  const first = Number(messages.find(message => message.created_at !== undefined)?.created_at)
  const time = secondsToMs(thread.created) ?? secondsToMs(thread.updated) ?? (Number.isSafeInteger(first) && first > 0 ? first : undefined)
  if (time === undefined) throw new Error('This Jan chat has no readable date.')
  return time
}

/**
 * When a Jan thread last changed, in milliseconds, for sorting the list.
 * @param {object} thread - the parsed thread.json.
 * @param {object[]} [messages] - the thread's messages.
 * @returns {number | undefined} the time, when any is recorded.
 */
export const threadUpdated = (thread, messages = []) => {
  const last = Number(messages.findLast(message => message.created_at !== undefined)?.created_at)
  return secondsToMs(thread.updated) ?? (Number.isSafeInteger(last) && last > 0 ? last : undefined) ?? secondsToMs(thread.created)
}

/**
 * Rewrite a Cowork transcript (`cowork.json`, AI SDK UI messages with `parts`)
 * into the `messages.jsonl` shape {@link convertThread} reads. Cowork kept no
 * per-message times, so messages are spaced one millisecond apart from the
 * thread's start to keep their order.
 * @param {object} thread - the parsed thread.json.
 * @param {object} cowork - the parsed cowork.json.
 * @returns {{ messages: object[], losses: string[] }} the messages and what could not be carried.
 */
export function coworkMessages(thread, cowork) {
  if (!Array.isArray(cowork?.messages)) throw new Error('This Cowork chat has no readable messages.')
  const losses = []
  const start = threadTime(thread)
  const messages = cowork.messages.map((message, index) => {
    const content = []
    for (const part of Array.isArray(message.parts) ? message.parts : []) {
      if (part.type === 'text' || part.type === 'reasoning') content.push({ type: part.type, text: { value: String(part.text ?? '') } })
      else if (part.type === 'file' && typeof part.mediaType === 'string' && part.mediaType.startsWith('image/')) content.push({ type: 'image_url', image_url: { url: part.url } })
      else if (typeof part.type === 'string' && part.type.startsWith('tool-') && (part.state === 'output-available' || part.state === 'output-error')) {
        content.push({ type: 'tool_call', tool_call_id: part.toolCallId, tool_name: part.type.slice('tool-'.length), input: part.input ?? {}, output: part.state === 'output-error' ? String(part.errorText ?? 'Tool failed.') : part.output, ...(part.state === 'output-error' ? { is_error: true } : {}) })
      } else content.push({ type: part.type })
    }
    return { id: String(message.id ?? `${thread.id}-${index}`), role: message.role, created_at: start + index, status: 'ready', content }
  })
  if (Array.isArray(cowork.subagents) && cowork.subagents.length) {
    losses.push(`${cowork.subagents.length} Cowork subagent runs are kept only as their tool results, not as separate transcripts.`)
  }
  if (typeof thread.metadata?.folder === 'string') losses.push(`This Cowork chat worked in ${thread.metadata.folder}; it is imported into the default workspace.`)
  return { messages, losses }
}

export function convertThread(thread, messages, images = new Map()) {
  const events = [], losses = new Set()
  const createdAt = threadTime(thread, messages)
  const emit = (type, data, time, surface = false) => {
    events.push({ type, seq: events.length, time, data, ...(surface ? { surfaceOp: 'append' } : {}) })
  }
  const timestamp = message => {
    const time = Number(message.created_at)
    if (!Number.isSafeInteger(time) || time < 0) throw new Error(`Invalid timestamp on message ${message.id}.`)
    return time
  }
  const results = new Map(messages.filter(m => m.role === 'tool' && m.tool_call_id).map(m => [m.tool_call_id, m]))
  const usedResults = new Set(), usedCalls = new Set()
  let turn = 0, step = 0, open = false, lastTime = createdAt, reason = { kind: 'completed' }
  const close = () => {
    if (!open) return
    emit('turn/end', { turn, reason }, lastTime)
    open = false
  }
  const start = time => {
    if (open) return
    turn++; step = 0; open = true; reason = { kind: 'completed' }
    emit('turn/start', { turn }, time)
  }
  const blocks = (message, parts, offset = 0) => parts.flatMap((part, index) => {
    if (part.type === 'text' || part.type === 'reasoning') {
      const text = textOf(part)
      if (part.text?.annotations?.length) losses.add('Text annotations are not imported.')
      return typeof text === 'string' && text ? [{ type: part.type, text }] : []
    }
    if (part.type === 'image_url') {
      const image = images.get(`${message.id}:${index + offset}`)
      if (image?.attachment) return [{ type: 'image', attachment: image.attachment }]
      losses.add(`Image on ${message.id}: ${image?.error ?? 'bytes unavailable'}.`)
    } else losses.add(`Unsupported content ${part.type ?? 'unknown'} on ${message.id}.`)
    return []
  })
  emit('session/title', { title: String(thread.title || 'Imported Jan chat').replace(/\s+/g, ' ').trim() || 'Imported Jan chat', messageSeqs: [], source: { kind: 'user' } }, createdAt)
  for (const message of messages) {
    const time = timestamp(message)
    if (message.role === 'tool') continue
    if (message.role === 'user') close()
    lastTime = time
    if (message.attachments?.length) losses.add('Legacy attachment metadata is not imported; only image content with available bytes is saved.')
    if (message.role === 'user') {
      close(); start(time)
      emit('user/message', { id: message.id, role: 'user', source: { kind: 'user' }, content: blocks(message, message.content ?? []) }, time, true)
      continue
    }
    if (message.role !== 'assistant') {
      losses.add(`Unsupported message role ${message.role} on ${message.id}.`)
      continue
    }
    start(time)
    const assistant = thread.assistants?.find(a => a.id === message.assistant_id) ?? thread.assistants?.[0]
    const source = { kind: 'model', provider: String(thread.model?.provider ?? assistant?.model?.engine ?? 'jan-import'), model: String(thread.model?.id ?? assistant?.model?.id ?? 'unknown') }
    let content = [], chunk = 0, active = false
    const begin = () => { if (!active) { step++; emit('step/start', { turn, step }, time); active = true } }
    const finish = (usage) => {
      if (!content.length && !usage) return
      begin()
      emit('assistant/message', { turn, step, message: { id: chunk++ ? `${message.id}:part-${chunk}` : message.id, role: 'assistant', source, content }, stream: [], ...(usage ? { usage } : {}), ...(['stopped', 'pending', 'error'].includes(message.status) ? { interrupted: true } : {}) }, time, true)
      content = []
    }
    const endStep = () => { if (active) { emit('step/end', { turn, step }, lastTime); active = false } }
    const parts = message.content ?? []
    for (let index = 0; index < parts.length; index++) {
      const part = parts[index]
      if (part.type !== 'tool_call') {
        content.push(...blocks(message, [part], index))
        continue
      }
      const callId = String(part.tool_call_id || `${message.id}:tool-${index}`)
      const separate = results.get(callId)
      const hasOutput = Object.hasOwn(part, 'output') || separate !== undefined
      if (!hasOutput || !part.tool_name || usedCalls.has(callId)) {
        losses.add(`Tool ${callId} was not replayed: missing result/name or duplicate call ID.`)
        continue
      }
      usedCalls.add(callId)
      const args = jsonText(part.input)
      content.push({ type: 'tool-call', id: callId, name: part.tool_name, arguments: args })
      finish()
      emit('tool/call', { turn, step, callId, name: part.tool_name, arguments: args }, time)
      if (separate) usedResults.add(separate)
      const resultTime = separate ? timestamp(separate) : time
      lastTime = resultTime
      emit('tool/result', { turn, step, message: { id: separate?.id ?? `${message.id}:result-${index}`, role: 'tool', source: { kind: 'tool', callId }, toolCallId: callId, content: separate ? blocks(separate, separate.content ?? []) : [{ type: 'text', text: jsonText(part.output) }], ...((separate ? separate.status === 'error' : part.is_error === true) ? { isError: true } : {}) } }, resultTime, true)
      endStep()
    }
    const raw = message.metadata?.usage
    let usage
    if (raw) {
      const input = raw.inputTokens ?? raw.prompt_tokens, output = raw.outputTokens ?? raw.completion_tokens
      const read = raw.cacheReadTokens ?? raw.prompt_tokens_details?.cached_tokens ?? 0
      const write = raw.cacheWriteTokens ?? 0
      const uncached = raw.inputTokens !== undefined ? input : input - read - write
      if ([uncached, output, read, write].every(n => Number.isSafeInteger(n) && n >= 0)) {
        usage = { inputTokens: uncached, outputTokens: output, ...(read ? { cacheReadTokens: read } : {}), ...(write ? { cacheWriteTokens: write } : {}), totalTokens: uncached + read + write + output }
      } else losses.add(`Usage on ${message.id} is incomplete or inconsistent and was omitted.`)
    }
    if (usage && !content.length && chunk) {
      const settled = events.findLast(event => event.type === 'assistant/message' && (event.data.message.id === message.id || event.data.message.id.startsWith(`${message.id}:part-`)))
      settled.data.usage = usage
    } else finish(usage)
    endStep()
    if (message.status === 'stopped') reason = { kind: 'aborted', reason: { kind: 'legacy' } }
    else if (message.status === 'error') reason = { kind: 'error', error: { code: String(message.error_code ?? 'UNKNOWN'), message: 'Jan recorded this message as failed.' } }
    else if (message.status === 'pending') reason = { kind: 'interrupted' }
    else if (message.metadata?.finishReason === 'length') reason = { kind: 'max-tokens' }
  }
  close()
  for (const result of results.values()) if (!usedResults.has(result)) losses.add(`Orphan tool result ${result.id} was not replayed.`)
  return { events, createdAt, losses: [...losses] }
}
