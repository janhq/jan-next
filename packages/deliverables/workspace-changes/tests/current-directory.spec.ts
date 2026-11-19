/** Real file-tool mutations and their before-copies after a Session directory change. */
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@janhq/cordis'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@janhq/jan-agent-loop-testkit'
import { createUserMessage } from '@janhq/jan-llm'
import { SessionId } from '@janhq/jan-session'
import type { SubprocessHandle } from '@janhq/jan-subprocess'
import LocalSubprocessRuntime from '@janhq/jan-subprocess-local'
import { TOOL_ABORTED_BEFORE_DISPATCH } from '@janhq/jan-tools'
import * as ToolFs from '@janhq/jan-tool-fs'
import * as StrReplaceEditor from '@janhq/jan-tool-str-replace-editor'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import * as WorkspaceChanges from '../src/index.ts'
import { git, scratchDir } from './support.ts'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup()
  cleanups.length = 0
})

it.each(['write', 'edit', 'str_replace_editor'] as const)('captures the resolved %s target before mutation, without a repository', async (name) => {
  const origin = await realpath(await mkdtemp(join(tmpdir(), 'jan-workspace-directory-')))
  cleanups.push(() => rm(origin, { recursive: true, force: true }))
  const current = join(origin, 'current')
  await mkdir(current)
  await writeFile(join(origin, 'witness.txt'), 'origin\n')
  await writeFile(join(current, 'witness.txt'), 'before\n')
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await mountAgentLoopTestDependencies(ctx, { workingDirectory: true })
  const harness = await mountAgentLoopTestHarness(ctx)
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(ToolFs)
  await ctx.plugin(StrReplaceEditor)
  await ctx.plugin(WorkspaceChanges)
  const args = name === 'write'
    ? { file_path: 'witness.txt', content: 'after\n' }
    : name === 'edit'
      ? { file_path: 'witness.txt', old_string: 'before', new_string: 'after' }
      : { command: 'str_replace', path: join(current, 'witness.txt'), old_str: 'before', new_str: 'after' }
  ctx.llm.registerAdapter(['mock'], new MockAdapter([toolCallResponse('mutation', name, args), textResponse('done')]))
  const agent = await harness.create(SessionId('capture-current'), { provider: 'mock', model: 'mock' }, { cwd: origin })
  await ctx.workingDirectory.set(agent, current)
  // A later directory change cannot alter the filesystem's already resolved mutation target.
  const changeDirectory = async <T>(next: () => T): Promise<Awaited<T>> => {
    await ctx.workingDirectory.set(agent, origin)
    return await next()
  }
  ctx.on('fs/write-intent', (_target, _actor, next) => changeDirectory(next))
  ctx.on('fs/edit-intent', (_target, _actor, next) => changeDirectory(next))
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'update witness' }], source: { kind: 'user' } }))
  await agent.whenIdle()

  expect(await readFile(join(origin, 'witness.txt'), 'utf8')).toBe('origin\n')
  expect(await readFile(join(current, 'witness.txt'), 'utf8')).toBe('after\n')
  expect(ctx.workingDirectory.get(agent.session)).toBe(origin)
  const events = agent.session.snapshotEvents()
  const result = events.find(event => event.type === 'tool/result')
  expect(result).toMatchObject({ data: { message: { isError: false } } })
  if (name !== 'str_replace_editor') expect(result).toMatchObject({ data: { meta: { path: join(current, 'witness.txt') } } })
  const announcement = events.findLast(event => event.type === 'workspace/changes')
  expect(announcement).toBeDefined()
  const summary = ctx.workspaceChanges.summary(agent.id, announcement!.seq)
  expect(summary).toMatchObject({ cwd: origin, total: 1, files: [{ path: 'current/witness.txt', added: 1, deleted: 1 }] })
  expect(summary!.snapshot).toBeUndefined()
  expect(await ctx.workspaceChanges.diff(agent.id, announcement!.seq, 0, new AbortController().signal)).toMatchObject({ kind: 'text', hunks: [{ lines: ['-before', '+after'] }] })
})

it('stops the turn and cancels Git when the first tool is waiting for its workspace snapshot', async () => {
  const cwd = await scratchDir('jan-workspace-stop-', cleanups)
  git(cwd, 'init', '-q')
  await writeFile(join(cwd, 'witness.txt'), 'before\n')
  git(cwd, 'add', '-A')
  git(cwd, 'commit', '-qm', 'initial')
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await mountAgentLoopTestDependencies(ctx, { workingDirectory: true })
  const harness = await mountAgentLoopTestHarness(ctx)
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(ToolFs)
  await ctx.plugin(WorkspaceChanges)

  const gitStarted = Promise.withResolvers<SubprocessHandle>()
  const releaseGitResult = Promise.withResolvers<undefined>()
  const spawn = ctx.subprocess.spawn.bind(ctx.subprocess)
  const spy = vi.spyOn(ctx.subprocess, 'spawn').mockImplementation((spec) => {
    if (spec.argv[1] !== 'write-tree') return spawn(spec)
    const handle = spawn({ ...spec, argv: [process.execPath, '-e', 'setInterval(() => {}, 1000)'] })
    gitStarted.resolve(handle)
    return { ...handle, done: releaseGitResult.promise.then(() => handle.done) }
  })
  const preparing = Promise.withResolvers<undefined>()
  ctx.on('tools/pre-execute', (_exec, next) => {
    preparing.resolve(undefined)
    return next()
  }, { prepend: true })
  ctx.llm.registerAdapter(['mock'], new MockAdapter([
    toolCallResponse('read', 'read', { file_path: 'witness.txt' }),
  ]))
  const agent = await harness.create(SessionId('stop-baseline'), { provider: 'mock', model: 'mock' }, { cwd })
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'read witness' }], source: { kind: 'user' } }))
  const handle = await gitStarted.promise
  cleanups.push(async () => {
    handle.terminate()
    releaseGitResult.resolve(undefined)
    await handle.done
    spy.mockRestore()
  })
  await preparing.promise

  agent.cancel({ kind: 'user' }, { keepInbox: true })

  const nextTick = Promise.withResolvers<string>()
  setImmediate(nextTick.resolve, 'waiting for Git')
  expect(await Promise.race([agent.whenIdle().then(() => 'idle'), nextTick.promise])).toBe('idle')
  expect(agent.status).toBe('idle')
  expect(agent.session.snapshotEvents().filter(event => event.type === 'tool/result' || event.type === 'turn/end')).toMatchObject([
    { type: 'tool/result', data: { error: { code: TOOL_ABORTED_BEFORE_DISPATCH } } },
    { type: 'turn/end', data: { reason: { kind: 'aborted', reason: { kind: 'user' } } } },
  ])
  expect(await handle.done).not.toEqual({ exitCode: 0, signal: null })
}, 5_000)

it('delegates filesystem intents without a recorded tool actor and preserves a rejecting policy', async () => {
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await mountAgentLoopTestDependencies(ctx, { workingDirectory: true })
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(WorkspaceChanges)
  const target = await ctx.fs.resolve('witness.txt')
  const bare = vi.fn(() => undefined)
  await ctx.waterfall('fs/write-intent', target, undefined, bare)
  await ctx.waterfall('fs/edit-intent', target, {}, bare)
  expect(bare).toHaveBeenCalledTimes(2)
  ctx.on('fs/write-intent', () => { throw new Error('policy denied') })
  await expect(ctx.waterfall('fs/write-intent', target, undefined, bare)).rejects.toThrow('policy denied')
  expect(bare).toHaveBeenCalledTimes(2)
})
