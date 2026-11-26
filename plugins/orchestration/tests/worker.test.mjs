import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { newId, openStore } from '../store.mjs'
import { createWorkers } from '../worker.mjs'

async function setup(t, { presets, expectedCreate = { workspaceId: 'repo' } } = {}) {
  const home = await mkdtemp(join(tmpdir(), 'jan-orch-worker-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const directory = await realpath(home)
  const dispatchId = newId('dsp')
  const coordinator = { kind: 'local', sessionId: 'control' }
  const taskId = newId('task')
  const agent = { id: 'worker', session: { snapshotEvents: () => events } }
  const events = []
  const inputs = []
  const messages = []
  const directories = []
  const store = await openStore(join(directory, 'state.json'), console)
  const ctx = {
    get: name => name === 'agentPresets' && presets ? { list: async () => presets.map(id => ({ id })) } : undefined,
    workspaceRegistry: { list: () => [{ id: 'repo', title: 'Repository', path: directory, sessionIds: ['control'] }] },
    sessionController: {
      create: async request => {
        assert.deepEqual(request, expectedCreate)
        return { sessionId: agent.id }
      },
      resolveAgent: async () => ({ agent }),
    },
    workingDirectory: {
      ensure: async () => directory,
      set: async (target, path) => { directories.push([target.id, path]); return path },
    },
  }
  const signal = new AbortController().signal
  const workers = createWorkers(ctx, store, {
    async send(target, requestId, body) {
      assert.equal(store.read().workers[dispatchId].sessionId, target.id)
      inputs.push({ requestId, body })
    },
  }, async (_worker, message) => { messages.push(message) })
  const start = worktree => workers.startLocalWorker({ dispatchId, taskId, title: '  Draft release NOTES! ', spec: 'Write notes.', worktree, coordinator }, signal)
  return { agent, directories, directory, events, inputs, messages, signal, start, workers }
}

const git = (directory, ...args) => execFileSync('git', ['-C', directory, ...args], { encoding: 'utf8' }).trim()

test('creates and enters a real git worktree before delivering the brief', async t => {
  const { directories, directory, inputs, start } = await setup(t)
  git(directory, 'init', '--quiet')
  git(directory, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgSign=false', 'commit', '--quiet', '--allow-empty', '-m', 'initial')
  const { sessionId, isolation } = await start('new')
  assert.equal(sessionId, 'worker')
  assert.equal(isolation.kind, 'worktree')
  assert.match(isolation.branch, /^jan-draft-release-notes-[a-z2-7]{4}$/)
  assert.equal(isolation.path, join(directory, '.agents', 'worktrees', isolation.branch))
  assert.equal(git(isolation.path, 'branch', '--show-current'), isolation.branch)
  assert.deepEqual(directories, [['worker', isolation.path]])
  assert.match(inputs[0].body, /own git worktree on branch jan-draft-release-notes-/)
})

test('overrides the repository checkout hooks for worktree creation', async t => {
  const { directory, start } = await setup(t)
  git(directory, 'init', '--quiet')
  git(directory, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgSign=false', 'commit', '--quiet', '--allow-empty', '-m', 'initial')
  const hooks = join(directory, 'test-hooks')
  await mkdir(hooks)
  await writeFile(join(hooks, 'post-checkout'), '#!/bin/sh\nexit 17\n', { mode: 0o755 })
  git(directory, 'config', 'core.hooksPath', hooks)
  // A plain checkout is rejected by the configured hook. Orchestration must succeed.
  assert.throws(() => git(directory, 'worktree', 'add', '--quiet', '--detach', join(directory, 'control')), { status: 17 })
  const { isolation } = await start('new')
  assert.equal(isolation.kind, 'worktree')
  assert.equal(git(directory, 'config', 'core.hooksPath'), hooks)
})

test('continues with a shared folder when the project is not a git repository', async t => {
  const { directories, inputs, start } = await setup(t)
  const { isolation } = await start('new')
  assert.equal(isolation.kind, 'shared')
  assert.match(isolation.reason, /not a git repository/)
  assert.deepEqual(directories, [])
  assert.match(inputs[0].body, /shared project folder/)
})

test('starts a worker without a mode in Code mode when the Host has it', async t => {
  const { start } = await setup(t, { presets: ['chat', 'standard'], expectedCreate: { workspaceId: 'repo', agentPreset: 'standard' } })
  await start('current')
})

test('leaves the route default when the Host has no Code mode preset', async t => {
  const { start } = await setup(t, { presets: ['chat'] })
  await start('current')
})

test('reports only one idle update per turn with the latest assistant text', async t => {
  const { agent, events, messages, signal, start, workers } = await setup(t)
  await start('current')
  events.push(
    { type: 'assistant/message', seq: 1, data: { message: { content: [{ type: 'text', text: 'Old response.' }] } } },
    { type: 'assistant/message', seq: 2, data: { message: { content: [{ type: 'text', text: 'Review ' }, { type: 'text', text: 'needed.' }] } } },
    { type: 'turn/end', seq: 3 },
  )
  await workers.onIdle(agent, signal)
  await workers.onIdle(agent, signal)
  assert.deepEqual(messages, [{ type: 'idle', body: 'Review needed.' }])
})
