/**
 * Service Definition for the web access capability seam (`ctx.web`): registries and provider-selecting execution for search and
 * fetch. Duplicate ids are rejected. At execution time, the first registered and usable provider
 * of the configured preference list runs; without one, exactly one usable provider is required, so
 * selection never depends on registration order.
 * @module @janhq/jan-web
 */

import { Context, type Volatile } from '@janhq/cordis'
import { Remote, TypertRemoteService } from '@janhq/jan-typert-protocol'
import z from '@janhq/schemastery'
import type {
  WebFetchProvider,
  WebFetchRequest,
  WebFetchResult,
  WebProviderInfo,
  WebProviderList,
  WebProviderPreference,
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
} from './types.ts'
import { WebError } from './types.ts'

export {
  WebError,
} from './types.ts'
export type {
  WebFetchBody,
  WebFetchProvider,
  WebFetchRequest,
  WebFetchResult,
  WebProviderInfo,
  WebProviderList,
  WebProviderPreference,
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
  WebSearchSource,
} from './types.ts'

declare module '@janhq/cordis' {
  interface Context {
    web: WebRuntime
  }
}

/**
 * Config for the web seam. `searchProvider` / `fetchProvider` select the provider
 * for each capability; both are optional (a single registered usable provider
 * auto-selects). Each operation reads the current value, so a settings change
 * applies to the next search or fetch without remounting the service.
 * Operational overrides such as environment variables must feed these same
 * fields rather than introduce a hidden priority chain.
 */
export interface WebRuntimeConfig {
  /** Search provider id or preference list. Omitted or empty = auto-select when exactly one usable. */
  readonly searchProvider: Volatile<WebProviderPreference | undefined>
  /** Fetch provider id or preference list. Omitted or empty = auto-select when exactly one usable. */
  readonly fetchProvider: Volatile<WebProviderPreference | undefined>
}

/**
 * The web access service. Registered as `ctx.web` (one instance per context)
 * and exposed to Clients as the `web` Remote namespace (`listProviders`).
 *
 * Selection semantics (resolved at execution time, never registration-order-dependent):
 * - The first configured id that is registered and `available()` → that provider.
 *   Configured ids that are unregistered or unavailable are skipped.
 * - No configured id registered → `WEB_PROVIDER_CONFIGURED_MISSING`.
 * - Some configured id registered, none available →
 *   `WEB_PROVIDER_CONFIGURED_UNAVAILABLE`.
 * - No id configured, exactly one registered usable provider → that provider.
 * - No id configured, multiple usable providers → `WEB_PROVIDER_AMBIGUOUS`.
 * - No id configured, no usable provider → `WEB_PROVIDER_UNAVAILABLE`.
 */
export class WebRuntime extends TypertRemoteService {
  /**
   * Provider selection config. Operational env overrides feed the SAME fields:
   * `$JAN_WEB_SEARCH_PROVIDER` / `$JAN_WEB_FETCH_PROVIDER`, holding one id or
   * comma-separated ids, are used only while `searchProvider` / `fetchProvider`
   * is unset and are NOT a hidden priority chain.
   */
  static Config = z.object({
    searchProvider: z.union([z.string(), z.array(z.string())]).volatile(),
    fetchProvider: z.union([z.string(), z.array(z.string())]).volatile(),
  })

  private searchProviders = new Map<string, WebSearchProvider>()
  private fetchProviders = new Map<string, WebFetchProvider>()
  private readonly searchProviderEnv: readonly string[] | undefined
  private readonly fetchProviderEnv: readonly string[] | undefined

  constructor(ctx: Context, private readonly config: WebRuntimeConfig) {
    super(ctx, 'web')
    this.searchProviderEnv = envPreference(process.env.JAN_WEB_SEARCH_PROVIDER)
    this.fetchProviderEnv = envPreference(process.env.JAN_WEB_FETCH_PROVIDER)
  }

  /**
   * Register a search provider. `listProviders()` lists it until the
   * registration is disposed, which happens with the calling fiber or through
   * the returned disposer; registration and disposal each emit
   * `web/providers-changed`. Throws {@link WebError} `WEB_DUPLICATE_PROVIDER`
   * if its id is already registered for search.
   * @param provider - the provider; its `id` is the registry key.
   * @returns the disposer that unregisters the provider.
   */
  registerSearchProvider(provider: WebSearchProvider): () => void {
    return this.registerProvider(this.searchProviders, provider)
  }

