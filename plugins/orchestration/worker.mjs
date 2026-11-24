/** Worker session creation, isolation, message delivery and transcript reads on this Host. */
import { execFile } from 'node:child_process'
import { mkdtemp, rmdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { newId } from './store.mjs'

const exec = promisify(execFile)
const slug = title => title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40).replace(/-$/, '') || 'task'
const text = (content, limit) => {
  let value = ''
  for (const block of content) {
    if (block.type !== 'text') continue
    value += block.text.slice(0, limit - value.length)
    if (value.length === limit) break
  }
  return value
}

function brief({ spec, coordinator, taskId, dispatchId }, path, isolation) {
  const location = isolation.kind === 'worktree' ? `own git worktree on branch ${isolation.branch}` : 'shared project folder'
  return `You are a worker started by a coordinator chat ("${coordinator.name ?? 'this chat'}") to do one task.
Task id: ${taskId} · Dispatch id: ${dispatchId}
Working directory: ${path} (${location})

${spec}

Rules:
- Work autonomously; use subagents if useful.
- Use orchestration_report for short progress updates at meaningful milestones (not more than every few minutes).
- If you are blocked on a decision only the coordinator can make, call orchestration_ask and end your turn; the answer arrives as a new message.
- When finished (or if you cannot finish), call orchestration_done exactly once with outcome "succeeded" or "failed", a summary of what was done, what was found and what remains, and the files you changed.`
}

async function addGitWorktree(cwd, name, signal) {
  const git = (directory, ...args) => exec('git', ['-C', directory, '-c', 'core.fsmonitor=false', ...args], {
    encoding: 'utf8', env: { ...process.env, GIT_LFS_SKIP_SMUDGE: '1' }, timeout: 60_000, signal,
  })
  const { stdout } = await git(cwd, 'rev-parse', '--show-toplevel')
  const root = stdout.replace(/\r?\n$/, '')
  const branch = `jan-${name}-${newId('dsp').slice(-4)}`
  const path = join(root, '.agents', 'worktrees', branch)
  const hooks = process.platform === 'win32' ? await mkdtemp(join(tmpdir(), 'jan-orch-hooks-')) : undefined
  try {
    await git(root, '-c', `core.hooksPath=${hooks ?? '/dev/null'}`, 'worktree', 'add', '-b', branch, path, 'HEAD')
  } finally {
    if (hooks !== undefined) await rmdir(hooks)
  }
  return { path, branch }
}

// Workers edit files and run commands, so a dispatch without a mode starts in
// Code mode when this Host has it, not in the route default (Chat mode on Desktop).
const CODE_PRESET = 'standard'

async function workerPreset(ctx, mode) {
  if (mode) return mode
  const presets = ctx.get('agentPresets')
  return presets && (await presets.list()).some(preset => preset.id === CODE_PRESET) ? CODE_PRESET : undefined
}

/** Bind worker operations and a session index to one orchestration instance.
 * @param {object} ctx - project, session and working-directory services.
 * @param {object} store - durable orchestration state.
 * @param {object} delivery - idempotent AgentDelivery instance.
 * @param {Function} emit - emits a coordinator-bound update for a worker.
 * @returns {object} local worker operations and session lookup.
 */
