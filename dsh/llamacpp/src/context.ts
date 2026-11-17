/**
 * @file How much context the engine actually serves, and what DSH is told about
 * it. Every number is read from the model file, read from the running router,
 * or derived from the engine's own device-fit estimate; none is a standalone
 * constant that could drift from the truth.
 */

/** The context a router serves when the preset pins nothing (fit's own floor). */
export const FIT_FLOOR_CTX_SIZE = 4096

/**
 * The context the preset pins for every model when auto-fit is off.
 * See preset.ts `[*] ctx-size`: it is a guard, and it is what the engine will
 * really serve for a model with no per-model `ctx_size`.
 */
export const PRESET_CTX_SIZE = 8192

/**
 * Ceiling for the output tokens one request may reserve.
 *
 * Prompt and completion share the window, so a local model's whole window is
 * never available for output. Advertising the window as the output cap made the
 * harness reserve all of it, collapsing its compaction budget, so the cap is a
 * fraction of the window with an absolute ceiling.
 */
export const MAX_OUTPUT_TOKENS = 8192

/** Where a context number came from, so the UI can show the basis it used. */
export type ContextSource =
  | 'engine'
  | 'model-settings'
  | 'preset'
  | 'fit-floor'

export interface ContextBudget {
  /** The window the engine serves, in tokens. */
  contextWindow: number
  /** Tokens one request may reserve for its completion. */
  maxOutputTokens: number
  source: ContextSource
}

/**
 * Output reservation for a window: a quarter of it, bounded.
 * @param contextWindow - the window the engine serves.
 * @returns the output cap, never above {@link MAX_OUTPUT_TOKENS}.
 */
export function outputCapFor(contextWindow: number): number {
  const quarter = Math.floor(contextWindow / 4)
  return Math.max(1, Math.min(MAX_OUTPUT_TOKENS, quarter))
}

/**
 * The window the engine serves for one model, preferring what the running
 * engine reports over what the configuration asks for.
 *
 * `nCtx` is the post-fit value from the router's `/props`, so it outranks every
 * static number: fit may have shrunk the window below the configured one.
 * Nothing here falls back to the model's trained maximum: the engine does not
 * serve that while a preset pins a smaller window, and publishing it was what
 * let a request outgrow the real window.
 * @param input - the numbers available for this model.
 * @returns the window plus where it came from.
 */
export function resolveEffectiveContext(input: {
  /** `props.nCtx` of the loaded model, when it is loaded. */
  nCtx?: number | undefined
  /** `ctx_size` in model.yml, when the user or autoconfiguration set one. */
  configured?: number | undefined
  /** Auto-fit setting: decides which guard the preset applies. */
  fit?: boolean | undefined
  /** `fit_ctx`: the smallest window fit may settle on. */
  fitFloor?: number | undefined
}): { tokens: number; source: ContextSource } {
  const { nCtx, configured, fit, fitFloor } = input
  if (typeof nCtx === 'number' && Number.isFinite(nCtx) && nCtx > 0) {
    return { tokens: Math.floor(nCtx), source: 'engine' }
  }
  if (
    typeof configured === 'number' &&
    Number.isFinite(configured) &&
    configured > 0
  ) {
    return { tokens: Math.floor(configured), source: 'model-settings' }
  }
  // Fit chooses the window at load; until then the floor it may shrink to is
  // the only honest lower bound.
  if (fit !== false) {
    const floor =
      typeof fitFloor === 'number' && Number.isFinite(fitFloor) && fitFloor > 0
        ? Math.floor(fitFloor)
        : FIT_FLOOR_CTX_SIZE
    return { tokens: floor, source: 'fit-floor' }
  }
  return { tokens: PRESET_CTX_SIZE, source: 'preset' }
}

/**
 * The budget to publish for one model.
 * @param input - same numbers as {@link resolveEffectiveContext}.
 * @returns the window, the output cap and the basis of the window.
 */
export function contextBudget(input: {
  nCtx?: number | undefined
  configured?: number | undefined
  fit?: boolean | undefined
  fitFloor?: number | undefined
}): ContextBudget {
  const { tokens, source } = resolveEffectiveContext(input)
  return { contextWindow: tokens, maxOutputTokens: outputCapFor(tokens), source }
}

/**
 * Context sizes to probe, largest first, ending at a usable floor.
 *
 * Halving from the trained maximum: each step halves the KV cache, so the
 * largest passing candidate keeps as much context as the device can hold.
 * @param nativeLimit - the model's trained maximum.
 * @param floor - the smallest window still worth loading.
 * @returns candidates in descending order.
 */
