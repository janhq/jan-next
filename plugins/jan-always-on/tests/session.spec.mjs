import assert from 'node:assert/strict'
import { test } from 'node:test'
import { appendBotNotice, bindBotAgent, botPrompt } from '../agent.mjs'

test('produces a literal persona and durable proactive notice without waking another turn', async () => {
  assert.match(botPrompt({ name: 'Jan', role: 'Research', description: 'Review documents' }, 'Keep {{references}} verbatim.'), /Keep \{\{references\}\} verbatim/)
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
