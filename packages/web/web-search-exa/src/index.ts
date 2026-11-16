/**
 * Register keyless Exa search and fetch providers in `ctx.web`, both under the id `exa`. They
 * need no credential, so they are ready for every model route; queries and URLs are sent to Exa.
 * @module @janhq/jan-web-search-exa
 */
import type { Context } from '@janhq/cordis'
import z from '@janhq/schemastery'
import type {} from '@janhq/jan-web'
import { EXA_DEFAULT_URL, EXA_MAX_RESULTS, ExaFetchProvider, ExaSearchProvider } from './provider.ts'
import type { ExaOptions } from './provider.ts'

export {
  EXA_DEFAULT_URL, EXA_MAX_RESULTS, EXA_PROVIDER_ID, ExaFetchProvider, ExaSearchProvider, callExaTool, parseRpcReply,
  parseSearchText, stripFetchHeader,
} from './provider.ts'
export type { ExaOptions } from './provider.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-exa'

/** The web seam these providers register into. */
export const inject = ['web']

/** Plugin config; every field has a default. */
export interface Config {
  /** Exa MCP endpoint. */
  url?: string
  /** Results requested when the caller sets no bound, at most {@link EXA_MAX_RESULTS}. */
  numResults?: number
  /** Characters of page text one fetch requests. */
  maxCharacters?: number
  /** Milliseconds one search or fetch may take. */
  timeoutMs?: number
}

export const Config: z<Config> = z.object({
  url: z.string().default(EXA_DEFAULT_URL),
  numResults: z.natural().min(1).max(EXA_MAX_RESULTS).default(5),
  maxCharacters: z.natural().min(1).default(40_000),
  timeoutMs: z.natural().min(1).default(30_000),
})

/**
 * Register the Exa search and fetch providers.
 * @param ctx - plugin context.
 * @param config - resolved plugin config.
 */
export function apply(ctx: Context, config: Config): void {
  // Schemastery has applied every default by the time `apply` runs.
  const resolved = config as Required<Config>
  if (!URL.canParse(resolved.url)) throw new Error(`web-search-exa: url is not a URL: ${resolved.url}`)
  const options = (): ExaOptions => resolved
  const search = new ExaSearchProvider(options)
  const fetcher = new ExaFetchProvider(options)
  ctx.web.registerSearchProvider({
    id: search.id, title: search.title, description: search.description,
    available: () => search.available(),
    search: (request, signal) => search.search(request, signal),
  })
  ctx.web.registerFetchProvider({
    id: fetcher.id, title: fetcher.title, description: fetcher.description,
    available: () => fetcher.available(),
    fetch: (request, signal) => fetcher.fetch(request, signal),
  })
}
