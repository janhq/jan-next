/** Coordinate durable tasks and worker chats across one or more Jan Hosts. */
import { hostname } from 'node:os'
import { join } from 'node:path'
import { AgentDelivery } from '@janhq/dsh-superagent/queue'
import { registerApi } from '@janhq/jan-plugin-api'
import { activeDispatch, createPeers, readLimit } from './peers.mjs'
import { newId, openStore, StateWriteError } from './store.mjs'
import { orchestrationTools } from './tools.mjs'
import { createWorkers } from './worker.mjs'

/** Cordis plugin name. */
export const name = 'jan-orchestration'
/** Host services used by orchestration and AgentDelivery. */
export const inject = ['janHomePath', 'webServer', 'connection', 'sessionController', 'sessions', 'agents', 'tools', 'workspaceRegistry', 'workingDirectory', 'sessionPersistence']

const LOCAL_NAME = 'This computer'
const terminalTask = task => ['completed', 'failed', 'stopped'].includes(task.status)
const current = (state, task) => state.dispatches[task.dispatchIds.at(-1)]
const isTaskId = value => typeof value === 'string' && /^task_[a-z2-7]{10}$/.test(value)

function ownedTask(state, sessionId, id) {
  const task = isTaskId(id) ? state.tasks[id] : undefined
  if (!task || task.coordinator !== sessionId) throw new Error(`Unknown task ${id}.`)
  return task
}

function append(state, taskId, dispatchId, to, update) {
  const message = { ...update, seq: state.nextSeq++, id: update.id ?? newId('msg'), dispatchId, taskId, to,
    createdAt: update.createdAt ?? Date.now(), delivered: false }
  state.messages.push(message)
  return message
}

function applyUpdate(state, task, dispatch, message) {
  dispatch.lastMessageAt = message.createdAt
  if (!activeDispatch(dispatch)) return false
  const latest = current(state, task) === dispatch
  switch (message.type) {
    case 'done': {
      const succeeded = message.outcome === 'succeeded'
      dispatch.status = succeeded ? 'done' : 'failed'
      if (latest) {
        task.status = succeeded ? 'completed' : 'failed'
        task.result = { outcome: message.outcome, summary: message.body, filesModified: message.filesModified }
      }
      break
    }
    case 'error':
      dispatch.status = 'failed'
      if (latest) task.status = 'failed'
      break
    case 'idle': dispatch.status = 'idle'; break
    case 'status': case 'question': dispatch.status = 'running'; break
  }
  if (latest) task.updatedAt = Date.now()
  return latest && task.status === 'completed'
}

function render(task, message, hostName) {
  let text = `[Task ${task.title} · ${task.id} · ${hostName}] ${message.type.toUpperCase()}: ${message.body}`
  if (message.type === 'done') text += `\nOutcome: ${message.outcome}\nFiles: ${message.filesModified.join(', ')}`
  if (message.type === 'question') {
    text += `\nQuestion id: ${message.questionId} (answer with orchestration_send reply_to)`
    if (message.options?.length) text += `\nOptions: ${message.options.join(' | ')}`
  }
  return text
}

function hostFor(known, host) {
  if (host === undefined || host === 'local') return 'local'
  const match = known.find(peer => peer.id === host) ?? known.find(peer => peer.name.toLowerCase() === host.toLowerCase())
  if (!match) throw new Error(`Unknown host "${host}". Known hosts: ${['local', ...known.map(peer => peer.name || peer.id)].join(', ')}`)
  return match.id
}

