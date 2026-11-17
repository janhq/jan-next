/**
 * Generic pi-ai-backed LLM adapter plugin. One plugin instance owns a dict of
 * provider routes; a route naming an installed pi-ai provider inherits that
 * provider's endpoint, protocol, and model catalog as defaults, and a route
 * pi-ai does not ship is declared outright. Profile facts resolve per request
 * over the optional `llm-pi-ai` user-settings section and the optional
 * credential seam, so a changed key, endpoint, model, or knob reaches the next
 * request without a restart; a changed *route set* (or a route's
 * registration-captured retry policy) re-registers the same adapter instance
 * in place.
 *
 * ```yaml
 * - id: llm
 *   name: '@janhq/jan-llm-pi-ai'
 *   config:
 *     providers:
 *       # Catalog route: everything but the credential comes from pi-ai.
 *       openai:
 *         apiKeyEnv: OPENAI_API_KEY
 *         retryPolicy:
 *           mode: normal
 *           maxRetries: 2
 *       # Catalog route with the catalog narrowed and one capacity corrected.
 *       anthropic:
 *         apiKeyEnv: ANTHROPIC_API_KEY
 *         models:
 *           - id: claude-sonnet-4-5
 *             contextWindow: 200000
 *       # Hand-declared route: pi-ai ships nothing under this key.
 *       acme-gateway:
 *         displayName: Acme Gateway
 *         apiKeyEnv: ACME_GATEWAY_API_KEY
 *         api: openai-completions
 *         baseURL: https://gateway.acme.example/v1
 *         # Reasoning dialect for a URL pi-ai cannot recognize.
 *         compat:
 *           thinkingFormat: deepseek
 *         models:
 *           - id: acme-large
 *             name: Acme Large
 *             contextWindow: 65536
 *             maxTokens: 4096
 *           - id: acme-think
 *             name: Acme Think
 *             contextWindow: 262144
 *             maxTokens: 32768
 *             # key = selectable level, value = wire spelling; only off may
 *             # leave the value empty (supported, send nothing).
 *             reasoningEfforts:
 *               off:
 *               high: high
 *               max: ultra
 * ```
 *
 * @module @janhq/jan-llm-pi-ai
 */
import type {} from '@janhq/jan-settings'

import type {} from '@janhq/cordis-plugin-loader'

import type { Context } from '@janhq/cordis'
import type { CredentialRef } from '@janhq/jan-credentials'
import { launchEnvironmentOf } from '@janhq/jan-launch-environment'
import { assertUsableApiKey, LlmError, resolveImageAttachmentAccess } from '@janhq/jan-llm'
import type { AdapterRegistrationHandle, DirectoryRegistrationHandle, LlmConfigurableProvider } from '@janhq/jan-llm'
import type {} from '@janhq/jan-fs'
import type {} from '@janhq/jan-agent-default-model'
import type { LlmDiscoveredModel } from '@janhq/jan-llm'
import { deepEqualJson } from '@janhq/jan-util-values'
import { PiAiAdapter } from './adapter.ts'
import { authContextFrom, credentialStoreFrom } from './auth.ts'
import { catalogProvider, catalogProviderIds } from './catalog.ts'
import { assertServiceable, Config, resolveProfiles, servedListing } from './config.ts'
import type { ResolvedPiAiProviderProfile } from './config.ts'
import { discoverModels } from './discovery.ts'
import type { StoredModelDiscoveryProfile } from './discovery.ts'
import { isListingProfile, RouteModelListings } from './listing.ts'
import { openListingStore } from './listing-store.ts'
import type { ListingProfile } from './listing.ts'
import { registerPiAiFlows } from './login.ts'
import { providerDefaultsOf } from './provider-data.ts'
import type { PiAiRequestHeaderContext } from './types.ts'

