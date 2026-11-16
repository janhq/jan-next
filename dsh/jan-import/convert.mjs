const jsonText = value => typeof value === 'string' ? value : JSON.stringify(value ?? null)
const textOf = part => typeof part.text === 'string' ? part.text : part.text?.value
export const threadTime = value => {
  const time = Math.round(Number(value) * 1000)
  if (!Number.isSafeInteger(time) || time < 0) throw new Error('Invalid Jan thread timestamp.')
  return time
}

export function convertThread(thread, messages, images = new Map()) {
  const events = [], losses = new Set()
  const createdAt = threadTime(thread.created)
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
      emit('tool/result', { turn, step, message: { id: separate?.id ?? `${message.id}:result-${index}`, role: 'tool', source: { kind: 'tool', callId }, toolCallId: callId, content: separate ? blocks(separate, separate.content ?? []) : [{ type: 'text', text: jsonText(part.output) }], ...(separate?.status === 'error' ? { isError: true } : {}) } }, resultTime, true)
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
