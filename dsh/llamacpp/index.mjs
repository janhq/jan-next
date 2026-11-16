import { LlamacppEngine } from './runtime.mjs'
import { registerLocalProvider } from './provider.mjs'
import { registerApi } from '../native/api.mjs'
import { invoke, fs, joinPath, getJanDataFolderPath } from '../native/runtime.mjs'

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
  const api = {
    list: async () => {
      const models = await engine.list()
      const loaded = await invoke('plugin:llamacpp|get_loaded_models')
      return models.map(model => ({ ...model, loaded: loaded.includes(model.id) }))
    },
    status: async () => {
      const [info, version, devices] = await Promise.all([engine.getEngineInfo(), engine.getEngineVersion(), engine.getDevices()])
      return { engine: info ? { running: true, port: info.port } : null, version, devices }
    },
    load: async ({ id }) => {
      idOf(id)
      const existing = await invoke('plugin:llamacpp|find_session_by_model', { modelId: id })
      if (!existing) {
        const model = await engine.get(id)
        if (!model) throw new Error('This model is not installed.')
        await engine.load(id, undefined, !!model.embedding)
      }
      await provider.refresh()
      return { id, loaded: true }
    },
    unload: async ({ id }) => { await engine.unload(idOf(id)); return { id, loaded: false } },
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
        settings: keys.map(key => ({ key, title: key.replaceAll('_', ' '), controllerType: key === 'cpu_moe' ? 'checkbox' : 'input', controllerProps: { type: ['chat_template', 'grammar'].includes(key) ? 'text' : 'number', value: config[yamlKeys[key] ?? key] ?? '' } })),
        modelProps: await engine.getModelProps(id),
      }
    },
    updateModelSettings: async ({ id, settings }) => {
      if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('Expected model settings.')
      await engine.updateModelSettings(idOf(id), settings)
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