export function contextCandidates(nativeLimit: number, floor: number): number[] {
  const lower = Math.max(1, Math.floor(floor))
  const upper = Math.max(lower, Math.floor(nativeLimit))
  const candidates: number[] = []
  for (let size = upper; size > lower; size = Math.floor(size / 2)) {
    candidates.push(size)
  }
  candidates.push(lower)
  return candidates
}

/** How a candidate context is expected to load on this machine. */
export type FitVerdict = 'GREEN' | 'YELLOW' | 'RED'

export interface ContextRecommendation {
  /** The largest context the device can take, or the floor when none does. */
  tokens: number
  /** How that size is expected to load. */
  fit: FitVerdict
  /** The model's trained maximum, when its metadata says. */
  nativeLimit?: number | undefined
  /** The largest window the GPUs' dedicated memory holds, when it could be computed. */
  vramBound?: number | undefined
  /** Set when the pick is not backed by a probe of this machine. */
  unknown?: string | undefined
}

/**
 * Pick the largest context the device can hold from probe results.
 * @param input - candidate verdicts in descending order, plus the native limit.
 * @returns the recommendation, or `unknown` when nothing could be probed.
 */
export function pickRecommendation(input: {
  probes: { tokens: number; fit: FitVerdict }[]
  nativeLimit?: number | undefined
  vramBound?: number | undefined
  floor: number
}): ContextRecommendation {
  const { probes, nativeLimit, vramBound, floor } = input
  const bounded = vramBound === undefined ? {} : { vramBound }
  if (probes.length === 0) {
    return {
      tokens: floor,
      fit: 'RED',
      nativeLimit,
      ...bounded,
      unknown: 'no device-fit probe was possible',
    }
  }
  const usable = probes.find((probe) => probe.fit !== 'RED')
  if (usable === undefined) {
    return { tokens: probes[probes.length - 1].tokens, fit: 'RED', nativeLimit, ...bounded }
  }
  // The largest window whose weights and KV cache stay in VRAM wins. A size
  // that only loads by pushing the cache into system RAM is still usable, but
  // it is not the automatic pick: the 4B test model at 262144 tokens needed
  // about 11 minutes to eat a 23.6k-token prompt, which is nobody's default.
  const resident = probes.find((probe) => probe.fit === 'GREEN')
  return resident === undefined
    ? { tokens: usable.tokens, fit: usable.fit, nativeLimit, ...bounded }
    : { tokens: resident.tokens, fit: 'GREEN', nativeLimit, ...bounded }
}

/**
 * The largest context whose weights and KV cache fit the GPUs' own memory.
 *
 * The engine's device-fit probe reads the driver's reported VRAM, which on a
 * Windows Vulkan stack includes shared system memory, so it can call a window
 * that spills the cache into RAM "GREEN"; the 4B test model at 262144 then took
 * about 11 minutes to process a 23.6k-token prompt. This bound uses only the
 * dedicated memory the hardware plugin reports, so an automatic pick stays
 * resident and fast.
 * @param input - model size, KV bytes per token, free dedicated VRAM.
 * @returns the largest token count inside that memory, or undefined when a
 *   term is unknown and no bound can be justified.
 */
export function vramContextBound(input: {
  weightsBytes?: number | undefined
  kvBytesPerToken?: number | undefined
  vramBytes?: number | undefined
  fill?: number | undefined
}): number | undefined {
  const positive = (value?: number) =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
  const weights = positive(input.weightsBytes)
  const perToken = positive(input.kvBytesPerToken)
  const vram = positive(input.vramBytes)
  if (weights === undefined || perToken === undefined || vram === undefined) return undefined
  const budget = vram * (input.fill ?? VRAM_FILL_LIMIT) - weights
  if (budget <= 0) return undefined
  return Math.floor(budget / perToken)
}

/**
 * What a catalog entry is likely to do on this machine, before it is
 * downloaded.
 *
 * The weights are the only exact number available for a catalog entry: its
 * architecture, layer and head counts, and the context it will be served, are
 * all unknown until the file is on disk. So the comparison reports the space
 * the weights need against the memory this machine has, and states that KV
 * cache and compute buffers are not priced. A label never claims the model will
 * fit when the headroom the unknown costs need is not there.
 */
export interface CatalogFit {
  label: 'Likely fits' | 'May need CPU offload' | 'Tight fit' | 'Unlikely to fit' | 'Fit unknown'
  detail: string
  tone: 'success' | 'warning' | 'danger' | 'neutral'
}

/**
 * Share of the weights a GPU needs free for the KV cache and compute buffers
 * that no catalog entry can size. Dedicated for chat-sized contexts.
 */
const KV_OVERHEAD_RATIO = 0.25