export function createWorkers(ctx, store, delivery, emit) {
  const bySession = new Map(Object.values(store.read().workers).map(worker => [worker.sessionId, worker]))
  const idleTurns = new Map()
  const starting = new Map()

  async function resolveAgent(sessionId) {
    const value = await ctx.sessionController.resolveAgent(sessionId)
    if ('error' in value) throw value.error
    return value.agent
  }

  function workspaceId(project, coordinator) {
    const projects = ctx.workspaceRegistry.list()
    if (project === undefined) {
      return coordinator.kind === 'local'
        ? projects.find(row => row.sessionIds.includes(coordinator.sessionId))?.id
        : undefined
    }
    const name = project.toLowerCase()
    const match = projects.find(row => row.title.toLowerCase() === name) ?? projects.find(row => row.path === project)
    if (!match) throw new Error(`Unknown project "${project}". Known projects: ${projects.map(row => row.title).join(', ')}`)
    return match.id
  }

  async function isolate(agent, title, worktree, cwd, signal) {
    if (worktree === 'current') return { kind: 'shared', reason: 'requested' }
    const name = slug(title)
    const worktrees = ctx.get('worktrees')
    let path, branch
    try {
      if (worktrees) {
        ({ path, branch } = await worktrees.create(agent, { name }, signal))
      } else {
        ({ path, branch } = await addGitWorktree(cwd, name, signal))
      }
    } catch (error) {
      signal.throwIfAborted()
      return { kind: 'shared', reason: (error.stderr?.trim() || error.message || String(error)).split(/\r?\n/, 1)[0] }
    }
    if (!worktrees) path = await ctx.workingDirectory.set(agent, path, signal)
    return { kind: 'worktree', path, branch }
  }

  function assertActive(dispatchId, signal) {
    signal.throwIfAborted()
    if (store.read().dispatches[dispatchId]?.status === 'stopped') throw new Error(`Dispatch ${dispatchId} was stopped.`)
  }

  async function createOrResume(payload, signal) {
    const { dispatchId, taskId, title, project, worktree, mode, agent: profile, coordinator } = payload
    assertActive(dispatchId, signal)
    let worker = store.read().workers[dispatchId]
    let isolation = store.read().dispatches[dispatchId]?.isolation
    let agent, cwd, sessionId
    if (worker) {
      ({ sessionId } = worker)
      // A relaunch after a failed save may find a worker its first launch never indexed.
      bySession.set(sessionId, worker)
      if (worker.doneSent || store.read().dispatches[dispatchId].status !== 'starting') return { sessionId, isolation }
      agent = await resolveAgent(sessionId)
      if (isolation.kind === 'shared') cwd = await ctx.workingDirectory.ensure(agent, signal)
    } else {
      const id = workspaceId(project, coordinator)
      const preset = await workerPreset(ctx, mode)
      const created = await ctx.sessionController.create({ ...(id ? { workspaceId: id } : {}),
        ...(preset ? { agentPreset: preset } : {}), ...(profile === undefined ? {} : { agentProfile: profile }) })
      sessionId = created.sessionId
      agent = await resolveAgent(sessionId)
      assertActive(dispatchId, signal)
      if (ctx.get('sessionTitle')) await ctx.sessionController.rename({ sessionId, title })
      cwd = await ctx.workingDirectory.ensure(agent, signal)
      isolation = await isolate(agent, title, worktree, cwd, signal)
      worker = { dispatchId, taskId, sessionId, title, coordinator, doneSent: false }
      await store.mutate(state => {
        assertActive(dispatchId, signal)
        const dispatch = state.dispatches[dispatchId] ??= { id: dispatchId, taskId, host: 'local', status: 'starting', createdAt: Date.now() }
        Object.assign(dispatch, { sessionId, isolation })
        state.workers[dispatchId] = worker
      })
      bySession.set(sessionId, worker)
    }
    await delivery.send(agent, `orch-brief:${dispatchId}`, brief(payload, isolation.path ?? cwd, isolation), 'queue', signal,
      () => assertActive(dispatchId, signal))
    await store.mutate(state => {
      const dispatch = state.dispatches[dispatchId]
      if (dispatch.status === 'starting') dispatch.status = 'running'
    })
    return { sessionId, isolation }
  }

  function startLocalWorker(payload, signal) {
    const { dispatchId } = payload
    let operation = starting.get(dispatchId)
    if (!operation) {
      operation = createOrResume(payload, signal).finally(() => starting.delete(dispatchId))
      starting.set(dispatchId, operation)
    }
    return operation
  }

  function workerForDispatch(dispatchId) {
    const worker = store.read().workers[dispatchId]
    if (!worker) throw new Error(`Unknown worker dispatch ${dispatchId}.`)
    return worker
  }

  async function deliverToWorker(dispatchId, message, signal) {
    assertActive(dispatchId, signal)
    const worker = workerForDispatch(dispatchId)
    const agent = await resolveAgent(worker.sessionId)
    const prefix = message.type === 'answer' ? `[Coordinator answer to ${message.questionId}]` : '[Coordinator]'
    await delivery.send(agent, `orch:${message.id}`, `${prefix} ${message.body}`, message.urgent ? 'steer' : 'queue', signal,
      () => assertActive(dispatchId, signal))
  }

  async function stopLocalWorker(dispatchId) {
    const worker = workerForDispatch(dispatchId)
    const agent = ctx.agents.get(worker.sessionId)
    const stopped = await store.mutate(state => {
      const dispatch = state.dispatches[dispatchId]
      if (['done', 'failed', 'stopped'].includes(dispatch.status)) return false
      dispatch.status = 'stopped'
      return true
    })
    if (stopped) agent?.cancel({ kind: 'hook', reason: 'Stopped by the coordinator' })
  }

  async function readWorker(dispatchId, limit) {
    const { sessionId } = workerForDispatch(dispatchId)
    const agent = await resolveAgent(sessionId)
    const events = agent.session.snapshotEvents()
    const messages = []
    for (let i = events.length - 1; i >= 0 && messages.length < limit; i--) {
      const event = events[i]
      const message = event.type === 'user/message' ? event.data : event.type === 'assistant/message' ? event.data.message : undefined
      if (!message) continue
      const body = text(message.content, 2000)
      if (body) messages.push({ role: event.type === 'user/message' ? 'user' : 'assistant', text: body })
    }
    return messages.reverse()
  }

  async function onIdle(agent, signal) {
    const worker = bySession.get(agent.id)
    if (!worker || worker.doneSent || store.read().dispatches[worker.dispatchId]?.status === 'stopped') return
    const events = agent.session.snapshotEvents()
    const seq = events.findLast(event => event.type === 'turn/end')?.seq
    const previous = idleTurns.get(worker.dispatchId)
    if (seq === undefined || (previous !== undefined && seq <= previous)) return
    const last = events.findLast(event => event.type === 'assistant/message')
    idleTurns.set(worker.dispatchId, seq)
    try {
      await emit(worker, { type: 'idle', body: last ? text(last.data.message.content, 1200) : '' }, signal)
    } catch (error) {
      if (idleTurns.get(worker.dispatchId) === seq) idleTurns.set(worker.dispatchId, previous)
      throw error
    }
  }

  function onDisposed(agent) {
    const worker = bySession.get(agent.id)
    if (worker) idleTurns.delete(worker.dispatchId)
  }

  return { resolveAgent, startLocalWorker, deliverToWorker, stopLocalWorker, readWorker, onIdle, onDisposed,
    forSession: sessionId => bySession.get(sessionId), drain: () => Promise.allSettled(starting.values()) }
}
