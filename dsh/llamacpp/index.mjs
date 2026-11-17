import { LlamacppEngine, modelSettingDefinitions } from './runtime.mjs'
import { registerLocalProvider } from './provider.mjs'
import { registerApi } from '../native/api.mjs'
import { invoke, fs, joinPath, getJanDataFolderPath, listen } from '../native/runtime.mjs'

export const name = 'ow-llamacpp'
// No static `compaction`: the web composition gives each agent preset its own
// isolated engine, and provider.mjs reaches those through ctx.agentPresets.
export const inject = ['owNative', 'owDownload', 'webServer', 'connection', 'llm', 'settings', 'agents', 'sessions', 'sessionPersistence']

const idOf = value => {
  if (typeof value !== 'string' || !value.trim() || value.split(/[\\/]/).some(part => part === '..' || part === '.')) throw new Error('Choose a valid model id.')
  return value
}

export async function apply(ctx, config = {}) {
  const engine = new LlamacppEngine()
  await engine.start()
  const provider = await registerLocalProvider(ctx, engine)
  ctx.provide('owLlamacpp', engine)
  ctx.effect(() => () => { provider.dispose(); engine.dispose() }, 'ow-llamacpp: engine')
  ctx.effect(() => ctx.owDownload.registerEngine({
    import: async (id, options) => { await engine.import(id, options); await provider.refresh() },
    pauseImport: id => engine.pauseImport(id),
    abortImport: id => engine.abortImport(id),
  }), 'ow-llamacpp: download owner')
  // The worker survives an out-of-memory or backend fault with the model still
  // listed as loaded, so the panel would claim it works. Keep the engine's own
  // words until the user loads it again.
  let fault = null
  for (const [event, kind] of [['llamacpp-router-oom', 'Out of memory'], ['llamacpp-router-backend-error', 'Engine error']]) {
    const stop = await listen(event, ({ payload }) => { fault = { kind, detail: String(payload ?? '').slice(0, 400), at: Date.now() } })
    ctx.effect(() => stop, `ow-llamacpp: ${event}`)
  }
  const api = {
    list: async () => {
      const models = await engine.list()
      const loaded = await invoke('plugin:llamacpp|get_loaded_models')
      return models.map(model => {
        const isLoaded = loaded.includes(model.id)
        return { ...model, loaded: isLoaded, fault: isLoaded ? fault : null }
      })
    },
    status: async () => {
      const [info, version, devices] = await Promise.all([engine.getEngineInfo(), engine.getEngineVersion(), engine.getDevices()])
      return { engine: info ? { running: true, port: info.port } : null, version, devices }
    },
    load: async ({ id }) => {
      idOf(id)
      fault = null
      const existing = await invoke('plugin:llamacpp|find_session_by_model', { modelId: id })
      if (!existing) {
        const model = await engine.get(id)
        if (!model) throw new Error('This model is not installed.')
        await engine.load(id, undefined, !!model.embedding)
      }
      await provider.refresh()
      return { id, loaded: true }
    },
    unload: async ({ id }) => { await engine.unload(idOf(id)); fault = null; return { id, loaded: false } },
    remove: async ({ id }) => { await engine.delete(idOf(id)); await provider.refresh() },
    import: async ({ id, modelPath, mmprojPath, specDraftPath, specDraftKind }) => {
      idOf(id)
      if (typeof modelPath !== 'string' || !modelPath.trim()) throw new Error('Choose a GGUF file or enter its download URL.')
      return ctx.owDownload.trackImport(id, { modelPath, mmprojPath, specDraftPath, specDraftKind })
    },
    pickFile: () => invoke('open_dialog', { multiple: false }),
    settings: () => engine.getSettings(),
    saveSettings: async ({ settings }) => {
      if (!Array.isArray(settings)) throw new Error('Expected the engine settings.')
      await engine.updateSettings(settings)
      await provider.refresh()
    },
    modelSettings: async ({ id }) => {
      idOf(id)
      const config = await fs.readYaml(await joinPath([await getJanDataFolderPath(), 'llamacpp', 'models', id, 'model.yml']))
      const keys = ['temperature', 'top_k', 'top_p', 'min_p', 'repeat_last_n', 'repeat_penalty', 'presence_penalty', 'frequency_penalty', 'ctx_len', 'ngl', 'chat_template', 'grammar', 'batch_size', 'ubatch_size', 'cpu_moe', 'n_cpu_moe', 'n_cpu_ffn', 'moe_cache_mib']
      const yamlKeys = { ctx_len: 'ctx_size', ngl: 'n_gpu_layers' }
      return {
        settings: keys.map(key => {
          const known = modelSettingDefinitions[key]
          return {
            key,
            title: known?.title ?? (key === 'ubatch_size' ? 'Micro Batch Size' : key.replaceAll('_', ' ')),
            description: known?.description,
            controllerType: key === 'cpu_moe' ? 'checkbox' : 'input',
            controllerProps: { type: ['chat_template', 'grammar'].includes(key) ? 'text' : 'number', placeholder: known?.controller_props?.placeholder, value: config[yamlKeys[key] ?? key] ?? '' },
          }
        }),
        modelProps: await engine.getModelProps(id),
      }
    },
    updateModelSettings: async ({ id, settings }) => {
      if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('Expected model settings.')
      await engine.updateModelSettings(idOf(id), settings)
    },
    context: async ({ id }) => {
      const modelId = idOf(id)
      const budget = await engine.getModelContextBudget(modelId)
      let nativeLimit
      try { nativeLimit = await engine.getModelContextLimit(modelId) } catch { nativeLimit = undefined }
      return { id: modelId, ...budget, ...(nativeLimit === undefined ? {} : { nativeLimit }) }
    },
    recommendation: async ({ id }) => engine.getRecommendedContext(idOf(id)),
    configureContext: async ({ id, overwrite }) => engine.configureModelContext(idOf(id), { overwrite: overwrite === true }),
    catalogFit: async ({ bytes }) => {
      if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) throw new Error('Expected the quant download size in bytes.')
      return engine.catalogFit(bytes)
    },
    catalog: async () => {
      const response = await fetch('https://raw.githubusercontent.com/janhq/model-catalog/main/model_catalog_v2.json')
      if (!response.ok) throw new Error(`Could not read the model catalog (${response.status}).`)
      return response.json()
    },
    hfRepo: async ({ repoId }) => {
      if (typeof repoId !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(repoId)) throw new Error('Enter a Hugging Face owner/repository.')
      const response = await fetch(`https://huggingface.co/api/models/${repoId}?blobs=true&files_metadata=true`)
      if (!response.ok) throw new Error(`Could not read the repository (${response.status}).`)
      return response.json()
    },
  }
  ctx.effect(() => registerApi(ctx, 'llamacpp', api), 'ow-llamacpp: management API')
  if (config.selectedModel) await api.load({ id: config.selectedModel })
}
