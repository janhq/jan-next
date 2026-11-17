import { createRequire, findPackageJSON } from 'node:module'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const providerId = 'ow-llamacpp'

async function migrateLocalSessionModels(ctx, projection) {
  const migrateLive = async agent => {
    const selection = agent.model.current()
    if (selection?.provider !== 'llamacpp') return
    agent.model.select({ ...selection, provider: providerId })
    await ctx.sessions.flush(agent.session)
  }
  // Resume hooks cover sessions first opened after this startup pass.
  ctx.on('agent/created', ({ agent }) => migrateLive(agent))
  for (const agent of ctx.agents.list()) await migrateLive(agent)
  for (const snapshot of await ctx.sessionPersistence.list()) {
    if (ctx.agents.get(snapshot.header.id)) continue
    const readSelection = events => {
      let state = projection.init()
      for (const event of events) state = projection.apply(state, event)
      return state.pending ?? state.lastUsed
    }
    const reader = await ctx.sessionPersistence.open(snapshot.header.id, 'read')
    let candidate
    try {
      candidate = readSelection((await reader.read()).events)
    } finally {
      await reader.close()
    }
    if (candidate?.provider !== 'llamacpp') continue
    // Re-read under the backend's single-writer lease so a newer user selection wins.
    const handle = await ctx.sessionPersistence.open(snapshot.header.id, 'write')
    try {
      const { events } = await handle.read()
      const selection = readSelection(events)
      if (selection?.provider !== 'llamacpp') continue
      await handle.append([{
        type: 'model/selection',
        seq: events.length,
        time: Date.now(),
        data: { ...selection, provider: providerId },
      }])
      await handle.flush()
    } finally {
      await handle.close()
    }
  }
}

