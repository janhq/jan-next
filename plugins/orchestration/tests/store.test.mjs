import assert from 'node:assert/strict'
import { chmod, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { newId, openStore, StateWriteError } from '../store.mjs'

async function scratch(t) {
  const directory = await mkdtemp(join(tmpdir(), 'jan-orch-store-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  return { directory, path: join(directory, 'state.json') }
}

test('serializes mutations and preserves state and host identity across reopen', async t => {
  const { path } = await scratch(t)
  const store = await openStore(path, console)
  const id = newId('task')
  assert.match(id, /^task_[a-z2-7]{10}$/)
  const hostId = store.read().hostId
  const first = store.mutate(state => { state.tasks[id] = { id, title: 'Draft notes' } })
  const second = store.mutate(state => { state.tasks[id].title = 'Publish notes' })
  await Promise.all([first, second, store.flush()])
  const reopened = await openStore(path, console)
  assert.equal(reopened.read().hostId, hostId)
  assert.deepEqual(reopened.read().tasks[id], { id, title: 'Publish notes' })
})

test('quarantines malformed JSON and unsupported versions', async t => {
  for (const contents of ['{', '{"version":2}']) {
    const { directory, path } = await scratch(t)
    await writeFile(path, contents)
    const warnings = []
    const store = await openStore(path, { warn: text => warnings.push(text) })
    const quarantine = (await readdir(directory)).find(name => /^state\.json\.broken-\d+$/.test(name))
    assert.ok(quarantine)
    assert.equal(await readFile(join(directory, quarantine), 'utf8'), contents)
    assert.equal(warnings.length, 1)
    assert.deepEqual(store.read().tasks, {})
    assert.equal(store.read().version, 1)
  }
})

test('retention discards the oldest delivered messages but never drops undelivered ones', async t => {
  const { path } = await scratch(t)
  const store = await openStore(path, console)
  await store.mutate(state => {
    for (let seq = 1; seq <= 2003; seq++) state.messages.push({ seq, delivered: seq % 2 === 0 })
  })
  const { messages } = (await openStore(path, console)).read()
  assert.equal(messages.length, 2000)
  assert.deepEqual(messages.slice(0, 5).map(message => message.seq), [1, 3, 5, 7, 8])
  await store.mutate(state => {
    state.messages = Array.from({ length: 2001 }, (_, seq) => ({ seq, delivered: false }))
  })
  assert.equal(store.read().messages.length, 2001)
})

test('retention reclaims held reports after delivered ones', async t => {
  const { path } = await scratch(t)
  const store = await openStore(path, console)
  await store.mutate(state => {
    for (let seq = 1; seq <= 2003; seq++) state.messages.push({ seq, delivered: seq === 1, held: seq <= 3 })
  })
  assert.deepEqual(store.read().messages.slice(0, 2).map(message => message.seq), [4, 5])
  assert.equal(store.read().messages.length, 2000)
})

test('a failed write keeps its change, retries, and reports recovery once', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, async t => {
  const { directory, path } = await scratch(t)
  let recovered = 0
  const store = await openStore(path, { warn() {} }, { onRecover: () => { recovered++ } })
  t.after(() => store.close())
  await chmod(directory, 0o500)
  try {
    await assert.rejects(store.mutate(state => { state.tasks.a = { id: 'a' } }), StateWriteError)
    await assert.rejects(store.flush(), StateWriteError)
  } finally {
    await chmod(directory, 0o700)
  }
  assert.equal(store.read().tasks.a.id, 'a')
  await store.flush()
  await store.mutate(state => { state.tasks.b = { id: 'b' } })
  await new Promise(setImmediate)
  assert.equal(recovered, 1)
  assert.deepEqual(Object.keys((await openStore(path, console)).read().tasks), ['a', 'b'])
})