/**
 * Share of free VRAM the estimate will fill before it stops calling the result
 * likely. The driver, allocator fragmentation and a context larger than the
 * assumed chat size all take room the ratio cannot see, so a card that is 96%
 * full is not a fit the panel should promise.
 */
const VRAM_FILL_LIMIT = 0.9

/**
 * Estimate whether a quant's weights can be served by this machine.
 * @param input - the quant's byte size and the detected memory totals.
 * @returns the label plus the numbers it was based on.
 */
export function estimateCatalogFit(input: {
  /** Download size of the quant's GGUF, in bytes. */
  bytes?: number | undefined
  /** Free VRAM across the machine's GPUs, in bytes; undefined when unknown. */
  vram?: number | undefined
  /** Total system RAM in bytes; undefined when unknown. */
  ram?: number | undefined
  /**
   * Apple Silicon: the GPU runs from the same RAM, so there is no separate VRAM
   * and nothing to offload to. `ram` is then the pool the model runs in.
   */
  unified?: boolean | undefined
}): CatalogFit {
  const { bytes, vram, ram, unified } = input
  const usable = (value?: number) =>
    typeof value === 'number' && Number.isFinite(value) && value > 0
      ? value
      : undefined
  const size = usable(bytes)
  const gpu = usable(vram)
  const memory = usable(ram)
  if (size === undefined) {
    return {
      label: 'Fit unknown',
      tone: 'neutral',
      detail: 'The download size of this quant is not published, so memory use cannot be estimated.',
    }
  }
  const gb = (value: number) => `${(value / 1024 ** 3).toFixed(1)} GB`
  if (gpu === undefined && memory === undefined) {
    return {
      label: 'Fit unknown',
      tone: 'neutral',
      detail: `The weights are ${gb(size)}. This machine's memory could not be read, so no estimate is possible.`,
    }
  }
  const weightsWithOverhead = Math.ceil(size * (1 + KV_OVERHEAD_RATIO))
  const notes = [
    `${gb(size)} of weights`,
    `${Math.round(KV_OVERHEAD_RATIO * 100)}% added for the KV cache and compute buffers a chat-sized context needs`,
    'the real overhead depends on the architecture and context, which a catalog entry does not publish',
  ]
  if (unified === true && memory !== undefined) {
    // macOS keeps about 2.5 GB plus a tenth of the pool for itself and Metal,
    // the same reserve the engine's load check uses.
    const pool = memory - 2.5 * 1024 ** 3 - memory * 0.1
    if (weightsWithOverhead <= pool * VRAM_FILL_LIMIT) {
      return {
        label: 'Likely fits',
        tone: 'success',
        detail: `Fits in this Mac's ${gb(memory)} of unified memory, which the GPU shares, after the system's reserve: ${notes.join('; ')}.`,
      }
    }
    if (weightsWithOverhead <= pool) {
      return {
        label: 'Tight fit',
        tone: 'warning',
        detail: `Fits in ${gb(memory)} of unified memory only with little left for other apps; a long context may not fit: ${notes.join('; ')}.`,
      }
    }
    return {
      label: 'Unlikely to fit',
      tone: 'danger',
      detail: `${gb(size)} of weights against ${gb(memory)} of unified memory, after the system's reserve: ${notes.join('; ')}.`,
    }
  }
  if (gpu !== undefined && weightsWithOverhead <= gpu * VRAM_FILL_LIMIT) {
    return {
      label: 'Likely fits',
      tone: 'success',
      detail: `Fits in ${gb(gpu)} of free VRAM, keeping ${Math.round((1 - VRAM_FILL_LIMIT) * 100)}% free: ${notes.join('; ')}.`,
    }
  }
  const fitsRam = memory !== undefined && weightsWithOverhead <= memory
  const fitsVramAlone = gpu !== undefined && size <= gpu
  if (fitsVramAlone || fitsRam) {
    const where = fitsVramAlone
      ? `the weights alone fit in ${gb(gpu)} of free VRAM, but not with room for the KV cache and a working reserve`
      : `${gb(memory ?? 0)} of RAM holds the weights and that overhead`
    return {
      label: 'May need CPU offload',
      tone: 'warning',
      detail: `Runs only with layers offloaded to the CPU: ${where}; ${notes.join('; ')}.`,
    }
  }
  const available = [
    gpu === undefined ? null : `${gb(gpu)} of free VRAM`,
    memory === undefined ? null : `${gb(memory)} of RAM`,
  ].filter(Boolean).join(' and ')
  return {
    label: 'Unlikely to fit',
    tone: 'danger',
    detail: `${gb(size)} of weights against ${available || 'an unreadable memory total'}: ${notes.join('; ')}.`,
  }
}