function addTasks(state, sessionId, requests, known) {
  const titles = new Map(), staged = new Map(), seen = new Set()
  const entries = requests.map(request => {
    const { title, spec, depends_on, retry_of, host, project, worktree = 'new', mode, agent } = request
    if (!title.trim() || !spec.trim()) throw new Error('Every task needs a title and a brief.')
    let previous
    if (retry_of !== undefined) {
      previous = ownedTask(state, sessionId, retry_of)
      if (!terminalTask(previous)) throw new Error(`Task ${previous.id} is still active.`)
      if (previous.title !== title || previous.spec !== spec) throw new Error('A retry must keep the original title and brief.')
      if (seen.has(previous.id)) throw new Error(`Task ${previous.id} is already in this batch.`)
      seen.add(previous.id)
    }
    let ids = titles.get(title)
    if (!ids) titles.set(title, ids = [])
    const id = previous?.id ?? newId('task')
    ids.push(id)
    const placement = { host: host === undefined && previous ? previous.placement.host : hostFor(known, host),
      project: project ?? previous?.placement.project,
      worktree: request.worktree ?? previous?.placement.worktree ?? worktree,
      mode: mode ?? previous?.placement.mode, agent: agent ?? previous?.placement.agent }
    const at = Date.now()
    const task = { id, coordinator: sessionId, title, spec, dependsOn: [], placement, status: 'pending',
      dispatchIds: previous?.dispatchIds ?? [], createdAt: previous?.createdAt ?? at, updatedAt: at }
    staged.set(id, task)
    return { task, dependsOn: depends_on ?? previous?.dependsOn ?? [] }
  })
  for (const { task, dependsOn } of entries) {
    task.dependsOn = [...new Set(dependsOn.map(ref => {
      const matches = titles.get(ref)
      if (matches?.length === 1) return matches[0]
      if (staged.has(ref) || (isTaskId(ref) && state.tasks[ref]?.coordinator === sessionId)) return ref
      if (matches) throw new Error(`Ambiguous dependency "${ref}"; use a task id.`)
      throw new Error(`Unknown dependency "${ref}".`)
    }))]
  }
  // Existing tasks can already reference a task being retried, so traverse both sets.
  const visiting = new Set(), checked = new Set()
  function visit(id) {
    if (visiting.has(id)) throw new Error('Task dependencies form a cycle.')
    if (checked.has(id)) return
    visiting.add(id)
    for (const dependency of (staged.get(id) ?? state.tasks[id]).dependsOn) visit(dependency)
    visiting.delete(id)
    checked.add(id)
  }
  for (const id of staged.keys()) visit(id)
  for (const [id, task] of staged) state.tasks[id] = task
  return [...staged.keys()]
}

/** Mount the authenticated route, tools, session listeners, and durable peer polling.
 * @param {object} ctx - the orchestration plugin's Cordis context.
 * @returns {Promise<void>} after mounting and attempting pending coordinator deliveries.
 */