export { PiAiAdapter } from './adapter.ts'
export type { PiAiAdapterOptions } from './adapter.ts'
export type { PiAiRequestHeaderContext } from './types.ts'
export { Config } from './config.ts'
export type {
  Options,
  PiAiCompatProfile,
  PiAiModelListing,
  ResolvedPiAiModelListing,
  PiAiModality,
  PiAiModelOverride,
  PiAiModelProfile,
  PiAiProviderProfile,
  PiAiReasoningEfforts,
  PiAiThinkingFormat,
  ResolvedPiAiProviderProfile,
} from './config.ts'
export { recordKeyFor } from './auth.ts'
export { supportedProtocols } from './provider.ts'

export const name = 'llm-pi-ai'
export const inject = ['llm']

declare module '@janhq/cordis' {
  interface Events {
    /**
     * Prepare headers for one pi-ai inference call, excluding model discovery.
     * Listeners run synchronously and must call next(); they may edit only the
     * request-owned headers and must not retain them. Throws fail the call with
     * REQUEST_HEADERS before inference I/O. Harness attribution wins afterward.
     * Non-TypeError messages are user-visible and must exclude secrets. TypeError
     * details and non-Error values are replaced with safe guidance.
     * @mode waterfall
     * @param request - immutable routing metadata from the exact prepared call.
     * @param headers - fresh profile headers, shared only within this dispatch.
     * @param next - continue header preparation through the remaining listeners.
     * @returns headers passed to pi-ai after Harness attribution is applied.
     */
    'llm-pi-ai/request-headers'(request: PiAiRequestHeaderContext, headers: Headers, next: () => Headers): Headers
  }
}

const NS = 'llm-pi-ai'

/**
 * The registry captures these per route; a change here must re-register.
 * Sorted by provider so a settings document that merely reorders its keys is
 * not mistaken for a route change.
 */
function registrationFacts(profiles: ReadonlyMap<string, ResolvedPiAiProviderProfile>): unknown {
  return [...profiles.entries()]
    // `displayName` rides along because the registry hands it to every selector
    // through `providerInfo()`: a rename that did not re-register would leave
    // the old label showing until some unrelated fact happened to change.
    .map(([provider, profile]) => ({
      provider,
      displayName: profile.displayName,
      retryPolicy: profile.retryPolicy,
    }))
    .sort((left, right) => left.provider.localeCompare(right.provider))
}

/**
 * The configurable-provider directory: every installed catalog route, plus
 * every route the current profiles declare. A hand-declared route has no
 * catalog entry, so without this union it would have no settings address and
 * configuration surfaces could neither show nor edit it. A catalog route also
 * carries its catalog endpoint and native authentication, which a settings
 * editor shows while the profile leaves the endpoint or the credential
 * reference unset.
 * @param profiles - the currently resolved provider profiles.
 * @returns the directory entries in catalog order, declared routes last.
 */
function directoryEntries(
  profiles: ReadonlyMap<string, ResolvedPiAiProviderProfile>,
  settingsNs: string,
): LlmConfigurableProvider[] {
  const entries = new Map<string, LlmConfigurableProvider>()
  const declare = (provider: string, displayName: string, error?: string): void => {
    const installed = catalogProvider(provider)
    entries.set(provider, {
      provider,
      displayName,
      settingsNs,
      settingsPath: ['providers', provider],
      // Membership of the installed catalog, not of the settings document:
      // narrowing a shipped provider's models stores a profile too, and that
      // route is still one pi-ai knows.
      declared: installed === undefined,
      ...installed === undefined ? {} : providerDefaultsOf(installed),
      ...error === undefined ? {} : { error },
    })
  }
  for (const provider of catalogProviderIds()) declare(provider, provider)
  for (const [provider, profile] of profiles) declare(provider, profile.displayName, profile.catalogError)
  return [...entries.values()]
}

/** Whether a raw Loader value is an unevaluated `!!js` expression. */
function isExpression(value: unknown): boolean {
  return typeof value === 'object' && value !== null && '__jsExpr' in value
}

