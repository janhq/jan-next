import {
  paramsSettings,
  type ParamDef,
  type SamplerCap,
} from '@/lib/predefinedParams'

/**
 * Per-provider sampler capabilities. `llamacpp` is the local engine with a
 * known sampler surface. User-added OpenAI-compatible providers point at
 * arbitrary endpoints — we can't know what samplers they accept, so they get
 * a permissive set.
 */

export type CapabilitySupport = 'supported' | 'maybe'

export interface ProviderCaps {
  /** Forwarded as-is; UI control rendered without warning. */
  supported: ReadonlySet<SamplerCap>
  /** Forwarded; UI control marked with "may be ignored by this endpoint". */
  maybe: ReadonlySet<SamplerCap>
}

const CORE_ONLY = new Set<SamplerCap>(['core', 'client_only'])

const set = (...c: SamplerCap[]) =>
  new Set<SamplerCap>([...CORE_ONLY, ...c])

const LLAMACPP: ProviderCaps = {
  supported: set(
    'penalties',
    'top_k',
    'min_p',
    'repetition',
    'mirostat',
    'dry',
    'xtc',
    'dynatemp',
    'typical_p',
    'top_n_sigma',
    'grammar',
    'json_schema',
    'ignore_eos',
    'sampler_order',
    'backend_sampling',
    'thinking_budget'
  ),
  maybe: new Set(),
}

/**
 * Custom user-added providers default to permissive — the user explicitly
 * pointed at an OpenAI-compatible endpoint of unknown shape, so showing all
 * common samplers (marked "may be ignored") is more useful than hiding them.
 */
const CUSTOM_PERMISSIVE: ProviderCaps = {
  supported: set(),
  maybe: new Set([
    'penalties',
    'top_k',
    'min_p',
    'repetition',
    'mirostat',
    'dry',
    'xtc',
    'dynatemp',
    'typical_p',
    'top_n_sigma',
    'grammar',
    'json_schema',
    'ignore_eos',
    'sampler_order',
    'backend_sampling',
    'thinking_budget',
  ]),
}

export function resolveProviderCaps(
  provider: Pick<ProviderObject, 'provider'> | string
): ProviderCaps {
  const id = typeof provider === 'string' ? provider : provider.provider
  return id === 'llamacpp' ? LLAMACPP : CUSTOM_PERMISSIVE
}

export interface ParamSupportEntry {
  def: ParamDef
  /** Providers (by ID) that fully support this param. */
  supportedBy: string[]
  /** Providers (by ID) that may silently ignore it. */
  maybeBy: string[]
}

/**
 * Union of params across the given providers. Each entry records which
 * providers support vs. may-ignore the param so the UI can render a tooltip.
 * A param is included iff at least one provider lists it as supported or maybe.
 */
export function paramsForProviders(
  providers: Array<Pick<ProviderObject, 'provider'>>
): ParamSupportEntry[] {
  const entries: ParamSupportEntry[] = []
  for (const def of Object.values(paramsSettings)) {
    if (def.capability === 'client_only') {
      entries.push({ def, supportedBy: providers.map((p) => p.provider), maybeBy: [] })
      continue
    }
    const supportedBy: string[] = []
    const maybeBy: string[] = []
    for (const p of providers) {
      const caps = resolveProviderCaps(p)
      if (caps.supported.has(def.capability)) supportedBy.push(p.provider)
      else if (caps.maybe.has(def.capability)) maybeBy.push(p.provider)
    }
    if (supportedBy.length + maybeBy.length === 0) continue
    entries.push({ def, supportedBy, maybeBy })
  }
  return entries
}
