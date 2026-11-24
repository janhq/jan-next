/** Authenticated orchestration calls and durable outbox polling between Jan Hosts. */
import { hostname } from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'

const LONG_POLL_MS = 25_000
const BACKOFF = [1_000, 2_000, 5_000, 10_000]
const FEATURE = 'orchestration'
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i
const dispatchIdPattern = /^dsp_[a-z2-7]{10}$/
const taskIdPattern = /^task_[a-z2-7]{10}$/
const messageIdPattern = /^msg_[a-z2-7]{10}$/
const questionIdPattern = /^q_[a-z2-7]{10}$/
const optionalText = value => value === undefined || typeof value === 'string'
const textList = value => Array.isArray(value) && value.every(item => typeof item === 'string')

function isUpdate(message, seq) {
  if (!message || message.seq !== seq || message.to !== 'coordinator' || typeof message.body !== 'string'
    || typeof message.id !== 'string' || !messageIdPattern.test(message.id)
    || typeof message.dispatchId !== 'string' || !dispatchIdPattern.test(message.dispatchId)
    || typeof message.taskId !== 'string' || !taskIdPattern.test(message.taskId)
    || !Number.isSafeInteger(message.createdAt) || message.createdAt < 0) return false
  switch (message.type) {
    case 'status': case 'idle': case 'error': return true
    case 'question': return typeof message.questionId === 'string' && questionIdPattern.test(message.questionId)
      && (message.options === undefined || textList(message.options))
    case 'done': return ['succeeded', 'failed'].includes(message.outcome) && textList(message.filesModified)
    default: return false
  }
}

/** Return whether a coordinator dispatch can still receive worker activity.
 * @param {object} dispatch - orchestration dispatch record.
 * @returns {boolean} whether the dispatch is starting, running or idle.
 */
export function activeDispatch(dispatch) {
  return dispatch?.status === 'starting' || dispatch?.status === 'running' || dispatch?.status === 'idle'
}

/** Use the same bounded transcript tail for local, remote and tool callers.
 * @param {number} [limit] - requested response length.
 * @returns {number} a valid bounded message count.
 */
export function readLimit(limit = 20) {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Choose a positive number of messages.')
  return Math.min(limit, 50)
}

/** Bind the executing and coordinating sides of the federation protocol.
 * @param {object} ctx - workspaces and optional Hosts service.
 * @param {object} store - this Host's state.
 * @param {object} workers - local worker operations.
 * @param {Function} accept - consumes one coordinator-bound message from a peer.
 * @param {AbortSignal} signal - plugin lifetime.
 * @returns {object} peer methods, discovery and poll lifecycle.
 */