/**
 * Replace each unevaluated `!!js` expression in a raw candidate with the evaluated value at the same
 * place in the live config. The Loader evaluates expressions only after this plugin's
 * `internal/config` check, so without this every write to a section that stores an expression would
 * be refused for the expression's raw form. Everything else in the candidate, including other
 * fields of a route that holds an expression, is checked as written. An expression with no live
 * counterpart (a newly added route) is left out of the check.
 * @param raw - candidate value as offered to `internal/config`.
 * @param current - the live, evaluated value at the same place.
 * @returns the candidate with expressions replaced.
 */
function withEvaluatedExpressions(raw: unknown, current: unknown): unknown {
  if (isExpression(raw)) return current
  if (Array.isArray(raw)) {
    return raw.map((item: unknown, index) => withEvaluatedExpressions(item, Array.isArray(current) ? current[index] : undefined))
  }
  if (typeof raw !== 'object' || raw === null) return raw
  const live = typeof current === 'object' && current !== null ? current as Record<string, unknown> : {}
  return Object.fromEntries(Object.entries(raw).flatMap(([key, value]): [string, unknown][] => {
    const next = withEvaluatedExpressions(value, live[key])
    return isExpression(value) && next === undefined ? [] : [[key, next]]
  }))
}

/** Register one generic pi-ai adapter for all configured provider routes. */
export function apply(ctx: Context, config: Config): void {
  ctx.inject(['settings'], (child) => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)) })
  const settingsNs = ctx.fiber.entry?.options.id ?? NS
  let lastRaw: ReturnType<Config['providers']['get']> | undefined
  let lastListings = -1
  let memoized: ReadonlyMap<string, ResolvedPiAiProviderProfile> | undefined
  // Settles in-flight listing requests when this plugin instance unloads.
  const unloading = new AbortController()
  ctx.effect(() => () => { unloading.abort() }, 'llm-pi-ai model listings')
  // Routes with `modelListing` take their models from here. The callbacks
  // run only once a listing is requested, after every binding below exists.
  const listings = new RouteModelListings({
    target: (provider, profile) => listingTarget(provider, profile),
    signal: unloading.signal,
    onChange: (provider, models, fetched) => {
      registration?.modelsChanged()
      // Only a listing fetched with the current endpoint and credential may
      // move the saved default; a stored one may belong to another account.
      if (fetched) void adoptListedDefault(provider, models)
    },
    onStale: (provider, error) => {
      ctx.logger.warn(`llm-pi-ai: could not refresh the model listing of provider route "${provider}"; keeping the last listing`)
      ctx.logger.warn(error)
    },
    onPersistFailure: (provider, error) => {
      ctx.logger.warn(`llm-pi-ai: could not save the model listing of provider route "${provider}"`)
      ctx.logger.warn(error)
    },
  })
  // With storage mounted, listings survive restarts: a route serves its last
  // listing from the first read, and the launch refresh below replaces it.
  ctx.inject(['storageDomain'], (scoped) => {
    scoped.effect(() => {
      let released = false
      let close: (() => Promise<void>) | undefined
      const opened = openListingStore(scoped.storageDomain).then(
        async (result) => {
          if (released) {
            await result.close()
            return
          }
          listings.attach(result.store)
          close = result.close
        },
        (error: unknown) => {
          ctx.logger.warn('llm-pi-ai: model listings will not survive a restart; their storage did not open')
          ctx.logger.warn(error)
        },
      )
      return async () => {
        released = true
        listings.detach()
        await opened
        await close?.()
      }
    }, 'llm-pi-ai model listing storage')
  })
  /**
   * The resolved profiles for the current configuration, memoized by the raw
   * snapshot's identity — which is also what makes the adapter's own snapshot
   * stable across operations that observe no change.
   *
   * Catalog diagnostics stay in the snapshot beside serviceable models, so
   * stored configuration remains visible after an installed catalog changes.
   * Scalar configuration errors still reject resolution. A stored model
   * listing change also produces a new snapshot.
   */
  const profiles = (): ReadonlyMap<string, ResolvedPiAiProviderProfile> => {
    const raw = config.providers.get()
    const generation = listings.generation
    if (raw === lastRaw && generation === lastListings && memoized !== undefined) return memoized
    const next = resolveProfiles(
      structuredClone(raw) as import('./config.ts').Options['providers'],
      'deferred',
      listings.snapshot(),
    )
    lastRaw = raw
    lastListings = generation
    memoized = next
    return next
  }
  profiles()
  ctx.on('internal/config', (fiber, next) => {
    const raw: unknown = next()
    if (fiber !== ctx.fiber) return raw
    const candidate = Config(withEvaluatedExpressions(raw, { providers: config.providers.get() }) as import('./config.ts').Options)
    assertServiceable(
      { providers: structuredClone(candidate.providers.get()) } as import('./config.ts').Options,
      { providers: structuredClone(config.providers.get()) } as import('./config.ts').Options,
    )
    return raw
  })

  const lookupCredential = async (ref: CredentialRef): Promise<string | undefined> => {
    const credentials = ctx.get('credentials')
    const hit = credentials !== undefined
      ? (await credentials.resolve(ref))?.value
      // Without the seam the environment is the whole credential plane.
      : launchEnvironmentOf(ctx).get(ref)?.value
    return hit === undefined || hit.length === 0 ? undefined : hit
  }

  const resolveBaseURL = async (provider: string, ref: CredentialRef): Promise<string> => {
    const hit = await lookupCredential(ref)
    if (hit === undefined) {
      throw new LlmError(
        `llm-pi-ai: no endpoint for provider route "${provider}"; its profile resolves ${ref}, which is not set`
        + ' — the service that runs this route publishes it while it serves, or export it',
        'MISSING_CREDENTIAL',
      )
    }
    if (!URL.canParse(hit) || !/^https?:$/.test(new URL(hit).protocol)) {
      throw new LlmError(`llm-pi-ai: ${ref} for provider route "${provider}" is not an http(s) URL`, 'INVALID_CONFIG')
    }
    return hit
  }

  const resolveApiKey = async (
    provider: string,
    profile: ResolvedPiAiProviderProfile,
  ): Promise<string | undefined> => {
    const ref = profile.apiKeyEnv
    // Only a profile that names no credential at all defers to pi-ai's
    // provider-native discovery. Once one is named, a miss must fail loud:
    // handing pi-ai `undefined` would let it pick up an unrelated ambient key
    // (OPENAI_API_KEY and friends), billing another tenant for a request the
    // deployment meant to authenticate differently.
    if (ref === undefined) return undefined
    const hit = await lookupCredential(ref)
    if (hit !== undefined) return assertUsableApiKey(hit, 'llm-pi-ai', ref)
    throw new LlmError(
      `llm-pi-ai: no credential for provider route "${provider}"; its profile resolves ${ref}, which is not`
      + ` set — store ${ref} through the credentials service (the web Models page writes it) or export it,`
      + ' and remove apiKeyEnv only if this provider should authenticate from pi-ai\'s own environment discovery',
      'MISSING_CREDENTIAL',
    )
  }

  const listingTarget = async (provider: string, profile: ListingProfile): Promise<{ baseURL: string; apiKey: string | undefined }> => {
    const apiKey = await resolveApiKey(provider, profile)
    const baseURL = profile.baseURLEnv === undefined
      ? profile.baseURL
      : await resolveBaseURL(provider, profile.baseURLEnv)
    // Profile resolution requires baseURL or baseURLEnv on a listing route.
    /* v8 ignore next -- unreachable after resolveProfiles validation. */
    if (baseURL === undefined) throw new LlmError(`llm-pi-ai: provider route "${provider}" has no endpoint to list`, 'INVALID_CONFIG')
    return { baseURL, apiKey }
  }
  /**
   * Move the agent default to a served model when it names this route and a
   * model the new listing does not serve: the first served id of the route's
   * `preferredDefaults`, otherwise the first served model. Never rejects.
   */
  const adoptListedDefault = async (provider: string, listed: readonly LlmDiscoveredModel[]): Promise<void> => {
    const defaults = ctx.get('agentDefaultModel')
    const profile = profiles().get(provider)
    if (defaults === undefined || profile?.modelListing === undefined) return
    const models = servedListing(profile.modelListing, listed)
    const [first] = models
    if (first === undefined) return
    try {
      const current = defaults.currentSelection()
      if (current.provider !== provider || models.some(model => model.id === current.model)) return
      const next = profile.modelListing.preferredDefaults.find(id => models.some(model => model.id === id))
        ?? first.id
      await defaults.saveSelection({ provider, model: next })
      ctx.logger.info(`llm-pi-ai: default model ${provider}/${current.model} is not listed; set to ${provider}/${next}`)
    } catch (error) {
      ctx.logger.warn(`llm-pi-ai: could not move the default model to a model provider route "${provider}" lists`)
      ctx.logger.warn(error)
    }
  }

  /**
   * Bring one listing route up to date in the background; `force` fetches
   * even a fresh listing. A failure is logged at debug level only: every model
   * read of the route reports it, and a route that cannot authenticate is
   * skipped without a log. Never rejects.
   */
  const refreshListing = async (provider: string, force: boolean): Promise<void> => {
    const profile = profiles().get(provider)
    /* v8 ignore next -- a timer can fire after a config change removed the route and before loader/volatile-update clears it. */
    if (profile === undefined || !isListingProfile(profile)) return
    try { await listings.ensure(provider, profile, force) }
    catch (error) {
      if (unloading.signal.aborted || (error instanceof LlmError && error.code === 'MISSING_CREDENTIAL')) return
      ctx.logger.debug(`llm-pi-ai: could not list the models of provider route "${provider}"`)
      ctx.logger.debug(error)
    }
  }

  // One store and one ambient context for the whole plugin instance: both read
  // through `ctx` per call, so they stay correct across the collection rebuilds
  // a configuration change causes, and a sign-in survives one.
  const auth = { credentials: credentialStoreFrom(ctx), authContext: authContextFrom(ctx) }
  const adapter = new PiAiAdapter({
    profiles,
    resolveApiKey,
    resolveBaseURL: (provider, profile) => resolveBaseURL(provider, profile.baseURLEnv),
    auth,
    prepareHeaders: (request, headers) => ctx.waterfall('llm-pi-ai/request-headers', request, headers, () => headers),
    ensureModels: (provider, profile) => listings.ensure(provider, profile),
    resolveAttachments: () => ctx.get('attachments'),
    resolveImageAccess: (attachments, ref) => resolveImageAttachmentAccess(
      attachments,
      hostPath => ctx.get('fs')?.processPathFromHostPath(hostPath),
      ref,
    ),
    onReplayDegrade: ({ provider, model, reason }) => {
      ctx.logger.warn(
        `llm-pi-ai: unusable replay state on assistant history for route "${provider}/${model}";`
        + ` sending that message as provider-neutral content (${reason})`,
      )
    },
  })
  // Independent of the route set: signing in is what makes a route worth
  // adding, so the flows are offered before any profile names their provider.
  // Scoped to the authorization seam rather than injected outright, because a
  // composition without it (headless, ACP) simply has no surface to sign in
  // from, while everything else this plugin does still works.
  ctx.inject(['authorization'], (authorized) => { registerPiAiFlows(authorized, auth) })
  // The full installed catalog is configurable from the moment the plugin
  // mounts — dormant or not — so configuration surfaces can offer every
  // pi-ai provider before any route exists. Hand-declared routes join it as
  // profiles appear, and leave with them.
  let directory: DirectoryRegistrationHandle | undefined
  let directoryFacts: unknown
  const ensureDirectory = (): void => {
    const entries = directoryEntries(profiles(), settingsNs)
    if (deepEqualJson(entries, directoryFacts)) return
    // Atomic replace, never dispose-then-register: a route another adapter
    // family already declares would otherwise leave this plugin's whole
    // directory withdrawn and the Models page empty. The candidate set is validated first, so a collision keeps
    // the previous entries serving and only costs a diagnostic.
    if (directory === undefined) {
      directory = ctx.llm.registerConfigurableProviders(entries)
    } else {
      directory.replace(entries)
    }
    directoryFacts = entries
  }
  ensureDirectory()
  /** Host-owned request inputs for discovery of one configured route. */
  const storedDiscoveryProfile = (
    provider: string | undefined,
  ): StoredModelDiscoveryProfile | undefined => {
    if (provider === undefined) return undefined
    const profile = profiles().get(provider)
    if (profile === undefined) return undefined
    return {
      headers: profile.headers,
      resolveApiKey: () => resolveApiKey(provider, profile),
    }
  }
  // Interrogating an endpoint is a configuration-time action over a draft, so
  // it is offered for the whole namespace rather than per route: the provider
  // a surface is adding does not exist yet. The draft is the whole request
  // except the stored credential and deployment-owned headers: the curated UI
  // accepts neither, so an already-configured route supplies both inside the
  // Host rather than widening the discovery request.
  ctx.llm.registerModelDiscovery(settingsNs, (request, signal) => discoverModels(
    { ...request, ...signal === undefined ? {} : { signal } },
    () => storedDiscoveryProfile(request.provider),
  ))
  // Route effects bind to this apply fiber via the stable `ctx` reference,
  // even when a swap runs inside the scoped settings callback below. A bare
  // mount (zero routes) is the dormant posture: nothing registers until a
  // settings section supplies profiles, and routes drop when it empties.
  let registration: AdapterRegistrationHandle | undefined
  let registeredFacts: unknown
  const ensureRegistrationFacts = (): void => {
    const facts = registrationFacts(profiles())
    if (deepEqualJson(facts, registeredFacts)) return
    // The registry captures the route set and each route's retry policy at
    // registration, so a change to either must re-register. The swap is
    // atomic (same adapter instance, validated before anything moves): a
    // conflicting route leaves the previous routes serving requests, and
    // `registeredFacts` only advances once the registry actually holds the
    // new set — so returning to a working configuration always re-applies.
    const routes = [...profiles().keys()]
    if (registration === undefined) {
      // Dormant bare mount: nothing is registered until a section supplies
      // profiles, and an empty section keeps it that way.
      if (routes.length === 0) {
        registeredFacts = facts
        return
      }
      registration = ctx.llm.registerAdapter(routes, adapter)
    } else {
      registration.replace(routes)
    }
    registeredFacts = facts
  }
  ensureRegistrationFacts()

  // Each listing route lists at launch, or when it first appears, and then
  // refetches every refreshIntervalMs on its own timer. Reads past the
  // interval refetch on demand.
  const refreshTimers = new Map<string, { interval: number; timer: ReturnType<typeof setInterval> }>()
  const scheduleListingRefresh = (): void => {
    const wanted = new Map([...profiles()].flatMap(([provider, profile]) =>
      profile.modelListing === undefined ? [] : [[provider, profile.modelListing.refreshIntervalMs] as const]))
    for (const [provider, scheduled] of refreshTimers) {
      if (wanted.get(provider) === scheduled.interval) continue
      clearInterval(scheduled.timer)
      refreshTimers.delete(provider)
    }
    for (const [provider, interval] of wanted) {
      if (refreshTimers.has(provider)) continue
      const timer = setInterval(() => { void refreshListing(provider, true) }, interval)
      timer.unref()
      refreshTimers.set(provider, { interval, timer })
      // A route lists again whenever it is scheduled, at launch included, even
      // over a stored listing that is still fresh.
      void refreshListing(provider, true)
    }
  }
  ctx.effect(() => () => {
    for (const { timer } of refreshTimers.values()) clearInterval(timer)
    refreshTimers.clear()
  }, 'llm-pi-ai listing refresh')
  scheduleListingRefresh()

  ctx.on('loader/volatile-update', () => {
    try { ensureRegistrationFacts(); ensureDirectory(); scheduleListingRefresh() }
    catch (error) {
      ctx.logger.error('llm-pi-ai: configuration conflicts with an existing provider route')
      ctx.logger.error(error)
    }
  })
}
