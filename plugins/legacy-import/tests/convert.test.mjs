import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assertReleasedV4Relationships } from '@janhq/jan-session-format-v3-to-v4'
import { convertThread } from '../convert.mjs'

const thread = { id: 't1', title: 'Three planets', created_at: 1000, model: { id: 'LFM2', provider: 'llamacpp' } }
const messages = [
  { id: 'u1', role: 'user', created_at: 1000, content: [{ type: 'text', text: { value: 'Name three planets.' } }] },
  { id: 'a1', role: 'assistant', created_at: 1001, status: 'ready', content: [{ type: 'text', text: { value: 'Mercury, Venus, Earth.' } }] },
]

const read = events => assertReleasedV4Relationships({ header: {}, events, inheritedEventCount: 0 }, new Set(events.map(event => event.type)))

const systemPrompt = (seq, turn, text, surfaceOp) => ({
  type: 'system/message', seq, time: 2000, surfaceOp, ...(surfaceOp === 'append' ? {} : { sourceEventSeqs: [surfaceOp.startSeq] }),
  data: { turn, step: 1, message: { id: `s${seq}`, role: 'system', source: { kind: 'system-prompt' }, content: [{ type: 'text', text }] } },
})

// The agent loop's first live turn on a chat: it replaces the reserved node 0
// with the rendered prompt (runtime-context.ts SystemPromptProjection), or
// appends one when the log has no system node yet.
const continueChat = events => {
  const head = events.find(event => event.type === 'system/message')
  const turn = events.filter(event => event.type === 'turn/start').length + 1
  const next = [...events]
  const push = (type, data, extra = {}) => next.push({ type, seq: next.length, time: 2000, data, ...extra })
  push('turn/start', { turn })
  push('step/start', { turn, step: 1 })
  next.push(systemPrompt(next.length, turn, 'You are Jan.', head ? { op: 'replace', startSeq: head.seq, endSeq: head.seq } : 'append'))
  push('user/message', { id: 'u2', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'And one more?' }] }, { surfaceOp: 'append' })
  push('assistant/message', { turn, step: 1, message: { id: 'a2', role: 'assistant', source: { kind: 'model', provider: 'tokamak', model: 'm' }, content: [{ type: 'text', text: 'Mars.' }] }, stream: [] }, { surfaceOp: 'append' })
  push('step/end', { turn, step: 1 })
  push('turn/end', { turn, reason: { kind: 'completed' } })
  return next
}

test('an imported chat stays readable after Jan replies in it', () => {
  const { events } = convertThread(thread, messages)
  read(events)
  read(continueChat(events))
})

test('the first imported message is the first visible node after an empty system prompt', () => {
  const { events } = convertThread(thread, messages)
  const surface = events.filter(event => event.surfaceOp === 'append')
  assert.equal(surface[0].type, 'system/message')
  assert.deepEqual(surface[0].data.message.content, [])
  assert.deepEqual(surface.slice(1).map(event => event.data.id ?? event.data.message.id), ['u1', 'a1'])
})
