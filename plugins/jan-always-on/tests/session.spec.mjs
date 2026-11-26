import assert from 'node:assert/strict'
import { test } from 'node:test'
import { appendBotNotice, bindBotAgent, botPrompt } from '../agent.mjs'

test('adds only bot framing to the prompt and appends a durable proactive notice without waking another turn', async () => {
  const prompt = botPrompt({ name: 'Jan', role: 'Research', description: 'Review documents' })
  assert.match(prompt, /Bot name: Jan\n\nRole: Research/u)
  assert.doesNotMatch(prompt, /Review documents/u)
  const events = []
  const session = {
    snapshotEvents: () => events,
    append: (type, data, options) => { events.push({ type, data, options }) },
  }
  const ctx = { sessions: { flush: async candidate => candidate === session } }
  const notice = { id: 'stable', text: 'Your report is ready.' }
  await appendBotNotice(ctx, { session }, notice)
  await appendBotNotice(ctx, { session }, notice)
  assert.equal(events.length, 1)
  assert.equal(events[0].data.source.summary, notice.text)
  assert.equal(events[0].options.surfaceOp, 'append')
})

test('registers the bot command and tools through the Agent scope with explicit service injection', async () => {
  const tools = [], commands = []
  const scoped = {
    tools: { register: tool => tools.push(tool), guard() {} },
    commands: { register: command => commands.push(command) },
  }
  let disposed = false
  const agent = { ctx: { inject(services, apply) {
    assert.deepEqual(services, ['tools', 'commands'])
    apply(scoped)
    return { dispose: () => { disposed = true } }
  } } }
  const binding = bindBotAgent({}, agent, {}, {}, () => {})
  assert.equal(commands[0]?.name, 'new')
  assert.equal(tools.length, 4)
  await binding.dispose()
  assert.equal(disposed, true)
})

test('routines reach web and desktop tools only when the bot chat has Full access', () => {
  let guard
  const scoped = { tools: { register() {}, guard: fn => { guard = fn } }, commands: { register() {} } }
  const session = {}
  let preset = 'custom'
  const agent = { session, ctx: { inject(_services, apply) { apply(scoped); return { dispose() {} } } } }
  const ctx = { get: name => name === 'permissionPresets' ? { current: subject => subject === session ? preset : undefined } : undefined }
  const binding = bindBotAgent(ctx, agent, {}, {}, () => {})
  const blocked = name => guard({ name }) !== undefined

  // Foreground chat turns keep every tool the preset offers.
  assert.equal(blocked('web_open'), false)
  binding.state.run = { job: {} }
  assert.equal(blocked('memory_read'), false)
  assert.equal(blocked('web_open'), true)
  assert.equal(blocked('desktop_act'), true)
  preset = 'danger-full-access'
  assert.equal(blocked('web_open'), false)
  assert.equal(blocked('desktop_act'), false)
  assert.equal(blocked('bash'), true)
})