export async function apply(ctx) {
  const store = await openStore(join(ctx.janHomePath(), 'orchestration', 'state.json'), ctx.logger, { onRecover: () => {
    resume().catch(error => {
      if (!signal.aborted) ctx.logger.warn(`Could not resume orchestration after saving state: ${error.message}`)
    })
  } })
  const delivery = new AgentDelivery(ctx)
  const lifetime = new AbortController()
  const { signal } = lifetime
  const workers = createWorkers(ctx, store, delivery, emit)
  const peers = createPeers(ctx, store, workers, acceptPeer, signal)
  const launches = new Map()
  const stopping = new Map()

  // Finish what state alone records: coordinator reports not yet delivered,
  // dispatches still starting, peers still to poll and tasks ready to run. This
  // runs at startup and again once a save succeeds after a failed one, because
  // a caller whose save failed skipped this follow-up work.
  async function resume() {
    if (signal.aborted) return
    for (const { ref } of store.read().outbox) peers.notify(ref)
    for (const message of store.read().messages.slice()) {
      if (message.to === 'coordinator' && !message.delivered) await deliverToCoordinator(message, signal)
    }
    const state = store.read()
    for (const task of Object.values(state.tasks)) {
      const dispatch = current(state, task)
      if (task.status === 'dispatched' && dispatch?.status === 'starting' && !launches.has(dispatch.id)) {
        void startDispatch(task, dispatch).catch(error => {
          if (!signal.aborted) ctx.logger.warn(`Could not recover orchestration dispatch ${dispatch.id}: ${error.message}`)
        })
      }
    }
    peers.restore()
    if (Object.values(state.tasks).some(task => task.status === 'pending')) await dispatchReady()
  }

  // A report for a deleted coordinator can never be delivered, so it is retired
  // like a delivered one. An archived coordinator may be restored: its reports
  // stay pending and are delivered on a later start, but are marked held so
  // retention can reclaim them once the message cap is reached.
  async function retire(message) {
    await store.mutate(() => { message.delivered = true; message.retired = true })
  }

  async function deliverToCoordinator(message, control) {
    const task = store.read().tasks[message.taskId]
    if (!task || message.delivered) return
    if (ctx.workspaceRegistry.archivedSessionIds.includes(task.coordinator)) {
      if (!message.held) await store.mutate(() => { message.held = true })
      return
    }
    const dispatch = store.read().dispatches[message.dispatchId]
    try {
      const agent = await workers.resolveAgent(task.coordinator)
      const hostName = dispatch.host === 'local' ? 'this computer' : (await peers.known()).find(peer => peer.id === dispatch.host)?.name || dispatch.host
      await delivery.send(agent, `orch:${message.id}`, render(task, message, hostName), 'queue', control)
    } catch (error) {
      control.throwIfAborted()
      if (error.code === 'session/not-found') return retire(message)
      ctx.logger.warn(`Could not deliver orchestration message ${message.id}: ${error.message}`)
      return
    }
    await store.mutate(() => { message.delivered = true })
  }

  function saveUpdate(state, task, dispatch, update) {
    const message = append(state, task.id, dispatch.id, 'coordinator', update)
    return { message, completed: applyUpdate(state, task, dispatch, message) }
  }

  async function publish(update, control) {
    if (!update) return
    await deliverToCoordinator(update.message, control)
    if (update.completed) await dispatchReady()
  }

  async function emit(worker, update, control) {
    control.throwIfAborted()
    const result = await store.mutate(state => {
      control.throwIfAborted()
      const dispatch = state.dispatches[worker.dispatchId]
      if (worker.doneSent) {
        if (update.type === 'idle') return undefined
        if (update.type === 'done') throw new Error('orchestration_done was already sent for this dispatch')
        throw new Error('This worker already reported completion.')
      }
      if (!activeDispatch(dispatch)) {
        if (update.type === 'idle') return undefined
        throw new Error(`Dispatch ${dispatch.id} is ${dispatch.status}.`)
      }
      if (update.type === 'done') worker.doneSent = true
      if (worker.coordinator.kind === 'local') return saveUpdate(state, state.tasks[worker.taskId], dispatch, update)
      const seq = state.nextSeq++
      const message = { ...update, seq, id: newId('msg'), dispatchId: dispatch.id, taskId: worker.taskId,
        to: 'coordinator', createdAt: Date.now(), delivered: false }
      dispatch.lastMessageAt = message.createdAt
      dispatch.status = update.type === 'done' ? (update.outcome === 'succeeded' ? 'done' : 'failed') : update.type === 'idle' ? 'idle' : 'running'
      state.outbox.push({ seq, ref: worker.coordinator.ref, message })
      return undefined
    })
    if (worker.coordinator.kind === 'remote') peers.notify(worker.coordinator.ref)
    else await publish(result, signal)
  }

  async function acceptPeer(id, { seq, message }, control) {
    control.throwIfAborted()
    const result = await store.mutate(state => {
      control.throwIfAborted()
      if (seq <= (state.peerCursors[id] ?? 0)) return undefined
      const dispatch = state.dispatches[message.dispatchId]
      if (!dispatch || dispatch.host !== id || dispatch.taskId !== message.taskId) throw new Error('Update does not belong to a dispatch on this Host.')
      state.peerCursors[id] = seq
      if (dispatch.status === 'stopped') return undefined
      return saveUpdate(state, state.tasks[dispatch.taskId], dispatch, message)
    })
    await publish(result, control)
  }

  async function launch(task, dispatch) {
    if (!activeDispatch(dispatch) || signal.aborted) return
    const { host, ...placement } = task.placement
    const payload = { dispatchId: dispatch.id, taskId: task.id, title: task.title, spec: task.spec, ...placement }
    let started, qualifiedSessionId
    try {
      if (host === 'local') {
        const agent = ctx.agents.get(task.coordinator)
        const coordinatorName = agent && ctx.get('sessionTitle')?.get?.(agent.session)?.title
        started = await workers.startLocalWorker({ ...payload, coordinator: { kind: 'local', sessionId: task.coordinator,
          ...(coordinatorName && { name: coordinatorName }) } }, signal)
      } else {
        const { hostId: ref } = store.read()
        const peer = (await peers.known()).find(candidate => candidate.id === host)
        started = await peers.call(host, 'peerStart', { ...payload, ref, coordinatorName: hostname() }, signal)
        if (peer?.kind === 'ssh') qualifiedSessionId = `${host}~${started.sessionId}`
      }
    } catch (error) {
      // A failed save keeps the start in memory, and resume() relaunches a dispatch still starting once a save succeeds.
      if (signal.aborted || !activeDispatch(dispatch) || error instanceof StateWriteError) return
      const result = await store.mutate(state => saveUpdate(state, task, dispatch, { type: 'error', body: error.message || String(error) }))
      await publish(result, signal)
      return
    }
    // The worker runs; a failed save here must not mark its task failed.
    await store.mutate(() => {
      Object.assign(dispatch, started, { qualifiedSessionId })
      if (dispatch.status === 'starting') dispatch.status = 'running'
    })
    if (host !== 'local') peers.watch(host)
  }

  async function dispatchReady() {
    if (signal.aborted) return
    const ready = await store.mutate(state => {
      const reserved = []
      for (const task of Object.values(state.tasks)) {
        if (task.status !== 'pending' || stopping.has(task.id) || !task.dependsOn.every(id => state.tasks[id]?.status === 'completed')) continue
        const at = Date.now()
        const dispatch = { id: newId('dsp'), taskId: task.id, host: task.placement.host, status: 'starting', lastMessageAt: at, createdAt: at }
        state.dispatches[dispatch.id] = dispatch
        task.dispatchIds.push(dispatch.id)
        task.status = 'dispatched'
        task.updatedAt = at
        reserved.push({ task, dispatch })
      }
      return reserved
    })
    await Promise.all(ready.map(({ task, dispatch }) => startDispatch(task, dispatch)))
  }

  function startDispatch(task, dispatch) {
    const operation = ctx.agents.withoutInitiator(() => launch(task, dispatch)).finally(() => launches.delete(dispatch.id))
    launches.set(dispatch.id, operation)
    return operation
  }

  function startSummary(state, task) {
    const dispatch = task.status === 'pending' ? undefined : current(state, task)
    return { taskId: task.id, title: task.title, status: task.status, ...(dispatch && {
      dispatchId: dispatch.id, sessionId: dispatch.sessionId, isolation: dispatch.isolation,
    }) }
  }

  async function start(sessionId, requests, control) {
    if (requests.length < 1 || requests.length > 20) throw new Error('Start between 1 and 20 tasks at a time.')
    const { tasks } = store.read()
    const needsPeers = requests.some(({ host, retry_of }) => (host ?? (isTaskId(retry_of) ? tasks[retry_of]?.placement.host : undefined) ?? 'local') !== 'local')
    if (needsPeers && !ctx.get('janHosts')) throw new Error('Other computers need the Hosts plugin.')
    const known = needsPeers ? await peers.known() : []
    control.throwIfAborted()
    const ids = await store.mutate(state => {
      control.throwIfAborted()
      return addTasks(state, sessionId, requests, known)
    })
    await dispatchReady()
    const state = store.read()
    return { tasks: ids.map(id => startSummary(state, state.tasks[id])) }
  }

  function list(sessionId, { status, include_messages: includeMessages } = {}, names) {
    const state = store.read()
    const entries = new Map()
    for (const task of Object.values(state.tasks)) {
      if (task.coordinator === sessionId && (status === undefined || task.status === status)) entries.set(task.id, {
        taskId: task.id, title: task.title, status: task.status, undelivered: 0, ...(includeMessages && { messages: [] }),
      })
    }
    for (let i = state.messages.length - 1; i >= 0; i--) {
      const message = state.messages[i]
      const entry = entries.get(message.taskId)
      if (!entry) continue
      entry.lastMessage ??= { type: message.type, body: message.body, createdAt: message.createdAt }
      if (!message.delivered) entry.undelivered++
      if (includeMessages && entry.messages.length < 20) entry.messages.push(message)
    }
    for (const entry of entries.values()) {
      if (includeMessages) entry.messages.reverse()
      const task = state.tasks[entry.taskId]
      const host = task.placement.host
      const dispatch = task.status === 'pending' ? undefined : current(state, task)
      if (names) {
        entry.hostName = host === 'local' ? LOCAL_NAME : names.get(host) || host
        entry.isolation = dispatch?.isolation
        if (dispatch) entry.dispatch = { id: dispatch.id, status: dispatch.status, sessionId: dispatch.sessionId,
          qualifiedSessionId: dispatch.qualifiedSessionId, host: dispatch.host }
      } else {
        Object.assign(entry, { host, project: task.placement.project, result: task.result })
        if (dispatch) entry.dispatch = { id: dispatch.id, status: dispatch.status, isolation: dispatch.isolation, sessionId: dispatch.sessionId }
      }
    }
    return { tasks: [...entries.values()] }
  }

  async function send(sessionId, { to, message: body, reply_to: questionId, urgent }, control) {
    if (questionId !== undefined && !/^q_[a-z2-7]{10}$/.test(questionId)) throw new Error('Use the question id from the worker update.')
    const queued = await store.mutate(state => {
      const targets = to === '@all' || to === '@idle' ? Object.values(state.tasks).filter(task => {
        if (task.coordinator !== sessionId || terminalTask(task)) return false
        const dispatch = current(state, task)
        return dispatch?.sessionId && activeDispatch(dispatch) && (to === '@all' || dispatch.status === 'idle')
      }) : [ownedTask(state, sessionId, to)]
      return targets.map(task => {
        if (terminalTask(task)) throw new Error(`Task ${task.id} is ${task.status}; start a retry with orchestration_start`)
        const dispatch = current(state, task)
        if (!dispatch?.sessionId || !activeDispatch(dispatch)) throw new Error(`Task ${task.id} does not have an active worker yet.`)
        const message = append(state, task.id, dispatch.id, 'worker', { type: questionId === undefined ? 'message' : 'answer', body, questionId, urgent })
        return { dispatch, message }
      })
    })
    const sent = await Promise.all(queued.map(async ({ dispatch, message }) => {
      if (dispatch.host === 'local') await workers.deliverToWorker(dispatch.id, message, control)
      else await peers.call(dispatch.host, 'peerSend', { ref: store.read().hostId, dispatchId: dispatch.id, message }, control)
      await store.mutate(() => {
        message.delivered = true
        dispatch.lastMessageAt = Date.now()
        if (dispatch.status === 'idle') dispatch.status = 'running'
      })
      return message.taskId
    }))
    return { sent }
  }

  async function read(sessionId, id, limit, control) {
    const state = store.read()
    const task = ownedTask(state, sessionId, id)
    const dispatch = current(state, task)
    if (task.status === 'pending' || !dispatch?.sessionId) throw new Error(`Task ${task.id} does not have a worker yet.`)
    const count = readLimit(limit)
    return dispatch.host === 'local' ? workers.readWorker(dispatch.id, count)
      : peers.call(dispatch.host, 'peerRead', { ref: state.hostId, dispatchId: dispatch.id, limit: count }, control)
  }

  function stop(sessionId, id, control) {
    const task = ownedTask(store.read(), sessionId, id)
    let operation = stopping.get(id)
    if (operation) return operation
    operation = (async () => {
      if (terminalTask(task)) return { stopped: true }
      const dispatch = task.status === 'pending' ? undefined : current(store.read(), task)
      // An unreachable Host must not keep the task running here: record the
      // stop, and the peer's poll loop delivers it when that Host is back. A
      // Host that refuses the stop answered, so there is nothing to retry.
      let unreachable, refused
      if (dispatch && dispatch.host !== 'local') {
        await launches.get(dispatch.id)
        if (dispatch.sessionId) {
          try {
            await peers.call(dispatch.host, 'peerStop', { ref: store.read().hostId, dispatchId: dispatch.id }, control)
          } catch (error) {
            control.throwIfAborted()
            if (error.rejected) refused = error.message
            else unreachable = error.message
          }
        }
      }
      await store.mutate(() => {
        if (terminalTask(task)) return
        if (dispatch) dispatch.status = 'stopped'
        if (unreachable) dispatch.remoteStop = true
        task.status = 'stopped'
        task.updatedAt = Date.now()
      })
      if (dispatch?.host === 'local' && dispatch.status === 'stopped') {
        const worker = store.read().workers[dispatch.id]
        if (worker) ctx.agents.get(worker.sessionId)?.cancel({ kind: 'hook', reason: 'Stopped by the coordinator' })
      }
      if (refused) return { stopped: true, note: `${refused} The task is stopped here.` }
      if (!unreachable) return { stopped: true }
      peers.watch(dispatch.host)
      return { stopped: true, note: `${unreachable} The worker there stops once that computer is reachable again.` }
    })().finally(() => stopping.delete(id))
    stopping.set(id, operation)
    return operation
  }

  async function update(sessionId, data, control) {
    const worker = workers.forSession(sessionId)
    if (!worker) throw new Error('This chat is not an orchestration worker.')
    const questionId = data.type === 'question' ? newId('q') : undefined
    await ctx.agents.withoutInitiator(() => emit(worker, { ...data, questionId }, control))
    return questionId ? { questionId, note: 'End your turn now; the answer arrives as a new message.' } : { reported: true }
  }

  async function forgetPeer(id) {
    const updates = await peers.forget(id, state => {
      const results = []
      for (const dispatch of Object.values(state.dispatches)) {
        if (dispatch.host !== id || !activeDispatch(dispatch)) continue
        results.push(saveUpdate(state, state.tasks[dispatch.taskId], dispatch, { type: 'error', body: 'This Host was removed in Settings.' }))
      }
      return results
    })
    await Promise.all(updates.map(update => publish(update, signal)))
  }

  const methods = {
    ...peers.methods,
    async uiTasks({ coordinatorSessionId }) {
      if (typeof coordinatorSessionId !== 'string') throw new Error('Expected a coordinator session id.')
      const names = new Map((await peers.known()).map(peer => [peer.id, peer.name]))
      return list(coordinatorSessionId, undefined, names)
    },
    uiStop({ taskId }) {
      const task = isTaskId(taskId) ? store.read().tasks[taskId] : undefined
      if (!task) throw new Error(`Unknown task ${taskId}.`)
      return stop(task.coordinator, taskId, signal)
    },
  }
  ctx.effect(() => registerApi(ctx, 'orchestration', methods, { maxBodyBytes: 1024 * 1024 }))
  for (const { def, when } of orchestrationTools({ start, targets: peers.targets, tasks: list, send, read, stop, update, workerForSession: workers.forSession })) {
    ctx.effect(() => ctx.tools.register(def, { when }))
  }
  ctx.on('agent/status', ({ agent, status }) => {
    if (status !== 'idle' || signal.aborted) return
    return ctx.agents.withoutInitiator(() => workers.onIdle(agent, signal)).catch(error => {
      if (!signal.aborted) ctx.logger.warn(`Could not report worker ${agent.id} idle: ${error.message}`)
    })
  }, { global: true })
  ctx.on('agent/disposed', ({ agent }) => workers.onDisposed(agent), { global: true })
  ctx.on('jan-hosts/removed', id => forgetPeer(id).catch(error => {
    if (!signal.aborted) ctx.logger.warn(`Could not forget orchestration peer ${id}: ${error.message}`)
  }), { global: true })
  ctx.effect(() => async () => {
    lifetime.abort(new Error('Orchestration plugin disposed.'))
    await Promise.allSettled([...launches.values(), ...stopping.values(), peers.drain(), workers.drain()])
    store.close()
    await store.flush()
  })
  await resume()
}
