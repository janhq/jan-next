import { randomUUID } from 'node:crypto'
import { lstat } from 'node:fs/promises'
import { join } from 'node:path'
import schema from '@janhq/schemastery'
import { registerApi } from '@janhq/jan-plugin-api'

export const name = 'jan-always-on'
export const inject = ['janHomePath', 'webServer', 'connection', 'schedule', 'agents', 'agentDefaultModel', 'agentPresets',
  'sessionController', 'workspaceController', 'workspaceRegistry', 'sessionPersistence', 'sessions', 'systemPrompt', 'commands', 'llm',
  'credentials']
// Keep the existing preference readable until the previous opt-in has been migrated.
export const Config = schema.object({ enabled: schema.boolean().default(false).volatile() })
const EMPTY_MEMORY = ['index.md', 'instructions.md', 'reported.md']
const TOKEN_KINDS = ['github', 'slack', 'discord']
const tokenKey = kind => `jan-always-on/token-${kind}`
const BOT_MODEL = { provider: 'tokamak', model: 'anthropic/claude-haiku-5-5[1m]' }
/** @returns Tokamak's Claude Haiku 5.5 when the catalog offers it, otherwise null (the app default). */
const botDefaultModel = catalog => catalog.groups.some(group => group.id === BOT_MODEL.provider
  && group.models.some(model => model.id === BOT_MODEL.model)) ? BOT_MODEL : null

function text(value, limit) {
  if (typeof value !== 'string' || !value.trim() || value.length > limit) throw new Error('invalid-input')
  return value.trim()
}

async function exists(path) {
  try { await lstat(path); return true }
  catch (error) { if (error.code !== 'ENOENT') throw error; return false }
}

function messagePreview(event) {
  const message = event.type === 'assistant/message' ? event.data.message
    : event.type === 'user/message' && event.data.source.kind === 'user' ? event.data : null
  if (!message) return null
  const preview = message.content.filter(part => part.type === 'text').map(part => part.text).join(' ').trim().slice(0, 240)
  return preview ? { id: message.id, text: preview, at: event.time } : null
}

