/**
 * Router preset INI the worker serves: a `[*]` block of shared llama.cpp server options, one
 * section per model, whose name is the model id requests select, and alias sections
 * (`alias-of = <model id>`) that select another section's model without loading it twice. A key is
 * the server's CLI flag without its leading dashes; an option left unset is omitted so llama.cpp
 * (or the GGUF) decides.
 */
import type { Config } from './config.ts'
import type { ModelFacts } from './gguf.ts'

/** Server options after defaulting, written to the `[*]` block or, where model-dependent, a model section. */
export interface PresetSettings extends Pick<Config,
  | 'ctxSize' | 'fitTargetMiB' | 'fitCtx' | 'cacheType' | 'flashAttn' | 'threads' | 'gpuLayers' | 'batchSize' | 'ubatchSize'
  | 'parallel' | 'nCpuMoe' | 'moeCacheMiB' | 'device' | 'splitMode' | 'mainGpu' | 'kvOffload' | 'loadMode' | 'cacheRamMiB'
  | 'mmprojOffload'> {
  fit: boolean
  /** Absolute directory llama.cpp saves slot state in (`slot-save-path`). */
  slotSavePath: string
}

/** One model section. */
export interface PresetModel {
  /** Section name, the model id requests select. */
  id: string
  /** Absolute GGUF path. */
  path: string
  /** Absolute path of the model's vision projector, when it has one. */
  mmproj?: string
  facts: ModelFacts
}

/** Every layer, for `n-gpu-layers` with fit off; llama.cpp clamps it to the model. */
const ALL_LAYERS = 999

/**
 * Resolve the server options a configuration selects on a platform.
 * @param config - validated plugin configuration.
 * @param platform - operating system the worker runs on; `fit` defaults off on macOS.
 * @param slotSavePath - absolute slot state directory.
 * @returns the settings {@link renderPreset} writes.
 * @throws Error for a quantized KV cache with flash attention off, which llama.cpp refuses to load.
 */
export function resolvePresetSettings(config: Config, platform: NodeJS.Platform, slotSavePath: string): PresetSettings {
  if (config.cacheType !== 'f16' && config.flashAttn === 'off') {
    throw new Error(`llama-cpp: cacheType ${config.cacheType} needs flash attention; set flashAttn to on or auto, or cacheType to f16`)
  }
  return {
    ctxSize: config.ctxSize, fit: config.fit ?? platform !== 'darwin', fitTargetMiB: config.fitTargetMiB, fitCtx: config.fitCtx,
    cacheType: config.cacheType, flashAttn: config.flashAttn, threads: config.threads, gpuLayers: config.gpuLayers,
    batchSize: config.batchSize, ubatchSize: config.ubatchSize, parallel: config.parallel, nCpuMoe: config.nCpuMoe,
    moeCacheMiB: config.moeCacheMiB, device: config.device, splitMode: config.splitMode, mainGpu: config.mainGpu,
    kvOffload: config.kvOffload, loadMode: config.loadMode, cacheRamMiB: config.cacheRamMiB, mmprojOffload: config.mmprojOffload,
    slotSavePath,
  }
}

/**
 * The context the worker is asked for: the configured one, or `fit`'s floor when fit chooses,
 * capped at the model's trained context.
 * @param settings - resolved settings.
 * @param facts - the model's facts.
 * @returns tokens per sequence.
 */
export function plannedContext(settings: Pick<PresetSettings, 'ctxSize' | 'fitCtx'>, facts: ModelFacts): number {
  const wanted = settings.ctxSize > 0 ? settings.ctxSize : settings.fitCtx
  return Math.min(wanted, facts.contextLength ?? wanted)
}

function value(text: string): string {
  return text.replace(/[\r\n]+/g, ' ').trim()
}

function optional(key: string, setting: number | string | undefined): string[] {
  return setting === undefined ? [] : [`${key} = ${typeof setting === 'string' ? value(setting) : String(setting)}`]
}

/**
 * Render a preset. `fit` only sizes options left unset, so the GPU layer count is omitted with fit
 * on unless configured, and the context is omitted only when `ctxSize` is 0.
 * @param settings - resolved settings.
 * @param models - model sections, in order.
 * @param aliases - alias section name to the model id it selects; the worker refuses an alias of
 * anything but a listed model.
 * @returns the INI text.
 */
export function renderPreset(settings: PresetSettings, models: readonly PresetModel[], aliases: Readonly<Record<string, string>>): string {
  const { ctxSize, fit, fitTargetMiB, fitCtx, gpuLayers, parallel } = settings
  const fitted = [
    'fit = on', `fit-target = ${String(fitTargetMiB)}`,
    ctxSize > 0 ? `ctx-size = ${String(ctxSize)}` : `fit-ctx = ${String(fitCtx)}`,
    ...optional('n-gpu-layers', gpuLayers),
  ]
  const pinned = ['fit = off', `ctx-size = ${String(ctxSize > 0 ? ctxSize : fitCtx)}`, `n-gpu-layers = ${String(gpuLayers ?? ALL_LAYERS)}`]
  const shared = [
    ...fit ? fitted : pinned,
    `flash-attn = ${settings.flashAttn}`,
    `cache-type-k = ${settings.cacheType}`,
    `cache-type-v = ${settings.cacheType}`,
    ...optional('threads', settings.threads),
    ...optional('batch-size', settings.batchSize),
    ...optional('ubatch-size', settings.ubatchSize),
    // An explicit parallel count splits ctx-size across slots unless the KV cache is unified.
    ...parallel === undefined ? [] : [`parallel = ${String(parallel)}`, 'kv-unified = true'],
    ...optional('n-cpu-moe', settings.nCpuMoe),
    ...optional('device', settings.device),
    ...optional('split-mode', settings.splitMode),
    ...optional('main-gpu', settings.mainGpu),
    ...settings.kvOffload ? [] : ['no-kv-offload = true'],
    ...optional('load-mode', settings.loadMode),
    ...optional('cache-ram', settings.cacheRamMiB),
    `slot-save-path = ${value(settings.slotSavePath)}`,
  ]
  const sharedContext = fit ? ctxSize : ctxSize > 0 ? ctxSize : fitCtx
  const moeCacheAllowed = settings.splitMode !== 'tensor' && settings.device?.trim().toLowerCase() !== 'none'
  const sections = models.map((model) => {
    const trained = model.facts.contextLength
    const lines = [
      `model = ${value(model.path)}`,
      ...optional('mmproj', model.mmproj),
      ...model.mmproj !== undefined && !settings.mmprojOffload ? ['mmproj-offload = false'] : [],
      // llama.cpp would run past the trained context and degrade; fit already starts from it.
      ...sharedContext > 0 && trained !== undefined && trained < sharedContext ? [`ctx-size = ${String(trained)}`] : [],
      ...moeCacheAllowed && model.facts.expertCount > 0 ? optional('moe-cache-mib', settings.moeCacheMiB) : [],
    ]
    return `[${model.id}]\n${lines.join('\n')}\n`
  })
  const aliasSections = Object.entries(aliases).map(([alias, target]) => `[${alias}]\nalias-of = ${target}\n`)
  return [`[*]\n${shared.join('\n')}\n`, ...sections, ...aliasSections].join('\n')
}