  /**
   * Register a fetch provider, with the listing, disposal, and event behavior
   * of {@link WebRuntime.registerSearchProvider}. Throws {@link WebError}
   * `WEB_DUPLICATE_PROVIDER` if its id is already registered for fetch.
   * @param provider - the provider; its `id` is the registry key.
   * @returns the disposer that unregisters the provider.
   */
  registerFetchProvider(provider: WebFetchProvider): () => void {
    return this.registerProvider(this.fetchProviders, provider)
  }

  private registerProvider<P extends { readonly id: string }>(store: Map<string, P>, provider: P): () => void {
    if (store.has(provider.id)) {
      throw new WebError(`a web provider with id "${provider.id}" is already registered`, 'WEB_DUPLICATE_PROVIDER')
    }
    const emitChanged = (): void => { this.emitProvidersChanged() }
    const dispose = this.ctx.effect(function* () {
      store.set(provider.id, provider)
      emitChanged()
      yield () => {
        store.delete(provider.id)
        emitChanged()
      }
    }, 'web.registerProvider()')
    // ctx.effect's disposer returns Promise<void>; our disposer API is
    // synchronous fire-and-forget — discard the (always-resolved) promise.
    return () => void dispose()
  }

  /**
   * List every registered search and fetch provider for provider pickers.
   * Availability does not filter the lists.
   * @returns detached `{ id, title, description }` entries per capability, in registration order.
   */
  @Remote
  listProviders(): WebProviderList {
    return {
      search: [...this.searchProviders.values()].map(providerInfo),
      fetch: [...this.fetchProviders.values()].map(providerInfo),
    }
  }

  /** Emit `web/providers-changed`, containing each listener's failure so none vetoes the mutation. */
  private emitProvidersChanged(): void {
    for (const listener of this.ctx.events.dispatch('emit', ['web/providers-changed'])) {
      try {
        const returned: unknown = listener()
        void Promise.resolve(returned).catch((error: unknown) => { this.warnListenerFailure(error) })
      } catch (error: unknown) {
        this.warnListenerFailure(error)
      }
    }
  }

  private warnListenerFailure(error: unknown): void {
    this.ctx.logger.warn('web: a web/providers-changed listener failed')
    this.ctx.logger.warn(error)
  }

  /**
   * Run one search through the selected provider. Resolves the provider at call
   * time with the selection rules above; throws {@link WebError} when the
   * capability cannot run. The seam enforces `request.maxResults` on the result:
   * if the provider over-returns, `sources[]` is truncated and `truncated` set.
   * @param request - the query and optional result limit.
   * @param signal - optional cancellation signal forwarded to the provider.
   * @returns the provider's results, capped to `request.maxResults`.
   */
  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const result = await this.selectSearchProvider().search(request, signal)
    return capSources(result, request.maxResults)
  }

  /**
   * Whether the provider `search()` would select can authenticate a search made for a
   * model request on the `llmProvider` chat route. Asks only that provider's `ready()`;
   * one without `ready()` counts as ready. Makes no network calls. A selection failure
   * answers true, because `search()` reports that failure as a structured `WebError`.
   * @param llmProvider - the provider route id of the model request, when known.
   * @returns false only when the selected provider reports that it cannot authenticate.
   */
  async searchReady(llmProvider?: string): Promise<boolean> {
    return await selectedProviderReady(() => this.selectSearchProvider(), llmProvider)
  }

  /** Select the search provider with the rules above, throwing the matching {@link WebError}. */
  private selectSearchProvider(): WebSearchProvider {
    return resolveProvider(this.searchProviders, preferenceIds(this.config.searchProvider.get()) ?? this.searchProviderEnv)
  }

  /**
   * Retrieve one URL through the selected provider. Resolves the provider at
   * call time with the selection rules above; throws {@link WebError} when the
   * capability cannot run. A non-2xx response is a result, not a throw.
   * @param request - the URL plus retrieval options.
   * @param signal - optional cancellation signal forwarded to the provider.
   * @returns the retrieval outcome; non-2xx responses resolve descriptively.
   */
  async fetch(request: WebFetchRequest, signal?: AbortSignal): Promise<WebFetchResult> {
    return await this.selectFetchProvider().fetch(request, signal)
  }

  /**
   * Whether the provider `fetch()` would select can authenticate a fetch made for a
   * model request on the `llmProvider` chat route. Asks only that provider's `ready()`;
   * one without `ready()` counts as ready. Makes no network calls. A selection failure
   * answers true, because `fetch()` reports that failure as a structured `WebError`.
   * @param llmProvider - the provider route id of the model request, when known.
   * @returns false only when the selected provider reports that it cannot authenticate.
   */
  async fetchReady(llmProvider?: string): Promise<boolean> {
    return await selectedProviderReady(() => this.selectFetchProvider(), llmProvider)
  }

  /** Select the fetch provider with the rules above, throwing the matching {@link WebError}. */
  private selectFetchProvider(): WebFetchProvider {
    return resolveProvider(this.fetchProviders, preferenceIds(this.config.fetchProvider.get()) ?? this.fetchProviderEnv)
  }
}

