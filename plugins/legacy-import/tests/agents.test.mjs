import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assertReleasedV4Relationships } from '@janhq/jan-session-format-v3-to-v4'
import { claudeSession, codexSession, ompSession } from '../agents.mjs'
import { convertThread } from '../convert.mjs'

const lines = records => records.map(record => JSON.stringify(record)).join('\n')
const validate = ({ thread, messages }) => {
  const { events } = convertThread(thread, messages)
  assertReleasedV4Relationships({ header: {}, events, inheritedEventCount: 0 }, new Set(events.map(event => event.type)))
  return events
}
const toolPairs = events => events.filter(event => event.type === 'tool/result').length

test('a Claude Code session keeps a split assistant message together and pairs each tool result', () => {
  const body = lines([
    { type: 'user', uuid: 'u1', timestamp: '2026-07-04T08:36:19.000Z', cwd: 'C:\\proj', message: { role: 'user', content: 'run the check' } },
    { type: 'assistant', uuid: 'a1', timestamp: '2026-07-04T08:36:20.000Z', message: { id: 'msg_1', model: 'claude-x', role: 'assistant', content: [{ type: 'thinking', thinking: 'plan it' }], usage: { input_tokens: 5, output_tokens: 2 } } },
    { type: 'assistant', uuid: 'a2', timestamp: '2026-07-04T08:36:21.000Z', message: { id: 'msg_1', model: 'claude-x', role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls' } }] } },
    { type: 'user', uuid: 'u2', timestamp: '2026-07-04T08:36:22.000Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'a.txt', is_error: false }] } },
    { type: 'assistant', uuid: 'a3', timestamp: '2026-07-04T08:36:23.000Z', message: { id: 'msg_2', model: 'claude-x', role: 'assistant', content: [{ type: 'text', text: 'done' }] } },
    { type: 'user', uuid: 'meta', isMeta: true, timestamp: '2026-07-04T08:36:24.000Z', message: { role: 'user', content: '<local-command-caveat>x</local-command-caveat>' } },
    { type: 'ai-title', aiTitle: 'Check the repo' },
  ])
  const session = claudeSession(body, 'c1')
  assert.equal(session.thread.title, 'Check the repo')
  assert.deepEqual(session.messages.map(message => message.role), ['user', 'assistant', 'tool', 'assistant'])
  const events = validate(session)
  assert.equal(toolPairs(events), 1)
  assert.equal(events.filter(event => event.type === 'user/message').length, 1, 'meta records are not user turns')
})

test('a short OMP session keeps the tool call, result and reasoning in active context', () => {
  const body = lines([
    { type: 'session', id: 's', timestamp: '2026-11-18T08:58:37.378Z', cwd: 'C:\\proj' },
    { type: 'message', id: 'm1', timestamp: '2026-11-18T08:58:57.000Z', message: { role: 'user', content: [{ type: 'text', text: 'start it' }], timestamp: 1794992336292 } },
    { type: 'message', id: 'm2', timestamp: '2026-11-18T08:59:03.000Z', message: { role: 'assistant', provider: '9router', model: 'claude-opus', stopReason: 'toolUse', timestamp: 1794992337668, usage: { input: 10, output: 3, cacheRead: 0, cacheWrite: 0 }, content: [{ type: 'thinking', thinking: 'look' }, { type: 'toolCall', id: 'call_1', name: 'bash', arguments: { command: 'git status' } }] } },
    { type: 'message', id: 'm3', timestamp: '2026-11-18T08:59:03.600Z', message: { role: 'toolResult', toolCallId: 'call_1', toolName: 'bash', isError: false, timestamp: 1794992343608, content: [{ type: 'text', text: 'clean' }] } },
    { type: 'message', id: 'm4', timestamp: '2026-11-18T08:59:05.000Z', message: { role: 'assistant', provider: '9router', model: 'claude-opus', stopReason: 'stop', timestamp: 1794992345000, content: [{ type: 'text', text: 'ok' }] } },
  ])
  const session = ompSession(body, 'o1')
  assert.equal(session.thread.title, 'start it')
  assert.equal(session.thread.model.id, 'claude-opus')
  const events = validate(session)
  assert.equal(toolPairs(events), 1)
  assert.equal(events.some(event => event.type === 'compaction/summary'), false)
  assert.deepEqual(events.find(event => event.type === 'tool/result').data.message.content, [{ type: 'text', text: 'clean' }])

  const long = validate(ompSession(body.replace('"text":"clean"', `"text":"${'x'.repeat(50_000)}"`), 'o2'))
  assert.ok(long.some(event => event.type === 'compaction/summary'), 'large tool output still triggers a checkpoint')
})

test('a Codex rollout skips injected context, pairs call_id outputs and keeps summaries only', () => {
  const body = lines([
    { timestamp: '2026-09-07T15:34:01.000Z', type: 'session_meta', payload: { id: 'x', cwd: 'C:\\proj', model_provider: 'openai', timestamp: '2026-09-07T15:34:01.000Z' } },
    { timestamp: '2026-09-07T15:34:02.000Z', type: 'turn_context', payload: { model: 'gpt-5.5' } },
    { timestamp: '2026-09-07T15:34:03.000Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>cwd</environment_context>' }] } },
    { timestamp: '2026-09-07T15:34:04.000Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'fix the build' }] } },
    { timestamp: '2026-09-07T15:34:05.000Z', type: 'response_item', payload: { type: 'reasoning', summary: [], encrypted_content: 'abc' } },
    { timestamp: '2026-09-07T15:34:06.000Z', type: 'response_item', payload: { type: 'function_call', name: 'shell', arguments: '{"command":["ls"]}', call_id: 'call_9' } },
    { timestamp: '2026-09-07T15:34:07.000Z', type: 'response_item', payload: { type: 'function_call_output', call_id: 'call_9', output: 'ok' } },
    { timestamp: '2026-09-07T15:34:08.000Z', type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'built' }] } },
  ])
  const session = codexSession(body, 'x1')
  assert.equal(session.thread.title, 'fix the build')
  assert.equal(session.thread.model.id, 'gpt-5.5')
  assert.equal(session.messages.filter(message => message.role === 'user').length, 1)
  assert.ok(session.losses.includes('Encrypted reasoning is not imported.'))
  assert.equal(toolPairs(validate(session)), 1)
})

test('a transcript that ends on a half-written line still reads', () => {
  const body = `${lines([{ type: 'user', uuid: 'u', timestamp: '2026-07-04T08:36:19.000Z', message: { role: 'user', content: 'hi' } }])}\n{"type":"assistant","uuid":"a","message":{"id":"m","role":"assist`
  assert.equal(claudeSession(body, 'c2').messages.length, 1)
})
