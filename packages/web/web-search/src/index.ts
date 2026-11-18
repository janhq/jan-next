/**
 * Register the web search backends of Jan's web search plugin in `ctx.web`: Exa (`exa`), Tavily
 * (`tavily`), SearXNG (`searxng`, search only), and You.com (`you`). Each operation resolves the
 * backend's configured API key through `ctx.credentials` (or the launch environment without one);
 * Exa and You.com fall back to keyless endpoints while it is unset, and Tavily requires it. Queries
 * and URLs are sent to the selected backend; `ctx.web` selects which backend serves each call.
 * @module @janhq/jan-web-search
 */
import type { Context } from '@janhq/cordis'
import type {} from '@janhq/jan-web'
import { assertNever } from '@janhq/jan-util-values'
import { resolve } from './config.ts'
import type { Config } from './config.ts'
import { keyLookupFrom } from './credentials.ts'
import { ExaFetchProvider, ExaSearchProvider } from './exa.ts'
import { SearxngSearchProvider } from './searxng.ts'
import { TavilyFetchProvider, TavilySearchProvider } from './tavily.ts'
import { YouFetchProvider, YouSearchProvider } from './you.ts'

export {
  BACKEND_IDS, Config, EXA_PROVIDER_ID, MAX_RESULTS, SEARXNG_PROVIDER_ID, TAVILY_PROVIDER_ID, YOU_PROVIDER_ID, resolve,
} from './config.ts'
export type {
  BackendId, ExaConfig, ExaSpec, SearxngConfig, SearxngSpec, SharedSpec, Spec, TavilyConfig, TavilySpec, YouConfig, YouSpec,
} from './config.ts'
export type { KeyLookup } from './credentials.ts'
export { ExaFetchProvider, ExaSearchProvider } from './exa.ts'
export { SearxngSearchProvider } from './searxng.ts'
export { TavilyFetchProvider, TavilySearchProvider } from './tavily.ts'
export { YouFetchProvider, YouSearchProvider } from './you.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search'

/** The web seam these providers register into. */
export const inject = ['web']

/**
 * Register a search provider for each configured backend, and a fetch provider for each except
 * SearXNG. Each registration is disposed with the plugin fiber.
 * @param ctx - plugin context.
 * @param config - plugin config after schemastery applied its defaults.
 * @throws {Error} at load for an invalid field; see {@link resolve}.
 */
export function apply(ctx: Context, config: Config): void {
  const spec = resolve(config)
  const lookupKey = keyLookupFrom(ctx)
  for (const backend of spec.providers) {
    switch (backend) {
      case 'exa':
        ctx.web.registerSearchProvider(new ExaSearchProvider(spec.exa, lookupKey))
        ctx.web.registerFetchProvider(new ExaFetchProvider(spec.exa, lookupKey))
        break
      case 'tavily':
        ctx.web.registerSearchProvider(new TavilySearchProvider(spec.tavily, lookupKey))
        ctx.web.registerFetchProvider(new TavilyFetchProvider(spec.tavily, lookupKey))
        break
      case 'searxng':
        /* v8 ignore next -- resolve() rejects a listed searxng without searxng.url. */
        if (spec.searxng === undefined) throw new Error('web-search: searxng.url is required')
        ctx.web.registerSearchProvider(new SearxngSearchProvider(spec.searxng))
        break
      case 'you':
        ctx.web.registerSearchProvider(new YouSearchProvider(spec.you, lookupKey))
        ctx.web.registerFetchProvider(new YouFetchProvider(spec.you, lookupKey))
        break
      /* v8 ignore next 2 -- closed-union backstop after Config validation. */
      default:
        assertNever(backend, 'web-search providers')
    }
  }
}