/** Mount bot management, canonical session contributions and durable routine delivery. */
export function apply(ctx, config) {
  const watchers = new Set(), runtimes = new Map(), bindings = new Map(), prompts = new Map(), presence = new Map()
  const lifetime = new AbortController()
  const home = ctx.janHomePath()
  let opening, registry, legacyDestination, runtimeModules, changedQueued = false
  function emit(event) {
    const line = `${JSON.stringify(event)}\n`
    for (const res of watchers) {
      if (res.writableNeedDrain) res.destroy()
      else res.write(line)
    }
  }
  function activityChanged() {
    if (changedQueued) return
    changedQueued = true
    queueMicrotask(() => { changedQueued = false; emit({ kind: 'changed' }) })
  }
  function report(error) { ctx.logger.warn('Bots: %s', String(error)) }
  // Tokens stay on the Host: the poller adds them to its own requests and the model never sees them.
  async function sourceToken(kind) {
    const record = await ctx.credentials.readRecord(tokenKey(kind))
    return record?.kind === 'grant' && typeof record.payload?.token === 'string' ? record.payload.token : undefined
  }
  function modules() {
    runtimeModules ??= Promise.all([import('./background.mjs'), import('./memory.mjs'), import('./agent.mjs'), import('./watch.mjs'),
      import('@janhq/dsh-superagent/queue')])
      .then(([background, memory, agent, watch, queue]) => ({ ...background, ...memory, ...agent, ...watch, delivery: new queue.AgentDelivery(ctx) }))
    return runtimeModules
  }
  function load() {
    opening ??= (async () => {
      const { openBots } = await import('./bots.mjs')
      const local = registry ??= await openBots(home, { changed: activityChanged })
      if (!local.migrated && (config.enabled.get() || await exists(join(home, 'always-on')))) {
        const project = await projectId()
        await local.adopt(project, prepareSession)
      }
      for (const bot of local.list()) await startBot(bot)
      const jan = local.get('jan')
      if (jan) await ctx.schedule.retargetPluginTasks(name, jan.sessionId, jan.workspaceId)
      return local
    })().catch(error => { opening = undefined; throw error })
    return opening
  }
  async function projectId(requested) {
    if (requested == null || requested === '') return (await ctx.workspaceController.initializeDefault(lifetime.signal)).workspace.workspaceId
    if (!ctx.workspaceRegistry.get(text(requested, 240))) throw new Error('project-not-found')
    return requested
  }
  async function resolveAgent(sessionId) {
    const value = await ctx.sessionController.resolveAgent(sessionId)
    if ('error' in value) throw value.error
    return value.agent
  }
  async function selectProfile(agent, bot, previous) {
    if (!previous || bot.agentPreset !== previous.agentPreset) {
      const preset = bot.agentPreset ?? ctx.agentPresets.defaultFor(bot.model?.provider ?? ctx.agentDefaultModel.currentSelection().provider)
      if (preset) await ctx.agentPresets.select(agent, preset)
    }
    if (bot.model || previous?.model) {
      const selection = bot.model ?? ctx.agentDefaultModel.currentSelection()
      await ctx.llm.resolveCallConfig(selection)
      agent.model.select(selection)
    }
  }
  async function prepareSession(bot, source) {
    const previous = await ctx.sessionPersistence.stat(bot.sessionId)
    if (source && !previous && !ctx.agents.get(bot.sessionId)) throw new Error('bot-session-unavailable')
    if (!source && !previous) {
      const created = await ctx.sessionController.create({ workspaceId: bot.workspaceId, sessionId: bot.sessionId,
        ...(bot.agentPreset ? { agentPreset: bot.agentPreset } : {}) })
      if (created.sessionId !== bot.sessionId) throw new Error('bot-session-conflict')
    }
    const agent = await resolveAgent(bot.sessionId)
    if (source) {
      if (agent.session.header.origin === 'subagent' || ctx.workspaceRegistry.archivedSessionIds.includes(bot.sessionId)) {
        throw new Error('bot-session-unavailable')
      }
      if (ctx.agents.turnBoundaryOf(agent.session).openTurnStartSeq !== null) throw new Error('bot-session-busy')
    }
    // An adopted chat keeps its previous preset and model unless the form requests a change.
    await selectProfile(agent, bot, source && { agentPreset: null, model: null })
    if (ctx.get('sessionTitle')) await ctx.sessionController.rename({ sessionId: bot.sessionId, title: bot.name })
    if (!await ctx.sessions.flush(agent.session)) throw new Error('bot-session-unsaved')
    if (source) {
      const events = agent.session.snapshotEvents()
      for (let index = events.length - 1; index >= 0; index--) {
        const preview = messagePreview(events[index])
        if (preview) return preview
      }
    }
  }
  function attach(agent, runtime) {
    let binding = bindings.get(agent)
    if (binding) return binding
    binding = runtime.bind(agent)
    bindings.set(agent, binding)
    return binding
  }
  async function startBot(bot, resume = false) {
    if (runtimes.has(bot.id)) return runtimes.get(bot.id)
    lifetime.signal.throwIfAborted()
    const { openBackground, memoryAt, bindBotAgent, runWithJan, appendBotNotice, botPrompt, delivery, openWatch } = await modules()
    if (runtimes.has(bot.id)) return runtimes.get(bot.id)
    const directory = registry.directory(bot)
    const memory = memoryAt(home, directory)
    const initialMemory = await memory.contextText()
    const persona = await registry.persona(bot.id)
    if (runtimes.has(bot.id)) return runtimes.get(bot.id)
    lifetime.signal.throwIfAborted()
    const runtime = {
      memory,
      memoryText: initialMemory,
      bind: agent => bindBotAgent(ctx, agent, queue, memory, (input, signal) => schedule(bot, input, signal)),
    }
    const run = runWithJan(ctx, memory, delivery, () => queue, async sessionId => {
      if (!ctx.workspaceRegistry.get(bot.workspaceId)) throw new Error('project-not-found')
      return resolveAgent(sessionId)
    }, agent => attach(agent, runtime))
    const queue = openBackground({ directory, sessionId: bot.sessionId, run, activityChanged, report,
      changed() { runtime.clock?.wake(); activityChanged() },
      async memoryChanged() { runtime.memoryText = await memory.contextText(); activityChanged() },
      approvalPending(id) { emit({ kind: 'approval', botId: bot.id, id }); activityChanged() },
      async notify(message) {
        const agent = await resolveAgent(bot.sessionId)
        await appendBotNotice(ctx, agent, message)
        const at = Number(message.channel.address.createdAt) || Date.now()
        await registry.message(bot.id, { id: `jan-bot-notice:${message.id}`, text: message.text, at }, true)
        if (!watchers.size) return 'waiting'
        emit({ kind: 'notification', botId: bot.id, id: message.id, text: message.text })
        return 'sent'
      },
    })
    runtime.queue = queue
    runtime.watch = openWatch({ queue, sources: () => registry.get(bot.id)?.sources ?? [], token: sourceToken,
      changed: activityChanged, report })
    runtimes.set(bot.id, runtime)
    prompts.set(bot.sessionId, botPrompt(bot, persona))
    try {
      runtime.destination = ctx.schedule.registerSessionDestination(bot.sessionId, name, ({ id, prompt, payload }) => {
        queue.enqueue({ id: `timer:${id}`, kind: payload === undefined ? 'task' : 'follow-up', text: prompt,
          ...(payload === undefined ? {} : { progressPath: payload }) })
      })
      runtime.clock = ctx.schedule.registerWakeSource(queue)
      const agent = ctx.agents.get(bot.sessionId)
      if (agent) await attach(agent, runtime).ready
      if (resume) await queue.setPaused(false)
      runtime.watch.start()
      return runtime
    } catch (error) {
      await stopBot(bot, runtime)
      throw error
    }
  }
  async function stopBot(bot, runtime) {
    runtime.destination?.()
    runtime.watch?.close()
    runtime.clock?.dispose()
    await runtime.queue.close()
    const agent = ctx.agents.get(bot.sessionId)
    const binding = agent && bindings.get(agent)
    if (binding) { bindings.delete(agent); await binding.dispose() }
    prompts.delete(bot.sessionId)
    presence.delete(bot.sessionId)
    runtimes.delete(bot.id)
  }
  function schedule(bot, { key, title, prompt, delay, repeat = false, progressPath }, signal) {
    if (!Number.isSafeInteger(delay) || delay < 1 || delay > 31_536_000 || typeof repeat !== 'boolean') throw new Error('invalid-input')
    const timing = repeat ? { kind: 'every', every_seconds: delay } : { kind: 'after', after_seconds: delay }
    const request = { title: text(title, 120), prompt: text(prompt, 4000), timing }
    return key ? ctx.schedule.createSessionTask(request, { sessionId: bot.sessionId, key, payload: progressPath }, signal)
      : ctx.schedule.create({ ...request, target: { kind: 'session', sessionId: bot.sessionId } }, undefined, signal)
  }
  const ownsTask = (task, bot) => task.target.kind === 'session' && task.target.sessionId === bot.sessionId
    || bot.id === 'jan' && task.target.kind === 'plugin' && task.target.owner === name
  function roster(bot) {
    const activity = runtimes.get(bot.id)?.queue.activity()
    const current = presence.get(bot.sessionId)
    const project = ctx.workspaceRegistry.get(bot.workspaceId)
    return { ...bot, project: project?.title, projectMissing: !project, paused: activity?.paused ?? true,
      activeRun: current?.phase ?? activity?.activeRun ?? null, lastRun: activity?.lastRun ?? current?.lastRun ?? null,
      lastDeliveryAgeMs: activity?.lastDeliveryAgeMs ?? null, pending: activity?.pending ?? false, blocked: activity?.blocked ?? false }
  }
  async function botFor(id) {
    const bot = (await load()).get(text(id, 80))
    if (!bot) throw new Error('bot-not-found')
    return bot
  }
  async function detail(bot) {
    const { memory, queue, watch } = runtimes.get(bot.id)
    const [tasks, files, persona, tokens] = await Promise.all([ctx.schedule.catalog(), memory.index(), registry.persona(bot.id),
      Promise.all(TOKEN_KINDS.map(async kind => [kind, Boolean(await sourceToken(kind))]))])
    return { ...roster(bot), ...queue.snapshot(), files, persona, routines: tasks.filter(task => ownsTask(task, bot)),
      sources: watch.status(), tokens: Object.fromEntries(tokens) }
  }

  ctx.effect(() => ctx.systemPrompt.section({ name: 'jan-bot-persona', order: 10210, interpolate: false,
    text: ({ agent }) => agent ? prompts.get(agent.id) ?? '' : '' }), 'Bots persona')
  // Bot memory is operational state, not optional runtime facts: keep it when a preset turns runtime context off.
  ctx.effect(() => ctx.systemPrompt.context({ name: 'jan-bot-memory', order: 9000, interpolate: false, required: true,
    text: ({ agent }) => agent ? runtimes.get(registry?.forSession(agent.id)?.id)?.memoryText ?? '' : '' }), 'Bots memory context')
  ctx.on('agent/created', async ({ agent }) => {
    const bot = registry?.forSession(agent.id)
    const runtime = bot && runtimes.get(bot.id)
    if (runtime) await attach(agent, runtime).ready
  }, { global: true })
  ctx.on('agent/disposed', ({ agent }) => { bindings.delete(agent); presence.delete(agent.id); activityChanged() }, { global: true })
  ctx.on('agent/status', ({ agent, status }) => {
    const bot = registry?.forSession(agent.id)
    if (!bot) return
    if (status === 'running') presence.set(agent.id, { phase: 'thinking', lastRun: null })
    else {
      const previous = presence.get(agent.id)
      if (previous) previous.phase = null
    }
    activityChanged()
  }, { global: true })
  ctx.on('session/event', (session, event) => {
    const bot = registry?.forSession(session.id)
    if (!bot) return
    const current = presence.get(session.id)
    if (event.type === 'tool/call' && current) current.phase = 'working'
    else if (event.type === 'tool/result' && current) current.phase = 'thinking'
    else if (event.type === 'turn/end' && current) current.lastRun = event.data.reason.kind === 'completed' ? 'done' : 'failed'
    const preview = messagePreview(event)
    if (preview) void registry.message(bot.id, preview, bindings.get(ctx.agents.get(session.id))?.state.run !== undefined).catch(report)
    if (current) activityChanged()
  }, { global: true })
  ctx.on('schedule/changed', activityChanged)
  ctx.effect(() => registerApi(ctx, 'always-on', {
    async list() { return (await load()).list().map(roster) },
    async options() {
      const [models, presets] = await Promise.all([ctx.sessionController.modelCatalog(), ctx.agentPresets.list()])
      return { models: models.groups.map(({ id, name, models: rows }) => ({ id, name, models: rows.map(model => ({ id: model.id, name: model.name })) })),
        presets: presets.filter(item => !item.broken).map(({ id, name }) => ({ id, name })),
        defaultModel: botDefaultModel(models) }
    },
    async detail({ id }) { return detail(await botFor(id)) },
    async create(input) {
      const local = await load()
      const source = input.sourceSessionId === undefined ? undefined : text(input.sourceSessionId, 240)
      const workspaceId = source === undefined ? await projectId(input.workspaceId)
        : ctx.workspaceRegistry.list().find(project => project.sessionIds.includes(source))?.id
      if (!workspaceId) throw new Error('bot-session-project-required')
      // A new bot runs unattended many times a day, so it starts on the small, fast model; an adopted chat keeps its own.
      const model = input.model ?? (source === undefined ? botDefaultModel(await ctx.sessionController.modelCatalog()) : null)
      const bot = await local.create({ ...input, model, workspaceId }, candidate => prepareSession(candidate, source))
      await startBot(bot, true)
      return roster(bot)
    },
    async duplicate({ id, name: duplicateName }) {
      await botFor(id)
      const copy = await registry.duplicate(id, duplicateName, prepareSession)
      await startBot(copy, true)
      return roster(copy)
    },
    async edit({ id, patch }) {
      await botFor(id)
      const bot = await registry.edit(id, patch, async (next, previous) => {
        const agent = await resolveAgent(next.sessionId)
        await selectProfile(agent, next, previous)
        if (next.name !== previous.name && ctx.get('sessionTitle')) await ctx.sessionController.rename({ sessionId: next.sessionId, title: next.name })
        if (!await ctx.sessions.flush(agent.session)) throw new Error('bot-session-unsaved')
      })
      prompts.set(bot.sessionId, (await modules()).botPrompt(bot, await registry.persona(id)))
      void runtimes.get(bot.id)?.watch.tick().catch(report)
      return roster(bot)
    },
    async delete({ id }) {
      await botFor(id)
      await registry.remove(id, async bot => {
        const runtime = runtimes.get(bot.id)
        await runtime.queue.setPaused(true)
        const tasks = await ctx.schedule.catalog()
        for (const task of tasks) if (ownsTask(task, bot)) await ctx.schedule.edit({ id: task.id, action: 'delete' })
        await ctx.workspaceController.archiveSession({ sessionId: bot.sessionId, stopActivity: true })
        await stopBot(bot, runtime)
      })
      return true
    },
    async setPaused({ id, paused }) {
      const bot = await botFor(id)
      if (typeof paused !== 'boolean') throw new Error('invalid-input')
      if (!paused && !ctx.workspaceRegistry.get(bot.workspaceId)) throw new Error('project-not-found')
      await runtimes.get(bot.id).queue.setPaused(paused)
      return true
    },
    async setToken({ kind, token }) {
      if (!TOKEN_KINDS.includes(kind)) throw new Error('invalid-input')
      if (token === null) await ctx.credentials.deleteRecord(tokenKey(kind))
      else {
        const value = text(token, 4000)
        await ctx.credentials.modifyRecord(tokenKey(kind), () => Promise.resolve({ kind: 'grant', payload: { token: value } }))
      }
      activityChanged()
      return true
    },
    async checkNow({ id }) {
      const bot = await botFor(id)
      await runtimes.get(bot.id).watch.tick({ force: true, signal: lifetime.signal })
      return true
    },
    async markRead({ id }) { await botFor(id); await registry.read(id) },
    async compact({ id }) {
      const bot = await botFor(id)
      const agent = await resolveAgent(bot.sessionId)
      const engine = agent.ctx.get('compaction') ?? ctx.agentPresets.serviceFor(agent, 'compaction')
      if (!engine) throw new Error('bot-compaction-unavailable')
      return Boolean(await engine.compactNow(agent, lifetime.signal))
    },
    async schedule({ id, ...input }) { return schedule(await botFor(id), input, lifetime.signal) },
    async read({ id, path }) {
      const bot = await botFor(id)
      if (!path) return { text: '', truncated: false, files: EMPTY_MEMORY }
      return runtimes.get(bot.id).memory.read(path)
    },
    async answer({ id, approvalId, decision }) {
      const bot = await botFor(id)
      return runtimes.get(bot.id).queue.answer(text(approvalId, 120), decision)
    },
  }), 'Bots management')

  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/jan-api/always-on/feed', handler(req, res) {
    const rejection = ctx.connection.requestRejection(req)
    if (rejection !== undefined) { res.writeHead(rejection); res.end(); return }
    if (req.method !== 'GET') { res.writeHead(405, { allow: 'GET' }); res.end(); return }
    res.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' })
    res.once('close', () => watchers.delete(res))
    watchers.add(res)
    for (const runtime of runtimes.values()) runtime.clock?.wake()
    res.write('{"kind":"changed"}\n')
  } }), 'Bots notifications')
  ctx.effect(() => {
    legacyDestination = ctx.schedule.registerDestination(name, async ({ id, prompt, payload }) => {
      const bot = registry?.get('jan')
      if (!bot || !runtimes.has(bot.id)) throw new Error('legacy-bot-not-ready')
      runtimes.get(bot.id).queue.enqueue({ id: `timer:${id}`, text: prompt, kind: payload === undefined ? 'task' : 'follow-up',
        ...(payload === undefined ? {} : { progressPath: payload }) })
    })
    void load().catch(report)
    return async () => {
      lifetime.abort()
      legacyDestination()
      for (const res of watchers) res.end()
      watchers.clear()
      await opening?.catch(report)
      await Promise.all(registry?.list().map(bot => {
        const runtime = runtimes.get(bot.id)
        return runtime && stopBot(bot, runtime)
      }) ?? [])
    }
  }, 'Bots lifecycle')
}
