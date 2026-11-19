/**
 * Choosing the model translations run on: the person's saved pick, else the default model, else a loaded local
 * model, else any configured model.
 */
import { deadline } from '@janhq/jan-timeout'
import type { Context } from '@janhq/cordis'
// Type-only: the `ctx.llm` and `ctx.agentDefaultModel` merges.
import type {} from '@janhq/jan-llm'
import type {} from '@janhq/jan-agent-default-model'
import type { PluginI18nModelChoice, PluginI18nRoute, PluginI18nRouteChoices, PluginI18nRouteRef } from './types.ts'

/** Deadline of one model lookup or catalog read. */
const LOOKUP_TIMEOUT_MS = 3000

/** Total time spent finding a usable route, including catalog discovery. */
const ROUTE_TIMEOUT_MS = 10_000

/** Most models listed per provider in the picker. */
const MAX_MODELS_PER_PROVIDER = 100

/** The part of the managed local models service this package reads; the service is optional. */
interface LocalModels {
  snapshot(): {
    readonly provider: string
    readonly models: readonly { readonly id: string; readonly active: boolean; readonly status: string }[]
  }
}

/** Installed local models of the llama.cpp service, or none when it is not mounted. */
interface LocalState {
  readonly provider: string
  readonly loaded: readonly string[]
}

/** A context read by service name: `llamaCpp` is optional and this package does not depend on its types. */
interface NamedServices {
  get(name: string): unknown
}

/**
 * Read the llama.cpp service's route and the models it holds in memory, loaded default model first.
 * @param ctx - any context of the Host.
 * @returns the local route and its loaded model ids, or undefined when no such service is mounted.
 */
function localState(ctx: Context): LocalState | undefined {
  // The service is absent from deployments without local models, and its type lives in an unrelated package.
  const named: NamedServices = ctx
  const service = named.get('llamaCpp') as LocalModels | undefined
  if (service === undefined) return undefined
  const { provider, models } = service.snapshot()
  const loaded = models.filter(model => model.status === 'loaded').toSorted((a, b) => Number(b.active) - Number(a.active))
  return { provider, loaded: loaded.map(model => model.id) }
}

/** Bound the wait even when an adapter ignores its signal or has no cancellation API. */
async function lookup<T>(read: (signal: AbortSignal) => Promise<T>, upstream?: AbortSignal): Promise<T | undefined> {
  if (upstream?.aborted === true) return undefined
  using bounded = deadline(upstream, LOOKUP_TIMEOUT_MS, 'PLUGIN_I18N_LOOKUP_TIMEOUT')
  const { signal } = bounded
  const expired = Promise.withResolvers<undefined>()
  const onAbort = (): void => { expired.resolve(undefined) }
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    return await Promise.race([read(signal), expired.promise])
  } catch {
    return undefined
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

// A call, not a property read: TypeScript keeps `signal.aborted` narrowed to false across awaits.
function isAborted(signal: AbortSignal): boolean {
  return signal.aborted
}

/**
 * Whether a route can serve a request: its provider has an adapter and the adapter resolves the model.
 * @param ctx - context exposing `llm`.
 * @param route - the route to check.
 * @param signal - optional overall selection deadline.
 * @returns true when the route resolves.
 */
async function usable(ctx: Context, route: PluginI18nRouteRef, signal?: AbortSignal): Promise<boolean> {
  if (route.provider === '' || route.model === '') return false
  if (!ctx.llm.listProviders().some(provider => provider.id === route.provider)) return false
  const info = await lookup(probe => ctx.llm.resolveModelInfo(route.provider, route.model, probe), signal)
  return info !== undefined
}

/**
 * Read the default model selection.
 * @param ctx - context exposing `agentDefaultModel`.
 * @returns the default provider and model.
 */
export function defaultRoute(ctx: Context): PluginI18nRouteRef {
  const { provider, model } = ctx.agentDefaultModel.currentSelection()
  return { provider, model }
}

/**
 * Pick the model translations run on, trying in order: the person's saved pick, the default model, a loaded local
 * model, then the first model any configured provider lists. Each must resolve; if none does within the selection
 * deadline, the default model is returned unchecked so the request reports its own failure.
 * @param ctx - context exposing `llm`, `agentDefaultModel`, and optionally `llamaCpp`.
 * @param saved - the person's saved pick, if any.
 * @returns the route and why it was chosen.
 */
export async function chooseRoute(ctx: Context, saved: PluginI18nRouteRef | undefined): Promise<PluginI18nRoute> {
  using budget = deadline(undefined, ROUTE_TIMEOUT_MS, 'PLUGIN_I18N_ROUTE_TIMEOUT')
  const { signal } = budget
  if (saved !== undefined && await usable(ctx, saved, signal)) return { ...saved, source: 'saved' }
  const fallbackDefault = { ...defaultRoute(ctx), source: 'default' as const }
  if (await usable(ctx, fallbackDefault, signal) || signal.aborted) return fallbackDefault
  const local = localState(ctx)
  for (const id of local?.loaded ?? []) {
    const route = { provider: local?.provider ?? '', model: id }
    if (await usable(ctx, route, signal)) return { ...route, source: 'loaded-local' }
    if (isAborted(signal)) return fallbackDefault
  }
  for (const { id: provider } of ctx.llm.listProviders()) {
    const models = await lookup(() => ctx.llm.listModels(provider), signal)
    if (isAborted(signal)) return fallbackDefault
    if (models === undefined) continue
    for (const { id } of models.slice(0, MAX_MODELS_PER_PROVIDER)) {
      const route = { provider, model: id }
      if (await usable(ctx, route, signal)) return { ...route, source: 'configured' }
      if (isAborted(signal)) return fallbackDefault
    }
  }
  return fallbackDefault
}

/**
 * Read what the picker shows.
 * @param ctx - context exposing `llm`, `agentDefaultModel`, and optionally `llamaCpp`.
 * @param saved - the person's saved pick, if any.
 * @returns the route in use, the saved pick, the default model with its usability, and the pickable models.
 */
export async function routeChoices(ctx: Context, saved: PluginI18nRouteRef | undefined): Promise<PluginI18nRouteChoices> {
  const local = localState(ctx)
  const fallbackDefault = defaultRoute(ctx)
  const [route, defaultUsable, catalogs] = await Promise.all([
    chooseRoute(ctx, saved),
    usable(ctx, fallbackDefault),
    Promise.all(ctx.llm.listProviders().map(async ({ id: provider }) => ({
      provider, listed: await lookup(() => ctx.llm.listModels(provider)),
    }))),
  ])
  const models: PluginI18nModelChoice[] = []
  for (const { provider, listed } of catalogs) {
    if (listed === undefined) continue
    const isLocal = provider === local?.provider
    for (const { id, name } of listed.slice(0, MAX_MODELS_PER_PROVIDER)) {
      models.push({ provider, model: id, name, local: isLocal, loaded: isLocal && local.loaded.includes(id) })
    }
  }
  models.sort((a, b) => Number(b.local) - Number(a.local) || Number(b.loaded) - Number(a.loaded))
  return {
    route,
    saved: saved ?? null,
    default: { ...fallbackDefault, usable: defaultUsable },
    models,
  }
}