export function createPeers(ctx, store, workers, accept, signal) {
  const listeners = new Map()
  const loops = new Map()
  const forgotten = new Set()
  const local = () => ({ hostName: hostname(), projects: ctx.workspaceRegistry.list().map(({ title, path }) => ({ title, path })) })
  const known = () => ctx.get('janHosts')?.peers() ?? []
  const forPeer = id => Object.hasOwn(store.read().peerCursors, id) ? store.read().peerCursors[id] : 0
  const owesAck = id => forPeer(id) > (store.read().peerAcks[id] ?? 0)

  function request(id, method, params, control) {
    const hosts = ctx.get('janHosts')
    if (!hosts) throw new Error('Other computers need the Hosts plugin.')
    return hosts.callPlugin(id, FEATURE, method, params, control)
  }

  async function call(peerId, method, params, control) {
    try {
      return await request(peerId, method, params, control)
    } catch (error) {
      control.throwIfAborted()
      const list = await known()
      const name = list.find(peer => peer.id === peerId)?.name || peerId
      throw new Error(`${name} is not reachable: ${error.message}`, { cause: error })
    }
  }

  async function targets(control) {
    const here = local()
    const peers = await known()
    const remote = await Promise.all(peers.map(async peer => {
      if (peer.state === 'connected') {
        try {
          const { projects } = await request(peer.id, 'peerProjects', {}, AbortSignal.any([control, AbortSignal.timeout(10_000)]))
          return { host: peer.id, name: peer.name, state: 'connected', projects }
        } catch (error) {
          control.throwIfAborted()
          ctx.logger.warn(`Unable to list projects on ${peer.name || peer.id}: ${error.message}`)
        }
      }
      return { host: peer.id, name: peer.name, state: 'offline', projects: [] }
    }))
    return { hosts: [{ host: 'local', name: here.hostName, state: 'connected', projects: here.projects }, ...remote] }
  }

  function notify(ref) {
    for (const wake of listeners.get(ref) ?? []) wake()
  }

  function available(ref, after) {
    const messages = []
    for (const entry of store.read().outbox) {
      if (entry.ref !== ref || entry.seq <= after) continue
      messages.push(entry)
      if (messages.length === 100) break
    }
    return messages
  }

  async function peerPull({ ref, after, waitMs = 0 }) {
    if (typeof ref !== 'string' || !uuid.test(ref) || !Number.isSafeInteger(after) || after < 0
      || !Number.isSafeInteger(waitMs) || waitMs < 0) throw new Error('Invalid peer pull request.')
    let messages = available(ref, after)
    if (!messages.length && waitMs && !signal.aborted) {
      await new Promise(resolve => {
        const pending = listeners.get(ref) ?? new Set()
        listeners.set(ref, pending)
        const wake = () => {
          clearTimeout(timer)
          signal.removeEventListener('abort', wake)
          pending.delete(wake)
          if (!pending.size) listeners.delete(ref)
          resolve()
        }
        const timer = setTimeout(wake, Math.min(waitMs, LONG_POLL_MS))
        timer.unref()
        pending.add(wake)
        signal.addEventListener('abort', wake, { once: true })
      })
      messages = available(ref, after)
    }
    return { messages }
  }

  async function peerAck({ ref, upTo }) {
    if (typeof ref !== 'string' || !uuid.test(ref) || !Number.isSafeInteger(upTo) || upTo < 0) throw new Error('Invalid peer acknowledgement.')
    if (store.read().outbox.some(entry => entry.ref === ref && entry.seq <= upTo)) {
      await store.mutate(state => { state.outbox = state.outbox.filter(entry => entry.ref !== ref || entry.seq > upTo) })
    }
    return { acknowledged: true }
  }

  function requireRemoteWorker(dispatchId) {
    if (typeof dispatchId !== 'string' || !dispatchIdPattern.test(dispatchId)
      || store.read().workers[dispatchId]?.coordinator.kind !== 'remote') throw new Error('Unknown remote worker dispatch.')
  }

  const methods = {
    peerStart({ ref, coordinatorName, dispatchId, taskId, title, spec, project, worktree, mode, agent }) {
      if (typeof ref !== 'string' || !uuid.test(ref) || typeof coordinatorName !== 'string'
        || typeof dispatchId !== 'string' || !dispatchIdPattern.test(dispatchId) || typeof taskId !== 'string' || !taskIdPattern.test(taskId)
        || typeof title !== 'string' || !title.trim() || typeof spec !== 'string' || !spec.trim()
        || !optionalText(project) || !optionalText(mode) || !optionalText(agent) || !['new', 'current'].includes(worktree)) {
        throw new Error('Invalid remote task.')
      }
      const { workers: records, dispatches } = store.read()
      const existing = records[dispatchId]
      if (existing) {
        if (existing.coordinator.kind !== 'remote' || existing.coordinator.ref !== ref || existing.taskId !== taskId) {
          throw new Error('Dispatch is already assigned to a different task or coordinator.')
        }
        if (dispatches[dispatchId].status !== 'starting') return { sessionId: existing.sessionId, isolation: dispatches[dispatchId].isolation }
      } else if (dispatches[dispatchId]) {
        throw new Error('Dispatch is already assigned to a different task or coordinator.')
      }
      return workers.startLocalWorker({ dispatchId, taskId, title, spec, project, worktree, mode, agent,
        coordinator: { kind: 'remote', ref, name: coordinatorName } }, signal)
    },
    async peerSend({ dispatchId, message }) {
      requireRemoteWorker(dispatchId)
      if (!message || typeof message.id !== 'string' || !messageIdPattern.test(message.id) || typeof message.body !== 'string'
        || !['message', 'answer'].includes(message.type)
        || (message.type === 'answer' && (typeof message.questionId !== 'string' || !questionIdPattern.test(message.questionId)))
        || (message.urgent !== undefined && typeof message.urgent !== 'boolean')) throw new Error('Invalid worker message.')
      await workers.deliverToWorker(dispatchId, message, signal)
      return { delivered: true }
    },
    async peerStop({ dispatchId }) {
      requireRemoteWorker(dispatchId)
      await workers.stopLocalWorker(dispatchId)
      return { stopped: true }
    },
    peerRead({ dispatchId, limit }) {
      requireRemoteWorker(dispatchId)
      return workers.readWorker(dispatchId, readLimit(limit))
    },
    peerPull,
    peerAck,
    peerProjects: local,
  }

  const hasActive = id => Object.values(store.read().dispatches).some(dispatch => dispatch.host === id && activeDispatch(dispatch))

  async function pullLoop(id, peerSignal) {
    const ref = store.read().hostId
    const control = AbortSignal.any([signal, peerSignal])
    let failures = 0
    while (!control.aborted) {
      try {
        const after = forPeer(id)
        if (owesAck(id)) {
          await request(id, 'peerAck', { ref, upTo: after }, control)
          await store.mutate(state => {
            if (!forgotten.has(id)) state.peerAcks[id] = after
          })
        }
        if (!hasActive(id)) return
        const { messages } = await request(id, 'peerPull', { ref, after, waitMs: LONG_POLL_MS }, control)
        control.throwIfAborted()
        for (const entry of messages) {
          if (entry?.ref !== ref || !Number.isSafeInteger(entry.seq) || entry.seq <= 0 || !isUpdate(entry.message, entry.seq)) {
            throw new Error('Invalid orchestration peer update.')
          }
          await accept(id, entry, control)
        }
        failures = 0
      } catch (error) {
        if (control.aborted) return
        ctx.logger.warn(`Orchestration could not receive updates from ${id}: ${error.message}`)
        const pause = BACKOFF[Math.min(failures++, BACKOFF.length - 1)]
        await delay(pause, undefined, { signal: control, ref: false })
      }
    }
  }

  function watch(id) {
    if (loops.has(id) || signal.aborted || forgotten.has(id)) return
    const controller = new AbortController()
    const operation = ctx.agents.withoutInitiator(() => pullLoop(id, controller.signal)).catch(error => {
      if (!(signal.aborted || controller.signal.aborted)) ctx.logger.warn(`Orchestration polling ended for ${id}: ${error.message}`)
    }).finally(() => {
      loops.delete(id)
      // A dispatch may have started while the previous loop was retiring.
      if (hasActive(id)) watch(id)
    })
    loops.set(id, { controller, operation })
  }

  async function forget(id, applyRemoval) {
    forgotten.add(id)
    loops.get(id)?.controller.abort()
    await loops.get(id)?.operation
    return store.mutate(state => {
      delete state.peerCursors[id]
      delete state.peerAcks[id]
      return applyRemoval(state)
    })
  }

  function restore() {
    // A terminal message may have been committed just before shutdown interrupted its ack.
    const ids = new Set(Object.keys(store.read().peerCursors).filter(owesAck))
    for (const dispatch of Object.values(store.read().dispatches)) {
      if (dispatch.host !== 'local' && activeDispatch(dispatch)) ids.add(dispatch.host)
    }
    for (const id of ids) watch(id)
  }

  return { call, known, methods, notify, restore, targets, watch, forget,
    drain: () => Promise.all(Array.from(loops.values(), entry => entry.operation)) }
}
