// MIT License. Copyright (c) 2026 DataElement. Ported for open-waifu.
import { DEFAULTS, MODEL_CATALOG, ImageError, listModels, profile, validateConnection } from './provider.js'

// Non-secret choices live in this plugin's own DSH profile entry, the way stock
// DSH plugins keep settings, so a DSH profile carries them unchanged. The key
// stays in the OS keyring.
export function createSettings(ctx, config, validate = validateConnection) {
  const invoke = (command, args) => ctx.owNative.invoke(command, args)
  const entry = ctx.fiber.entry?.options.id
  let writes = Promise.resolve()
  // Volatile Config fields are live refs; the settings service updates them.
  const read = async () => ({ revision: config.revision.get(), provider: config.provider.get(), profiles: structuredClone(config.profiles.get()) })
  const key = async () => await invoke('image_key_get') || ''
  async function describe() {
    const state = await read()
    const hasKey = Boolean(await key())
    return { revision: state.revision, provider: state.provider, hasKey, writable: true, catalogs: MODEL_CATALOG,
      profiles: Object.fromEntries(Object.entries(DEFAULTS).map(([provider, defaults]) => [provider, {
        ...defaults, ...state.profiles[provider], configured: hasKey && state.provider === provider,
      }])) }
  }
  async function active() {
    await writes
    const state = await read(), apiKey = await key()
    if (!apiKey) throw new ImageError('NOT_CONFIGURED', 'Configure image generation in Settings > Plugins first.')
    return { provider: state.provider, ...profile(state.provider, state.profiles[state.provider]), key: apiKey }
  }
  async function prepared(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ImageError('CONFIGURATION', 'Enter a valid image configuration.')
    const before = await read()
    if (!Number.isSafeInteger(input.revision) || input.revision !== before.revision) throw new ImageError('CONFLICT', 'Settings changed. Reopen this card before saving.', 409)
    const spec = profile(input.provider, input)
    let apiKey = typeof input.apiKey === 'string' ? input.apiKey.trim() : ''
    if (!apiKey && before.provider === input.provider && before.profiles[input.provider]
      && new URL(before.profiles[input.provider].baseUrl).origin === new URL(spec.baseUrl).origin) apiKey = await key()
    if (!apiKey || apiKey.length > 4096 || /[\s\x00-\x1f\x7f]/u.test(apiKey)) throw new ImageError('KEY_REQUIRED', 'Enter an API key. A different provider or API origin requires a new key.')
    return { before, spec, apiKey }
  }
  async function models(input, signal) {
    const { spec, apiKey } = await prepared(input)
    return listModels(input.provider, spec, apiKey, { signal })
  }
  function save(input, signal) {
    const operation = writes.then(async () => {
      const { before, spec, apiKey } = await prepared(input)
      const validation = await validate(input.provider, spec, apiKey, { signal })
      signal?.throwIfAborted()
      // Keep the previous secret if persisting non-secret settings fails.
      const oldKey = await key()
      await invoke('image_key_set', { value: apiKey })
      try {
        const next = { revision: before.revision + 1, provider: input.provider,
          profiles: { ...before.profiles, [input.provider]: { ...spec, validation } } }
        const store = ctx.get('settings')
        if (store === undefined || entry === undefined) throw new ImageError('CONFIGURATION', 'Settings storage is unavailable.')
        await store.update(entry, next)
      } catch (error) {
        await invoke('image_key_set', { value: oldKey })
        throw error
      }
      return describe()
    })
    writes = operation.catch(() => {})
    return operation
  }
  return { describe, active, models, save, isConfigured: async () => Boolean(await key()) }
}
