/**
 * Router preset INI the worker serves: a `[*]` block of shared llama.cpp server options and one
 * section per model, whose name is the model id requests select.
 */

/** Sizing and runtime options written to the `[*]` block. */
export interface PresetDefaults {
  /** `ctx-size`; 0 omits it so `fit` chooses the context. */
  ctxSize: number
  fit: boolean
  /** `fit-target`, in MiB kept free per device. */
  fitTargetMiB: number
  /** `fit-ctx`, the smallest context `fit` may choose; also the context when fit is off and `ctxSize` is 0. */
  fitCtx: number
  /** `cache-type-k` and `cache-type-v`. */
  cacheType: 'f16' | 'q8_0'
  threads?: number | undefined
  /** `n-gpu-layers`; omitted with fit on lets fit choose, and with fit off offloads every layer. */
  gpuLayers?: number | undefined
}

/** One model section. */
export interface PresetModel {
  /** Section name, the model id requests select. */
  id: string
  /** Absolute GGUF path. */
  path: string
}

/** Every layer, for `n-gpu-layers` with fit off; llama.cpp clamps it to the model. */
const ALL_LAYERS = 999

function value(text: string): string {
  return text.replace(/[\r\n]+/g, ' ').trim()
}

/**
 * Render a preset. `fit` only sizes options left unset, so the GPU layer count is omitted with
 * fit on unless configured, and the context is omitted only when `ctxSize` is 0.
 * @param defaults - shared options.
 * @param models - model sections, in order.
 * @returns the INI text.
 */
export function renderPreset(defaults: PresetDefaults, models: readonly PresetModel[]): string {
  const { ctxSize, fit, fitTargetMiB, fitCtx, cacheType, threads, gpuLayers } = defaults
  const fitted = [
    'fit = on', `fit-target = ${String(fitTargetMiB)}`,
    ctxSize > 0 ? `ctx-size = ${String(ctxSize)}` : `fit-ctx = ${String(fitCtx)}`,
    ...gpuLayers === undefined ? [] : [`n-gpu-layers = ${String(gpuLayers)}`],
  ]
  const pinned = ['fit = off', `ctx-size = ${String(ctxSize > 0 ? ctxSize : fitCtx)}`, `n-gpu-layers = ${String(gpuLayers ?? ALL_LAYERS)}`]
  const shared = [
    'jinja = true',
    // Flash attention lets the V cache be quantized too.
    'flash-attn = on',
    `cache-type-k = ${cacheType}`,
    `cache-type-v = ${cacheType}`,
    ...threads === undefined ? [] : [`threads = ${String(threads)}`],
    ...fit ? fitted : pinned,
  ]
  const sections = models.map(model => `[${model.id}]\nmodel = ${value(model.path)}\n`)
  return [`[*]\n${shared.join('\n')}\n`, ...sections].join('\n')
}
