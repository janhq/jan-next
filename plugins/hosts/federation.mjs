/**
 * Host federation: the gateway forwarder that lets this window list and use projects and chats
 * that live on other connected Jans. Ids from another Jan are qualified as `<hostId>~<id>`
 * (Host ids are UUIDs; Session and Workspace ids never contain `~`), so every Client map keeps
 * one id space. Calls naming a qualified id go to that Jan with the plain id; the sidebar's
 * streams merge this Host's items with every connected Jan's.
 */

const SEP = '~'
/** Wire fields holding one Session or Workspace id. */
const ID_KEYS = new Set(['sessionId', 'workspaceId', 'parentSessionId', 'childSessionId', 'agentId', 'beforeSessionId', 'beforeWorkspaceId'])
/** Wire fields holding a list of those ids. */
const ID_LIST_KEYS = new Set(['sessionIds', 'workspaceIds', 'archivedSessionIds', 'pinnedSessionIds'])

export function qualifyId(hostId, id) {
  return `${hostId}${SEP}${id}`
}

export function splitQualifiedId(id) {
  const at = typeof id === 'string' ? id.indexOf(SEP) : -1
  return at <= 0 ? undefined : { hostId: id.slice(0, at), id: id.slice(at + 1) }
}

function isPlain(value) {
  return typeof value === 'object' && value !== null && !ArrayBuffer.isView(value)
}

/** Copy `value`, passing every id-bearing field through `map`. */
export function mapIds(value, map) {
  if (Array.isArray(value)) return value.map(item => mapIds(item, map))
  if (!isPlain(value)) return value
  const out = {}
  for (const [key, item] of Object.entries(value)) {
    if (ID_KEYS.has(key) && typeof item === 'string') out[key] = map(item)
    else if (ID_LIST_KEYS.has(key) && Array.isArray(item)) out[key] = item.map(id => typeof id === 'string' ? map(id) : id)
    else out[key] = mapIds(item, map)
  }
  return out
}

/** The Host ids named by qualified ids anywhere in `value`. */
function namedHosts(value, hosts) {
  const found = new Set()
  mapIds(value, (id) => {
    const split = splitQualifiedId(id)
    if (split !== undefined && hosts.has(split.hostId)) found.add(split.hostId)
    return id
  })
  return found
}

function failure(code, message) {
  return { ok: false, error: { code, message, details: {} } }
}

function wireFailure(error) {
  if (error?.wire !== undefined) return { ok: false, error: error.wire }
  return failure('gateway/service-unavailable', error instanceof Error ? error.message : String(error))
}

/** A pull queue many producers push into; iteration ends when `signal` aborts. */
function channel(signal) {
  const items = []
  let wake
  let error
  const kick = () => { const resume = wake; wake = undefined; resume?.() }
  signal.addEventListener('abort', kick, { once: true })
  return {
    push(item) { items.push(item); kick() },
    fail(reason) { error ??= reason; kick() },
    async *[Symbol.asyncIterator]() {
      while (true) {
        if (items.length > 0) { yield items.shift(); continue }
        if (error !== undefined) throw error
        if (signal.aborted) return
        await new Promise((resolve) => { wake = resolve })
      }
    },
  }
}

/** Fold one Workspace follow frame into `{ items, archived, pinned }`. */
function foldWorkspace(state, frame) {
  switch (frame.type) {
    case 'baseline':
    case 'replace':
      return { items: [...frame.value.items], archived: [...frame.value.archivedSessionIds], pinned: [...frame.value.pinnedSessionIds] }
    case 'upsert': {
      const at = state.items.findIndex(item => item.workspaceId === frame.workspace.workspaceId)
      const items = at === -1 ? [frame.workspace, ...state.items] : state.items.map((item, index) => index === at ? frame.workspace : item)
      return { ...state, items }
    }
    case 'remove':
      return { ...state, items: state.items.filter(item => item.workspaceId !== frame.workspaceId) }
    case 'order': {
      const rank = new Map(frame.workspaceIds.map((id, index) => [id, index]))
      const items = [...state.items].sort((a, b) => (rank.get(a.workspaceId) ?? Infinity) - (rank.get(b.workspaceId) ?? Infinity))
      return { ...state, items }
    }
    case 'archived':
      return { ...state, archived: [...frame.archivedSessionIds] }
    case 'pinned':
      return { ...state, pinned: [...frame.pinnedSessionIds] }
    default:
      return state
  }
}

