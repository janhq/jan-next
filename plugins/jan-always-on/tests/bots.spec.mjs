import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
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

test('persists the agent reference and duplicates into a fresh chat while sharing the agent', async t => {
  const home = await setup(t)
  const registry = await openBots(home)
  const first = await registry.create({ name: 'Dawn', workspaceId: 'project-a', agentProfile: 'reviewer' })
  const second = await registry.duplicate(first.id, 'Dawn copy')
  assert.equal(second.workspaceId, 'project-a')
  assert.notEqual(second.sessionId, first.sessionId)
  assert.notEqual(registry.directory(second), registry.directory(first))
  await registry.edit(first.id, { name: 'Dawn revised', agentProfile: 'researcher' })
  const restored = await openBots(home)
  assert.equal(restored.get(first.id).sessionId, first.sessionId)
  assert.equal(restored.get(first.id).name, 'Dawn revised')
  assert.equal(restored.get(first.id).agentProfile, 'researcher')
  assert.equal(restored.get(second.id).agentProfile, 'reviewer')
})

async function legacyBots(t, names = ['PR Watcher']) {
  const home = await setup(t)
  const root = join(home, 'bots')
  const instructions = 'Watch PRs'
  const personaDigest = createHash('sha256').update(instructions).digest('hex')
  const model = { provider: 'fixture', model: 'watcher-model', reasoningEffort: 'high' }
  const state = { version: 1, migrated: true, bots: [] }
  for (const [index, name] of names.entries()) {
    const id = `6cc09d56-f69d-457e-af42-${String(index).padStart(12, '0')}`
    state.bots.push({ id, sessionId: `session-${index}`, workspaceId: 'project-a', name, role: 'Developer',
      description: 'Review pull requests', model, personaDigest, createdAt: 1, latest: null, unread: true })
    await mkdir(join(root, id), { recursive: true })
    await writeFile(join(root, id, `persona-${personaDigest}.md`), instructions)
  }
  const file = join(root, 'registry.json')
  await writeFile(file, JSON.stringify(state))
  return { home, file, state, instructions, model,
    persona: bot => join(root, bot.id, `persona-${personaDigest}.md`) }
}

test('moves a v1 persona and model to a global agent and leaves it untouched on reopen', async t => {
  const { home, file, state, instructions, model, persona } = await legacyBots(t)
  const calls = []
  const agentProfiles = { list: async () => ({ profiles: [] }), save: async request => { calls.push(request) } }
  const registry = await openBots(home, { agentProfiles })
  const [{ description, personaDigest, model: _model, ...previous }] = state.bots
  assert.deepEqual(registry.list(), [{ ...previous, agentProfile: 'pr-watcher', agentSelectionPending: true }])
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { version: 2, migrated: true, bots: registry.list() })
  assert.deepEqual(calls, [{ scope: 'global', profile: { id: 'pr-watcher', description, use: 'all', instructions, model } }])
  await assert.rejects(readFile(persona(state.bots[0])), { code: 'ENOENT' })
  await openBots(home, { agentProfiles })
  assert.equal(calls.length, 1)
  await registry.agentSelectionRestored(state.bots[0].id)
  const restored = await openBots(home, { agentProfiles })
  assert.equal(restored.get(state.bots[0].id).agentSelectionPending, undefined)
  assert.equal(calls.length, 1)
})

test('uses collision suffixes and leaves v1 intact when an agent save fails', async t => {
  const { home, file, state, persona, instructions } = await legacyBots(t, ['PR Watcher', 'PR Watcher'])
  const ids = new Set(['pr-watcher'])
  const reports = []
  let fail = true
  const agentProfiles = {
    list: async () => ({ profiles: [...ids].map(id => ({ id })) }),
    save: async ({ profile }) => {
      if (profile.id === 'pr-watcher-3' && fail) throw new Error('disk full')
      ids.add(profile.id)
    },
    remove: async ({ id }) => { ids.delete(id) },
  }
  await assert.rejects(openBots(home, { agentProfiles, report: error => reports.push(error) }), /disk full/u)
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), state)
  for (const bot of state.bots) assert.equal(await readFile(persona(bot), 'utf8'), instructions)
  assert.deepEqual([...ids], ['pr-watcher'])
  assert.match(reports[0].message, /disk full/u)
  fail = false
  const registry = await openBots(home, { agentProfiles })
  assert.deepEqual(registry.list().map(bot => bot.agentProfile), ['pr-watcher-2', 'pr-watcher-3'])
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