/** Project one provider to its picker entry, omitting an absent title or description. */
function providerInfo(provider: WebSearchProvider | WebFetchProvider): WebProviderInfo {
  return {
    id: provider.id,
    ...provider.title === undefined ? {} : { title: provider.title },
    ...provider.description === undefined ? {} : { description: provider.description },
  }
}

interface ResolvableProvider {
  readonly id: string
  available(): boolean
  ready?(llmProvider: string | undefined): Promise<boolean>
}

/**
 * Ask the provider an operation selects whether it can authenticate for one chat route.
 * @param select - the operation's selection; throws its {@link WebError} when no provider qualifies.
 * @param llmProvider - the provider route id of the model request, when known.
 * @returns the provider's answer; true when it has no `ready()` or selection fails, because the
 *   operation reports that failure itself.
 */
async function selectedProviderReady(select: () => ResolvableProvider, llmProvider: string | undefined): Promise<boolean> {
  let provider: ResolvableProvider
  try { provider = select() }
  catch (_selectionFailure) { return true /* The operation surfaces the same failure when called. */ }
  return await provider.ready?.(llmProvider) ?? true
}

/**
 * Normalize a configured preference to its ids.
 * @param preference - the configured id or preference list.
 * @returns the ids in preference order, or undefined when none is configured.
 */
function preferenceIds(preference: WebProviderPreference | undefined): readonly string[] | undefined {
  if (preference === undefined) return undefined
  const ids = typeof preference === 'string' ? [preference] : preference
  return ids.length === 0 ? undefined : ids
}

/**
 * Parse an environment override holding one id or comma-separated ids.
 * @param value - the variable's value.
 * @returns the non-empty ids in order, or undefined when it names none.
 */
function envPreference(value: string | undefined): readonly string[] | undefined {
  const ids = (value ?? '').split(',').map(id => id.trim()).filter(id => id.length > 0)
  return ids.length === 0 ? undefined : ids
}

/**
 * Resolve the selected provider or throw the matching {@link WebError}.
 * @param providers - providers registered for the capability.
 * @param configuredIds - configured ids in preference order, or undefined for auto-selection.
 * @returns the first registered and usable configured provider, or the single usable provider.
 */
function resolveProvider<P extends ResolvableProvider>(providers: ReadonlyMap<string, P>, configuredIds: readonly string[] | undefined): P {
  if (configuredIds !== undefined) {
    const registered = configuredIds.flatMap(id => providers.get(id) ?? [])
    const selected = registered.find(provider => provider.available())
    if (selected !== undefined) return selected
    const named = configuredIds.map(id => `"${id}"`).join(', ')
    if (registered.length === 0) {
      throw new WebError(`no configured web provider (${named}) is registered`, 'WEB_PROVIDER_CONFIGURED_MISSING')
    }
    throw new WebError(`no configured web provider (${named}) is both registered and available`, 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE')
  }
  const usable = [...providers.values()].filter(provider => provider.available())
  const [single] = usable
  if (single === undefined) {
    throw new WebError('no usable web provider is registered', 'WEB_PROVIDER_UNAVAILABLE')
  }
  if (usable.length > 1) {
    const ids = usable.map(provider => provider.id).join(', ')
    throw new WebError(`multiple usable web providers are registered (${ids}); configure one explicitly`, 'WEB_PROVIDER_AMBIGUOUS')
  }
  return single
}

/** Enforce `maxResults` on a search result: truncate `sources[]` and flag it. */
function capSources(result: WebSearchResult, maxResults: number | undefined): WebSearchResult {
  if (maxResults === undefined || result.sources.length <= maxResults) return result
  return { ...result, sources: result.sources.slice(0, maxResults), truncated: true }
}

export default WebRuntime
