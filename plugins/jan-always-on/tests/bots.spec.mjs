import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { openBots } from '../bots.mjs'

async function setup(t) {
  const home = await mkdtemp(join(tmpdir(), 'jan-bots-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  return home
}

test('persists identities, project bindings and separate personas; duplicates get a fresh chat', async t => {
  const home = await setup(t)
  const registry = await openBots(home)
  const first = await registry.create({ name: 'Dawn', workspaceId: 'project-a', persona: 'Write concise replies.', model: { provider: 'p', model: 'm' } })
  const second = await registry.duplicate(first.id, 'Dawn copy')
  assert.equal(second.workspaceId, 'project-a')
  assert.notEqual(second.sessionId, first.sessionId)
  assert.notEqual(registry.directory(second), registry.directory(first))
  await registry.edit(first.id, { name: 'Dawn revised', persona: 'Explain tradeoffs.' })
  const restored = await openBots(home)
  assert.equal(restored.get(first.id).sessionId, first.sessionId)
  assert.equal(restored.get(first.id).name, 'Dawn revised')
  assert.deepEqual(restored.get(second.id).model, { provider: 'p', model: 'm' })
  assert.equal(await restored.persona(first.id), 'Explain tradeoffs.')
  assert.equal(await restored.persona(second.id), 'Write concise replies.')
})

test('adopts a conversation once and duplicates it into a new canonical session', async t => {
  const home = await setup(t)
  const registry = await openBots(home)
  const sourceSessionId = 'existing-chat'
  const input = { name: 'Dawn', workspaceId: 'project-a', sourceSessionId }
  const bot = await registry.create(input, candidate => assert.equal(candidate.sessionId, sourceSessionId))
  await assert.rejects(() => registry.create(input), /bot-session-conflict/u)
  const restored = await openBots(home)
  assert.equal(restored.forSession(sourceSessionId).id, bot.id)
  assert.notEqual((await restored.duplicate(bot.id, 'Dawn copy')).sessionId, sourceSessionId)
})

test('remembers migration after Jan is deleted and never removes an old queue during adoption', async t => {
  const home = await setup(t)
  const previous = join(home, 'always-on')
  await mkdir(join(previous, 'memory'), { recursive: true })
  await writeFile(join(previous, 'queue.sqlite'), 'legacy bytes')
  await writeFile(join(previous, 'memory', 'instructions.md'), 'legacy instructions')
  const registry = await openBots(home)
  assert.equal(registry.migrated, false)
  const jan = await registry.adopt('default')
  assert.equal(jan.name, 'Jan')
  assert.equal(jan.workspaceId, 'default')
  assert.equal(registry.directory(jan), previous)
  assert.equal(await readFile(join(registry.directory(jan), 'queue.sqlite'), 'utf8'), 'legacy bytes')
  assert.equal(await readFile(join(registry.directory(jan), 'memory', 'instructions.md'), 'utf8'), 'legacy instructions')
  await registry.remove(jan.id)
  assert.equal((await openBots(home)).migrated, true)
  assert.deepEqual((await openBots(home)).list(), [])
})

test('caches the newest message and persists unread without counting replay or older messages', async t => {
  const home = await setup(t)
  const registry = await openBots(home)
  const bot = await registry.create({ workspaceId: 'default', name: 'Dawn' })
  await registry.message(bot.id, { id: 'recent', text: 'Ready.', at: 9 }, true)
  await registry.read(bot.id)
  await registry.message(bot.id, { id: 'recent', text: 'Ready.', at: 9 }, true)
  await registry.message(bot.id, { id: 'older', text: 'Old.', at: 8 }, true)
  const restored = (await openBots(home)).get(bot.id)
  assert.deepEqual(restored.latest, { id: 'recent', text: 'Ready.', at: 9 })
  assert.equal(restored.unread, false)
})