/**
 * @param {{ logger: { warn: Function } }} ctx
 * @returns the federation: `attach`/`detach` connected Jans and the gateway `forwarder`.
 */
export function createFederation(ctx) {
  /** hostId -> { id, name, link } for every connected Jan. */
  const hosts = new Map()
  /** Last Workspace state seen per Jan, kept while its link is down so rows do not jump. */
  const lastWorkspaces = new Map()
  const listeners = new Set()
  const changed = () => { for (const listener of [...listeners]) listener() }
  const subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener) }

  function linkFor(hostId) {
    const host = hosts.get(hostId)
    if (host === undefined) throw Object.assign(new Error('That computer is not connected.'), { wire: { code: 'gateway/service-unavailable', message: 'That computer is not connected. Connect it in Settings, Hosts.', details: {} } })
    return host
  }

  const qualifier = hostId => id => qualifyId(hostId, id)
  const unqualifier = hostId => (id) => {
    const split = splitQualifiedId(id)
    return split?.hostId === hostId ? split.id : id
  }

  async function callHost(hostId, endpoint, args, signal) {
    const host = linkFor(hostId)
    const result = await host.link.callWire(endpoint, { args: mapIds(args, unqualifier(hostId)) }, signal)
    return result.ok ? { ...result, value: mapIds(result.value, qualifier(hostId)) } : result
  }

  /** Session list and search answer with every connected Jan's rows. */
  async function mergeList(endpoint, args, signal, local) {
    const own = await local()
    if (!own.ok) return own
    const others = await Promise.all([...hosts.keys()].map(hostId => callHost(hostId, endpoint, args, signal).catch(() => undefined)))
    const items = [...own.value.items]
    let hasMore = own.value.hasMore
    for (const result of others) {
      if (result?.ok !== true) continue
      items.push(...result.value.items)
      if (result.value.hasMore === true) hasMore = true
    }
    return { ...own, value: { ...own.value, items, ...(hasMore === undefined ? {} : { hasMore }) } }
  }

  async function call(request, local) {
    const { endpoint, payload, signal } = request
    const args = payload?.args
    if (hosts.size === 0 && lastWorkspaces.size === 0) return local()
    if (endpoint === '$events/result') {
      const split = splitQualifiedId(args?.eventId)
      if (split === undefined) return local()
      const host = linkFor(split.hostId)
      const clientId = host.eventClients.get(args.clientId)
      if (clientId === undefined) return failure('gateway/invocation-unavailable', 'That approval belongs to a connection that closed.')
      return host.link.callWire('$events/result', { args: { ...args, clientId, eventId: split.id } }, signal)
    }
    if (endpoint === 'workspace/create' && typeof args?.request?.hostId === 'string') {
      const { hostId, ...rest } = args.request
      try {
        const result = await callHost(hostId, endpoint, { request: rest }, signal)
        if (result.ok) result.value.workspace = decorate(hostId, result.value.workspace)
        return result
      } catch (error) { return wireFailure(error) }
    }
    const named = namedHosts(args, hosts)
    if (named.size === 0) {
      // A qualified id whose Jan is not connected: answer here instead of a misleading local miss.
      const orphan = [...namedHosts(args, new Map([...lastWorkspaces.keys()].map(id => [id, true])))][0]
      if (orphan !== undefined) return failure('gateway/service-unavailable', 'That computer is offline. Connect it in Settings, Hosts.')
      if (endpoint === 'session/list' || endpoint === 'session/search') return mergeList(endpoint, args, signal, local)
      return local()
    }
    if (named.size > 1) return failure('gateway/arguments-invalid', 'A chat or project cannot move between computers.')
    const [hostId] = named
    try {
      const result = await callHost(hostId, endpoint, args, signal)
      if (result.ok && endpoint.startsWith('workspace/') && isPlain(result.value?.workspace)) {
        result.value.workspace = decorate(hostId, result.value.workspace)
      }
      return result
    } catch (error) { return wireFailure(error) }
  }

  function decorate(hostId, view, state = 'live') {
    const host = hosts.get(hostId)
    return { ...view, hostId, hostName: host?.name ?? lastWorkspaces.get(hostId)?.name ?? hostId, hostState: state }
  }

  /** Follow one connected Jan's stream for as long as `signal` lives, reopening after a carrier loss. */
  async function followHost(hostId, endpoint, onItem, signal, onLost) {
    while (!signal.aborted && hosts.has(hostId)) {
      const host = hosts.get(hostId)
      try {
        for await (const item of host.link.stream(endpoint, { args: {} }, signal)) onItem(item)
        return
      } catch (error) {
        if (signal.aborted) return
        onLost?.()
        if (error?.name !== 'RemoteStreamCarrierError') {
          ctx.logger.warn('jan-hosts: %s on %s failed: %s', endpoint, host.name, error instanceof Error ? error.message : String(error))
        }
        await new Promise(resolve => setTimeout(resolve, 2_000))
      }
    }
  }

  /** Run `attach(hostId, signal)` for every connected Jan, now and as Jans connect and leave. */
  function eachHost(signal, attach) {
    const running = new Map()
    const sync = () => {
      for (const hostId of hosts.keys()) {
        if (running.has(hostId)) continue
        const controller = new AbortController()
        const joined = AbortSignal.any([signal, controller.signal])
        running.set(hostId, controller)
        void attach(hostId, joined)
      }
      for (const [hostId, controller] of running) {
        if (!hosts.has(hostId)) { controller.abort(); running.delete(hostId) }
      }
    }
    const stop = subscribe(sync)
    signal.addEventListener('abort', () => { stop(); for (const controller of running.values()) controller.abort() }, { once: true })
    sync()
  }

  /** The sidebar's Workspace stream: this Host's projects, then each connected Jan's. */
  async function workspaceStream(request, local) {
    const signal = request.signal
    const out = channel(signal)
    let own
    const remote = new Map()
    const emit = () => {
      if (own === undefined) return
      const items = [...own.items]
      const archived = [...own.archived]
      const pinned = [...own.pinned]
      for (const [hostId, entry] of lastWorkspaces) {
        const state = remote.get(hostId) ?? entry.state
        if (state === undefined) continue
        const live = hosts.has(hostId) && entry.live
        items.push(...state.items.map(view => decorate(hostId, view, live ? 'live' : 'lost')))
        archived.push(...state.archived)
        pinned.push(...state.pinned)
      }
      const value = { items, archivedSessionIds: archived, pinnedSessionIds: pinned }
      out.push(started ? { type: 'replace', value } : { type: 'baseline', value })
      started = true
    }
    let started = false
    const source = await local()
    void (async () => {
      try {
        for await (const frame of source) {
          own = foldWorkspace(own ?? { items: [], archived: [], pinned: [] }, frame)
          emit()
        }
        out.fail(Object.assign(new Error('Workspace state stream ended'), { name: 'RemoteStreamCarrierError' }))
      } catch (error) { out.fail(error) }
    })()
    eachHost(signal, async (hostId, hostSignal) => {
      const entry = lastWorkspaces.get(hostId) ?? { name: hosts.get(hostId)?.name, state: undefined, live: false }
      lastWorkspaces.set(hostId, entry)
      await followHost(hostId, 'workspace/follow', (frame) => {
        const state = foldWorkspace(remote.get(hostId) ?? entry.state ?? { items: [], archived: [], pinned: [] }, mapIds(frame, qualifier(hostId)))
        remote.set(hostId, state)
        entry.state = state
        entry.live = true
        emit()
      }, hostSignal, () => { entry.live = false; emit() })
      entry.live = false
      if (!signal.aborted) emit()
    })
    const stopOffline = subscribe(() => emit())
    signal.addEventListener('abort', stopOffline, { once: true })
    return out
  }

  /** The Session control stream: this Host's baseline, then each connected Jan's projections as updates. */
  async function controlStream(request, local) {
    const signal = request.signal
    const out = channel(signal)
    const source = await local()
    let baselineSent = false
    const held = []
    void (async () => {
      try {
        for await (const frame of source) {
          out.push(frame)
          if (!baselineSent) { baselineSent = true; for (const item of held.splice(0)) out.push(item) }
        }
        out.fail(Object.assign(new Error('session control stream ended'), { name: 'RemoteStreamCarrierError' }))
      } catch (error) { out.fail(error) }
    })()
    const send = (frame) => { if (baselineSent) out.push(frame); else held.push(frame) }
    eachHost(signal, (hostId, hostSignal) => followHost(hostId, 'session/control', (frame) => {
      // Only the control baseline keys its projections by Session id; elsewhere `projections` is one Session's block.
      if (frame.type === 'baseline') {
        for (const [sessionId, baseline] of Object.entries(frame.value.projections)) {
          send({ type: 'projection', sessionId: qualifyId(hostId, sessionId), seq: baseline.asOfSeq, changes: Object.entries(baseline.values).map(([key, val]) => ({ key, val })) })
        }
      } else send(mapIds(frame, qualifier(hostId)))
    }, hostSignal))
    return out
  }

  /** Forwarded Cordis events: this Host's, plus each connected Jan's with qualified ids and event ids. */
  async function eventStream(request, local) {
    const signal = request.signal
    const out = channel(signal)
    const source = await local()
    let localClientId
    let readySent = false
    const held = []
    void (async () => {
      try {
        for await (const frame of source) {
          if (frame?.type === 'ready') localClientId = frame.clientId
          out.push(frame)
          if (!readySent && frame?.type === 'ready') { readySent = true; for (const item of held.splice(0)) out.push(item) }
        }
      } catch (error) { out.fail(error) }
      out.fail(Object.assign(new Error('event stream ended'), { name: 'RemoteStreamCarrierError' }))
    })()
    const send = (frame) => { if (readySent) out.push(frame); else held.push(frame) }
    eachHost(signal, (hostId, hostSignal) => followHost(hostId, '$events', (frame) => {
      const host = hosts.get(hostId)
      if (frame.type === 'ready') {
        if (host !== undefined && localClientId !== undefined) host.eventClients.set(localClientId, frame.clientId)
        return
      }
      // Only chat activity crosses over: the other Jan's settings, plugins and providers are its own.
      if (frame.type === 'emit') {
        if (!frame.event.startsWith('api-session/')) return
        const [first, ...rest] = frame.args
        send({ ...frame, args: [typeof first === 'string' ? qualifyId(hostId, first) : mapIds(first, qualifier(hostId)), ...rest] })
      } else if (frame.type === 'waterfall') send({ ...mapIds(frame, qualifier(hostId)), eventId: qualifyId(hostId, frame.eventId) })
      else if (frame.type === 'cancel') send({ ...frame, eventId: qualifyId(hostId, frame.eventId) })
    }, hostSignal))
    return out
  }

  async function stream(request, local) {
    // Merged streams wrap even with nothing connected: one opened now must still take in a computer connected later.
    switch (request.endpoint) {
      case 'workspace/follow': return workspaceStream(request, local)
      case 'session/control': return controlStream(request, local)
      case '$events': return eventStream(request, local)
      default: break
    }
    if (hosts.size === 0) return local()
    const named = namedHosts(request.payload?.args, hosts)
    if (named.size !== 1) return local()
    const [hostId] = named
    const host = linkFor(hostId)
    const payload = { args: mapIds(request.payload.args, unqualifier(hostId)) }
    return (async function*() {
      for await (const item of host.link.stream(request.endpoint, payload, request.signal)) yield mapIds(item, qualifier(hostId))
    })()
  }

  return {
    forwarder: { call, stream },
    /** Add or replace one connected Jan. */
    attach(id, name, link) {
      hosts.set(id, { id, name, link, eventClients: new Map() })
      const entry = lastWorkspaces.get(id)
      if (entry !== undefined) entry.name = name
      changed()
    },
    /** Drop a Jan whose link closed; `forget` also drops its last rows (the Host was removed). */
    detach(id, forget = false) {
      hosts.get(id)?.link.close()
      hosts.delete(id)
      if (forget) lastWorkspaces.delete(id)
      changed()
    },
    /** Ask a connected Jan directly, for the folder chooser. */
    call: (hostId, endpoint, args) => linkFor(hostId).link.call(endpoint, args),
    linkState: id => hosts.get(id)?.link.state,
    /** The live link to a connected Jan, for calls this Host makes on its own behalf. */
    linkOf: id => hosts.get(id)?.link,
  }
}
