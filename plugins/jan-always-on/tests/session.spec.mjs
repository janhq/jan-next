import assert from 'node:assert/strict'
import { test } from 'node:test'
import { appendBotNotice, botPrompt } from '../agent.mjs'

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
