import { randomUUID } from 'node:crypto'
import { lstat } from 'node:fs/promises'
import { join } from 'node:path'
import schema from '@janhq/schemastery'
import { registerApi } from '@janhq/jan-plugin-api'
import { parseCronInput } from '@janhq/jan-schedule'
import { seedImportedMemory } from './memory.mjs'

export const name = 'jan-always-on'
export const inject = ['janHomePath', 'webServer', 'connection', 'schedule', 'agents', 'agentDefaultModel', 'agentPresets',
  'sessionController', 'workspaceController', 'workspaceRegistry', 'sessionPersistence', 'sessions', 'systemPrompt', 'commands',
  'credentials', 'agentProfiles']
// Keep the existing preference readable until the previous opt-in has been migrated.
export const Config = schema.object({ enabled: schema.boolean().default(false).volatile() })
const EMPTY_MEMORY = ['index.md', 'instructions.md', 'reported.md']
const TOKEN_KINDS = ['github', 'slack', 'discord']
const tokenKey = kind => `jan-always-on/token-${kind}`
const BOT_MODEL = { provider: 'tokamak', model: 'anthropic/claude-haiku-5-5[1m]' }
const JEV_MODEL = 'jev/jev-latest'
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
  // Jev answers through the signed-in Tokamak account; without one the call fails and the triage keeps every item.
  let tokamak
  async function systemOne(body, signal) {
    tokamak ??= import('@janhq/jan-tokamak/api').then(({ createTokamakApi }) => createTokamakApi(ctx))
    const reply = await (await tokamak).request('/systemone', 'classification', { json: { model: JEV_MODEL, ...body }, signal })
    return reply.json()
  }
  function modules() {
    runtimeModules ??= Promise.all([import('./background.mjs'), import('./memory.mjs'), import('./agent.mjs'), import('./watch.mjs'),
      import('./triage.mjs'), import('@janhq/dsh-superagent/queue')])
      .then(([background, memory, agent, watch, triage, queue]) => ({ ...background, ...memory, ...agent, ...watch, ...triage, delivery: new queue.AgentDelivery(ctx) }))
    return runtimeModules
  }
  function load() {
    opening ??= (async () => {
      const { openBots } = await import('./bots.mjs')
      const local = registry ??= await openBots(home, { changed: activityChanged, agentProfiles: ctx.agentProfiles, report })
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
  async function botProject(workspaceId, sourceSessionId) {
    if (sourceSessionId === undefined) return projectId(workspaceId)
    const project = ctx.workspaceRegistry.list().find(row => row.sessionIds.includes(sourceSessionId))?.id
    if (!project) throw new Error('bot-session-project-required')
    return project
  }
  async function resolveAgent(sessionId) {
    const value = await ctx.sessionController.resolveAgent(sessionId)
    if ('error' in value) throw value.error
    return value.agent
  }
  async function selectProfile(agent, bot, previous, modelChanged = false) {
    if (bot.agentProfile !== (previous?.agentProfile ?? null) || modelChanged) {
      try { await ctx.agentProfiles.select({ sessionId: bot.sessionId, id: bot.agentProfile }) }
      catch (error) {
        if (error?.code === 'agent-profiles/locked') throw new Error('bot-session-busy', { cause: error })
        if (error?.code === 'agent-profiles/not-found' || error?.code === 'agent-profiles/invalid') throw new Error('agent-missing', { cause: error })
        throw error
      }
    }
    if (!previous || bot.agentPreset !== previous.agentPreset) {
      const provider = agent.model?.current()?.provider ?? ctx.agentDefaultModel.currentSelection().provider
      const preset = bot.agentPreset ?? ctx.agentPresets.defaultFor(provider)
      if (preset) await ctx.agentPresets.select(agent, preset)
    }
  }
  async function restoreBotProfile(agent, bot) {
    if (!bot.agentSelectionPending) return
    try {
      if (ctx.agentProfiles.profileForSession(agent.session) === null) {
        await ctx.agentProfiles.select({ sessionId: bot.sessionId, id: bot.agentProfile, keepModel: true })
      }
      if (!await ctx.sessions.flush(agent.session)) throw new Error('bot-session-unsaved')
      // Agent creation may be running inside a serialized registry edit.
      void registry.agentSelectionRestored(bot.id).catch(report)
    } catch (error) {
      if (!['agent-profiles/not-found', 'agent-profiles/invalid', 'agent-profiles/locked'].includes(error?.code)) throw error
      report(error)
    }
  }
  async function prepareSession(bot, source, { keepAgent = false, newAgent } = {}) {
    const previous = await ctx.sessionPersistence.stat(bot.sessionId)
    if (source && !previous && !ctx.agents.get(bot.sessionId)) throw new Error('bot-session-unavailable')
    if (!source && !previous) {
      const created = await ctx.sessionController.create({ workspaceId: bot.workspaceId, sessionId: bot.sessionId, agentProfile: null,
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
    const previousProfile = source ? ctx.agentProfiles.profileForSession(agent.session) : null
    if (newAgent) bot.agentProfile = await createBotAgent(bot, newAgent, !source)
    if (keepAgent) bot.agentProfile = previousProfile
    await selectProfile(agent, bot, source && { agentPreset: null, agentProfile: previousProfile })
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
  async function startBot(bot, resume = false, scheduleGate) {
    if (runtimes.has(bot.id)) return runtimes.get(bot.id)
    lifetime.signal.throwIfAborted()
    const { openBackground, memoryAt, bindBotAgent, runWithJan, appendBotNotice, botPrompt, delivery, openWatch, createTriage } = await modules()
    if (runtimes.has(bot.id)) return runtimes.get(bot.id)
    const directory = registry.directory(bot)
    const memory = memoryAt(home, directory)
    const initialMemory = await memory.contextText()
    if (runtimes.has(bot.id)) return runtimes.get(bot.id)
    lifetime.signal.throwIfAborted()
    const runtime = {
      scheduleGate,
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
      triage: createTriage({ request: systemOne, profile: () => registry.get(bot.id), agentProfiles: ctx.agentProfiles }), changed: activityChanged, report })
    runtimes.set(bot.id, runtime)
    prompts.set(bot.sessionId, botPrompt(bot))
    try {
      runtime.destination = ctx.schedule.registerSessionDestination(bot.sessionId, name, ({ id, taskId, prompt, payload }) => {
        if (scheduleGate?.staging || scheduleGate?.unconfirmed.has(taskId)) throw new Error('bot-import-in-progress')
        queue.enqueue({ id: `timer:${id}`, kind: payload === undefined ? 'task' : 'follow-up', text: prompt,
          ...(payload === undefined ? {} : { progressPath: payload }) })
      })
      runtime.clock = ctx.schedule.registerWakeSource(queue)
      const agent = ctx.agents.get(bot.sessionId)
      if (agent) {
        await restoreBotProfile(agent, bot)
        await attach(agent, runtime).ready
      }
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
  async function createBotAgent(bot, draft, useBotDefault) {
    const { reserveBotAgentId } = await import('./bots.mjs')
    const { profiles } = await ctx.agentProfiles.list({ workspaceId: bot.workspaceId })
    const id = reserveBotAgentId(bot.name, new Set(profiles.map(row => row.id.toLowerCase())))
    const model = Object.hasOwn(draft, 'model') ? draft.model
      : useBotDefault ? botDefaultModel(await ctx.sessionController.modelCatalog()) : null
    await saveBotAgent({ id, scope: 'global', use: 'all' }, bot.workspaceId, { ...draft, model })
    return id
  }
  async function getBotAgent(id, workspaceId) {
    if (id === null || id === undefined) return null
    try { return await ctx.agentProfiles.get({ id, workspaceId }) }
    catch (error) { if (error?.code !== 'agent-profiles/not-found') throw error; return null }
  }
  async function saveBotAgent(current, workspaceId, patch) {
    const { id, scope, use, tools, disallowedTools } = current
    const model = Object.hasOwn(patch, 'model') ? patch.model : current.model
    return ctx.agentProfiles.save({ scope, ...(scope === 'project' ? { workspaceId } : {}), profile: {
      id, use, ...(tools === undefined ? {} : { tools }), ...(disallowedTools === undefined ? {} : { disallowedTools }),
      description: patch.description ?? current.description ?? '',
      instructions: patch.instructions ?? current.instructions ?? '', ...(model ? { model } : {}),
    } })
  }
  async function createBot(input, memory) {
    const local = await load()
    const source = input.sourceSessionId === undefined ? undefined : text(input.sourceSessionId, 240)
    const workspaceId = await botProject(input.workspaceId, source)
    const { newAgent } = input
    return local.create({ ...input, workspaceId }, async candidate => {
      if (memory) await seedImportedMemory(local.directory(candidate), memory, lifetime.signal)
      return prepareSession(candidate, source, { keepAgent: Boolean(source && input.agentProfile === undefined && !newAgent), newAgent })
    }, { uniqueName: Boolean(memory) })
  }
  function validateRoutine({ schedule_cron, schedule_text, timezone }, defaultZone = 'UTC') {
    for (const expression of [schedule_cron, schedule_text]) {
      if (!expression) continue
      try { return parseCronInput({ expression, time_zone: timezone === undefined ? defaultZone : timezone }) }
      catch (error) { if (error.code === 'invalid_time_zone') return { reason: 'invalid-time-zone' } }
    }
    return { reason: 'invalid-cron' }
  }
  async function importBot({ name, role, description, memory, routines }) {
    const bot = await createBot({ name, role, newAgent: { description } }, memory)
    const identity = { botId: bot.id, sessionId: bot.sessionId }
    const gate = { staging: true, unconfirmed: new Set() }
    let runtime
    try { runtime = await startBot(bot, false, gate) } catch {
      return { ...identity, status: 'partial', reason: 'bot-start-failed', routines: [] }
    }
    const outcomes = []
    for (const { name: title, prompt, expression, timeZone, paused } of routines) {
      let task
      try {
        task = await ctx.schedule.create({ title, prompt, timing: { kind: 'cron', cron: { expression, time_zone: timeZone } },
          target: { kind: 'session', sessionId: bot.sessionId } }, undefined, lifetime.signal)
      } catch {
        outcomes.push({ name: title, status: 'failed', reason: 'routine-create-failed' })
        continue
      }
      if (paused) {
        try {
          // Throw rather than wait in the destination: Schedule serializes delivery and edits.
          const updated = await ctx.schedule.edit({ id: task.id, action: 'update', patch: { active: false } })
          if (updated.status !== 'paused') throw new Error('routine-not-paused')
        } catch {
          let removed = false
          try {
            const result = await ctx.schedule.edit({ id: task.id, action: 'delete' })
            removed = result.deleted === true || result.code === 'schedule_not_found'
          } catch { /* The task may still be active; keep the bot paused. */ }
          if (!removed) gate.unconfirmed.add(task.id)
          outcomes.push({ name: title, id: task.id, status: 'failed', reason: removed ? 'pause-failed-removed' : 'pause-cleanup-failed' })
          continue
        }
      }
      outcomes.push({ name: title, id: task.id, status: paused ? 'paused' : 'active' })
    }
    gate.staging = false
    let held = gate.unconfirmed.size > 0
    if (!held) {
      try { await runtime.queue.setPaused(false); runtime.clock.wake() } catch { held = true }
    }
    return { ...identity, routines: outcomes, ...(held ? { status: 'partial', reason: 'bot-kept-paused' } : {}) }
  }
  ctx.provide('janBotImport', { validateRoutine, importBot })
  const ownsTask = (task, bot) => task.target.kind === 'session' && task.target.sessionId === bot.sessionId
    || bot.id === 'jan' && task.target.kind === 'plugin' && task.target.owner === name
  function roster(bot) {
    const activity = runtimes.get(bot.id)?.queue.activity()
    const current = presence.get(bot.sessionId)
    const project = ctx.workspaceRegistry.get(bot.workspaceId)
    const agentDescription = bot.agentProfile && ctx.agentProfiles.snapshot(bot.workspaceId).profiles
      .find(row => row.id === bot.agentProfile && !row.shadowedBy)?.description
    const { agentSelectionPending, ...identity } = bot
    return { ...identity, agentDescription, project: project?.title, projectMissing: !project, paused: activity?.paused ?? true,
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
    const [tasks, files, tokens] = await Promise.all([ctx.schedule.catalog(), memory.index(),
      Promise.all(TOKEN_KINDS.map(async kind => [kind, Boolean(await sourceToken(kind))]))])
    return { ...roster(bot), ...queue.snapshot(), files, routines: tasks.filter(task => ownsTask(task, bot)),
      sources: watch.status(), tokens: Object.fromEntries(tokens) }
  }

  ctx.effect(() => ctx.systemPrompt.section({ name: 'jan-bot-frame', order: 10210, interpolate: false,
    text: ({ agent }) => agent ? prompts.get(agent.id) ?? '' : '' }), 'Bots prompt framing')
  // Bot memory is operational state, not optional runtime facts: keep it when a preset turns runtime context off.
  ctx.effect(() => ctx.systemPrompt.context({ name: 'jan-bot-memory', order: 9000, interpolate: false, required: true,
    text: ({ agent }) => agent ? runtimes.get(registry?.forSession(agent.id)?.id)?.memoryText ?? '' : '' }), 'Bots memory context')
  ctx.on('agent/created', async ({ agent }) => {
    const bot = registry?.forSession(agent.id)
    if (bot) await restoreBotProfile(agent, bot)
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
  ctx.on('agent-profiles/changed', activityChanged, { global: true })
  ctx.effect(() => registerApi(ctx, 'always-on', {
    async list() { return (await load()).list().map(roster) },
    async options() {
      const [models, presets] = await Promise.all([ctx.sessionController.modelCatalog(), ctx.agentPresets.list()])
      return { models: models.groups.map(({ id, name, models: rows }) => ({ id, name, models: rows.map(model => ({ id: model.id, name: model.name })) })),
        presets: presets.filter(item => !item.broken).map(({ id, name }) => ({ id, name })),
        defaultModel: botDefaultModel(models) }
    },
    async listAgents({ workspaceId, sourceSessionId }) {
      const project = sourceSessionId === undefined && workspaceId ? workspaceId : await botProject(workspaceId, sourceSessionId)
      return (await ctx.agentProfiles.list({ workspaceId: project })).profiles.filter(row => !row.shadowedBy && row.use !== 'subagent')
    },
    async getAgent({ id, workspaceId, sourceSessionId }) {
      return getBotAgent(id, sourceSessionId === undefined && workspaceId ? workspaceId : await botProject(workspaceId, sourceSessionId))
    },
    async copyAgent({ id, workspaceId, sourceSessionId }) {
      const project = sourceSessionId === undefined && workspaceId ? workspaceId : await botProject(workspaceId, sourceSessionId)
      const agent = await getBotAgent(id, project)
      if (!agent) throw new Error('agent-missing')
      if (agent.writable) return agent
      return saveBotAgent(agent, project, {})
    },
    async detail({ id }) { return detail(await botFor(id)) },
    async templates() {
      const { TEMPLATES } = await import('./templates.mjs')
      return TEMPLATES
    },
    async create({ template: templateId, timeZone, locale, ...input }) {
      const template = templateId === undefined ? undefined : (await import('./templates.mjs')).templateFor(templateId)
      const bot = await createBot(input)
      await startBot(bot, true)
      if (!template?.routines.length) return roster(bot)
      // A template's routines run in the user's time zone; an unknown zone falls back to UTC rather than failing the bot.
      let zone = 'UTC'
      try { zone = parseCronInput({ expression: '0 0 * * *', time_zone: typeof timeZone === 'string' ? timeZone : 'UTC' }).timeZone } catch { /* UTC */ }
      let routinesFailed = 0
      for (const routine of template.routines) {
        try {
          await ctx.schedule.create({ title: routine.titles[locale] ?? routine.titles.en, prompt: routine.prompt,
            timing: { kind: 'cron', cron: { expression: routine.cron, time_zone: zone } },
            target: { kind: 'session', sessionId: bot.sessionId } }, undefined, lifetime.signal)
        } catch (error) {
          routinesFailed++
          report(error)
        }
      }
      return { ...roster(bot), ...(routinesFailed ? { routinesFailed } : {}) }
    },
    async duplicate({ id, name: duplicateName }) {
      await botFor(id)
      const copy = await registry.duplicate(id, duplicateName, prepareSession)
      await startBot(copy, true)
      return roster(copy)
    },
    async edit({ id, patch }) {
      await botFor(id)
      const { newAgent, agentChanges } = patch
      const bot = await registry.edit(id, patch, async (next, previous) => {
        const agent = await resolveAgent(next.sessionId)
        const modelChanged = Boolean(agentChanges && Object.hasOwn(agentChanges, 'model'))
        if ((modelChanged || newAgent || next.agentProfile !== previous.agentProfile || next.agentPreset !== previous.agentPreset)
          && ctx.agents.turnBoundaryOf(agent.session).openTurnStartSeq !== null) throw new Error('bot-session-busy')
        if (newAgent) next.agentProfile = await createBotAgent(next, newAgent, false)
        if (agentChanges) {
          const current = await getBotAgent(next.agentProfile, next.workspaceId)
          if (!current || current.use === 'subagent') throw new Error('agent-missing')
          if (!current.writable) throw new Error('agent-read-only')
          await saveBotAgent(current, next.workspaceId, agentChanges)
        }
        await selectProfile(agent, next, previous, modelChanged)
        if (next.name !== previous.name && ctx.get('sessionTitle')) await ctx.sessionController.rename({ sessionId: next.sessionId, title: next.name })
        if (!await ctx.sessions.flush(agent.session)) throw new Error('bot-session-unsaved')
      })
      prompts.set(bot.sessionId, (await modules()).botPrompt(bot))
      void runtimes.get(bot.id)?.watch.tick().catch(report)
      return roster(bot)
    },
    async delete({ id }) {
      await botFor(id)
      await registry.remove(id, async bot => {
        const runtime = runtimes.get(bot.id)
        if (runtime.scheduleGate?.staging) throw new Error('bot-import-in-progress')
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
      const runtime = runtimes.get(bot.id)
      const gate = runtime.scheduleGate
      if (gate?.staging) throw new Error('bot-import-in-progress')
      if (!paused && gate?.unconfirmed.size) {
        if ((await ctx.schedule.catalog()).some(task => gate.unconfirmed.has(task.id) && task.status === 'active')) {
          throw new Error('bot-import-in-progress')
        }
        gate.unconfirmed.clear()
      }
      await runtime.queue.setPaused(paused)
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