export async function registerLocalProvider(ctx, engine) {
  const require = createRequire(process.argv[1])
  const adapterEntry = require.resolve('@deepseek-ai/dsh-llm-pi-ai')
  const adapterRequire = createRequire(adapterEntry)
  const load = specifier => import(pathToFileURL(adapterRequire.resolve(specifier)).href)
  // pi-ai exposes this API only under the ESM import condition, which require.resolve cannot select.
  const piPackagePath = findPackageJSON('@earendil-works/pi-ai', pathToFileURL(adapterEntry))
  const piPackage = JSON.parse(await readFile(piPackagePath, 'utf8'))
  const protocolEntry = piPackage.exports['./api/*'].import.replace('*', 'openai-completions.lazy')
  const [{ Config, PiAiAdapter }, { openAICompletionsApi }, { resolveRetryPolicy, resolveImageAttachmentAccess }, { modelSelectionProjectionDefinition }] = await Promise.all([
    import(pathToFileURL(adapterEntry).href),
    import(new URL(protocolEntry, pathToFileURL(piPackagePath)).href),
    load('@deepseek-ai/dsh-llm'),
    load('@deepseek-ai/dsh-agent'),
  ])
  const protocol = openAICompletionsApi()
  let profiles = new Map()
  let localModels = []
  let registration
  let disposed = false
  let updating = Promise.resolve()
  // Budgets key per backend and model: each agent preset keeps its own engine,
  // so several live engines price the same local model.
  const policiesByEngine = new Map()
  const retireEngine = engine => {
    const current = policiesByEngine.get(engine)
    if (current === undefined) return
    policiesByEngine.delete(engine)
    for (const policy of current.values()) policy.dispose()
  }
  const retireAll = () => {
    for (const engine of [...policiesByEngine.keys()]) retireEngine(engine)
  }
  const reconcilePolicies = engine => {
    // The dynamic API is required: without it a small local window keeps
    // defaults that never compact, so the mismatch must fail, not degrade.
    if (typeof engine?.registerModelPolicy !== 'function') {
      throw new Error('ow-llamacpp: incompatible DSH runtime, the compaction backend has no registerModelPolicy; use the matching harness build')
    }
    const current = policiesByEngine.get(engine) ?? new Map()
    policiesByEngine.set(engine, current)
    const retained = new Set()
    for (const model of localModels) {
      retained.add(model.id)
      // The request reserves the same cap the model entry declares, so the
      // prompt budget is the window minus what one reply may take. Headroom is
      // sized under whatever is left: a budget of zero is the failure this
      // replaces, where the whole window was reserved for output and pressure
      // compaction could never price a prompt at all.
      const reserved = model.maxTokens
      const messageBudget = model.contextWindow - reserved
      const headroom = Math.max(1, Math.min(
        Math.floor(model.contextWindow / 8),
        Math.floor(Math.max(1, messageBudget) / 4),
      ))
      const key = `${model.contextWindow}:${reserved}:${headroom}`
      const previous = current.get(model.id)
      if (previous?.key === key) continue
      const dispose = engine.registerModelPolicy({
        provider: providerId,
        model: model.id,
        headroomTokens: headroom,
        maxTokens: reserved,
      })
      current.set(model.id, { key, dispose })
      previous?.dispose()
    }
    for (const [id, policy] of current) {
      if (retained.has(id)) continue
      policy.dispose()
      current.delete(id)
    }
  }
  const liveEngines = () => {
    const live = new Set()
    // A root-hosted composition (the app's stdio runtime) has one engine; the
    // web composition has none, which is a legitimate absence.
    const root = ctx.get('compaction')
    if (root !== undefined) live.add(root)
    const presets = ctx.get('agentPresets')
    if (presets !== undefined) {
      for (const agent of ctx.agents.list()) {
        // serviceFor is the registry's public read across a preset's isolate realm.
        const presetEngine = presets.serviceFor(agent, 'compaction')
        if (presetEngine !== undefined) live.add(presetEngine)
      }
    }
    return live
  }
  const syncPolicies = () => {
    const live = liveEngines()
    for (const engine of live) reconcilePolicies(engine)
    for (const stale of [...policiesByEngine.keys()]) {
      if (live.has(stale)) continue
      retireEngine(stale)
    }
  }
  ctx.effect(() => () => { retireAll() }, 'ow-llamacpp: compaction policies')
  // Presets mount after this plugin, so each engine is read when its agent appears.
  ctx.inject(['agentPresets'], child => {
    child.on('agent/created', () => syncPolicies())
    child.on('agent-preset/selected', () => syncPolicies())
    syncPolicies()
  })
  ctx.inject(['compaction'], child => {
    const rootEngine = child.compaction
    child.effect(() => {
      syncPolicies()
      return () => retireEngine(rootEngine)
    }, 'ow-llamacpp: root compaction policies')
  })

  const update = async () => {
    if (disposed) return
    const [installed, endpoint] = await Promise.all([engine.list(), engine.getEngineInfo()])
    const models = await Promise.all(installed.filter(model => !model.embedding).map(async model => {
      // The engine owns the number: the loaded window when the model is
      // running, the configured one otherwise. The output cap is a fraction of
      // it, never the whole window -- declaring the window as the completion
      // cap is what let a prompt be budgeted against 8192 tokens the engine did
      // not have.
      const budget = await engine.getModelContextBudget(model.id)
      return {
        id: model.id,
        name: model.name || model.id,
        contextWindow: budget.contextWindow,
        maxTokens: budget.maxOutputTokens,
        input: model.capabilities?.includes('vision') ? ['text', 'image'] : ['text'],
      }
    }))
    if (disposed) return
    localModels = models
    syncPolicies()
    if (!endpoint || models.length === 0) {
      profiles = new Map()
      return
    }
    const baseURL = `http://127.0.0.1:${endpoint.port}/v1`
    const raw = Config({
      providers: {
        [providerId]: {
          displayName: 'Local models (llama.cpp)',
          api: 'openai-completions',
          baseURL,
          models,
        }
      }
    }).providers.get()[providerId]
    const piModels = models.map(model => ({
      ...model,
      api: raw.api,
      provider: providerId,
      baseUrl: baseURL,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    }))
    const piProvider = {
      id: providerId,
      name: raw.displayName,
      baseUrl: baseURL,
      auth: {
        apiKey: {
          name: raw.displayName,
          resolve: ({ credential }) => Promise.resolve({ auth: { apiKey: credential.key }, source: raw.displayName }),
        }
      },
      getModels: () => piModels,
      stream: (model, context, options) => protocol.stream(model, context, options),
      streamSimple: (model, context, options) => protocol.streamSimple(model, context, options),
    }
    profiles = new Map([[providerId, {
      ...raw,
      provider: providerId,
      piProvider,
      modelErrors: new Map(),
      configuredMaxTokens: new Map(),
      retryPolicy: resolveRetryPolicy(raw.retryPolicy, 'ow-llamacpp retryPolicy'),
      imageOffloadCountQuantum: raw.imageOffloadCountQuantum ?? Math.min(10, raw.maxRequestImages),
      localApiKey: endpoint.apiKey,
    }]])
  }
  // The model picker caches the catalog and only re-reads it on this event, so
  // a model downloaded or loaded after boot stayed invisible until restart.
  let published = ''
  const publish = () => {
    const signature = JSON.stringify([profiles.has(providerId), localModels])
    if (disposed || signature === published) return
    published = signature
    ctx.emit('llm/models-updated', providerId)
  }
  const refresh = () => {
    const operation = updating.then(update).then(publish)
    updating = operation.catch(() => { })
    return operation
  }
  const prepare = async (model, signal) => {
    signal?.throwIfAborted()
    const loaded = await engine.getLoadedModels()
    if (!loaded.includes(model)) await engine.load(model)
    await refresh()
    signal?.throwIfAborted()
  }

  class LocalAdapter extends PiAiAdapter {
    providerInfo() {
      return { id: providerId, name: 'Local models (llama.cpp)' }
    }
    async listModels() {
      await refresh()
      return localModels.map(model => ({ provider: providerId, id: model.id, name: model.name, inputModalities: [...model.input] }))
    }
    async resolveModel(provider, model, signal) {
      await prepare(model, signal)
      return super.resolveModel(provider, model, signal)
    }
    async prepareCall(provider, model, signal) {
      await prepare(model, signal)
      const call = await super.prepareCall(provider, model, signal)
      return { model: call.model, stream: options => this.stream(options) }
    }
    async *stream(options) {
      await prepare(options.model, options.signal)
      yield* super.stream(options)
    }
  }
  const adapter = new LocalAdapter({
    profiles: () => profiles,
    resolveApiKey: async (_provider, profile) => profile.localApiKey,
    auth: {},
    prepareHeaders: (request, headers) => ctx.waterfall('llm-pi-ai/request-headers', request, headers, () => headers),
    resolveAttachments: () => ctx.get('attachments'),
    resolveImageAccess: (attachments, ref) => resolveImageAttachmentAccess(attachments, hostPath => ctx.get('fs')?.processPathFromHostPath(hostPath), ref),
    onReplayDegrade: ({ model, reason }) => ctx.logger.warn(`ow-llamacpp: replay metadata for ${model} was unavailable (${reason})`),
  })
  await refresh()
  registration = ctx.llm.registerAdapter([providerId], adapter)
  await migrateLocalSessionModels(ctx, modelSelectionProjectionDefinition)
  return {
    refresh,
    dispose() {
      disposed = true
      registration?.()
      retireAll()
    },
  }
}
