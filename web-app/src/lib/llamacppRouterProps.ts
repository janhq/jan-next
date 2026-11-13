import {
  getLlamacppEngine,
  type LlamacppService,
  type LocalEngineService,
} from '@/lib/llamacpp'

/** Post-fit `nCtx` is only available once the router has actually loaded the
 *  model; callers must fall back to a configured/default context size until then. */
export const getLlamacppExtension = (): LlamacppService | undefined =>
  getLlamacppEngine()

/** Local providers expose a launched context window via `getModelProps`; remote
 *  providers have none. Returns undefined for anything but llamacpp. */
export const getLocalPropsExtension = (
  provider?: string
): LocalEngineService | undefined => {
  if (provider === 'llamacpp') return getLlamacppExtension()
  return undefined
}

/** A ctx_len setting or launched n_ctx as a positive token count. The settings
 *  store keeps ctx_len as a number or a string, and '' when left to auto-fit. */
export const readCtxLen = (value: unknown): number | undefined => {
  const n = typeof value === 'string' ? parseInt(value, 10) : value
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : undefined
}
