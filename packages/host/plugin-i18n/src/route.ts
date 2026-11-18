/**
 * Choosing the model translations run on: the person's saved pick, else the default model, else a loaded local
 * model, else any configured model.
 */
import type { Context } from '@janhq/cordis'
// Type-only: the `ctx.llm` and `ctx.agentDefaultModel` merges.
import type {} from '@janhq/jan-llm'
import type {} from '@janhq/jan-agent-default-model'
import type { PluginI18nModelChoice, PluginI18nRoute, PluginI18nRouteChoices, PluginI18nRouteRef } from './types.ts'

/** Deadline of one model lookup while choosing a route. */
const LOOKUP_TIMEOUT_MS = 3000

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

/**
 * Whether a route can serve a request: its provider has an adapter and the adapter resolves the model.
 * @param ctx - context exposing `llm`.
 * @param route - the route to check.
 * @returns true when the route resolves.
 */
async function usable(ctx: Context, route: PluginI18nRouteRef): Promise<boolean> {
  if (route.provider === '' || route.model === '') return false
  if (!ctx.llm.listProviders().some(provider => provider.id === route.provider)) return false
  try {
    await ctx.llm.resolveModelInfo(route.provider, route.model, AbortSignal.timeout(LOOKUP_TIMEOUT_MS))
    return true
  } catch {
    return false
  }
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
 * model, then the first model any configured provider lists. Each must resolve; the default model is returned
 * unchecked when nothing does, so the request reports its own failure.
 * @param ctx - context exposing `llm`, `agentDefaultModel`, and optionally `llamaCpp`.
 * @param saved - the person's saved pick, if any.
 * @returns the route and why it was chosen.
 */
export async function chooseRoute(ctx: Context, saved: PluginI18nRouteRef | undefined): Promise<PluginI18nRoute> {
  if (saved !== undefined && await usable(ctx, saved)) return { ...saved, source: 'saved' }
  const fallbackDefault = defaultRoute(ctx)
  if (await usable(ctx, fallbackDefault)) return { ...fallbackDefault, source: 'default' }
  const local = localState(ctx)
  for (const id of local?.loaded ?? []) {
    const route = { provider: local?.provider ?? '', model: id }
    if (await usable(ctx, route)) return { ...route, source: 'loaded-local' }
  }
  for (const { id: provider } of ctx.llm.listProviders()) {
    let models: readonly { readonly id: string }[]
    try {
      models = await ctx.llm.listModels(provider)
    } catch {
      continue
    }
    for (const { id } of models.slice(0, MAX_MODELS_PER_PROVIDER)) {
      const route = { provider, model: id }
      if (await usable(ctx, route)) return { ...route, source: 'configured' }
    }
  }
  return { ...fallbackDefault, source: 'default' }
}

/**
 * Read what the picker shows.
 * @param ctx - context exposing `llm`, `agentDefaultModel`, and optionally `llamaCpp`.
 * @param saved - the person's saved pick, if any.
 * @returns the route in use, the saved pick, the default model with its usability, and the pickable models.
 */
export async function routeChoices(ctx: Context, saved: PluginI18nRouteRef | undefined): Promise<PluginI18nRouteChoices> {
  const local = localState(ctx)
  const models: PluginI18nModelChoice[] = []
  for (const { id: provider } of ctx.llm.listProviders()) {
    let listed
    try {
      listed = await ctx.llm.listModels(provider)
    } catch {
      continue
    }
    const isLocal = provider === local?.provider
    for (const { id, name } of listed.slice(0, MAX_MODELS_PER_PROVIDER)) {
      models.push({ provider, model: id, name, local: isLocal, loaded: isLocal && local.loaded.includes(id) })
    }
  }
  models.sort((a, b) => Number(b.local) - Number(a.local) || Number(b.loaded) - Number(a.loaded))
  const fallbackDefault = defaultRoute(ctx)
  return {
    route: await chooseRoute(ctx, saved),
    saved: saved ?? null,
    default: { ...fallbackDefault, usable: await usable(ctx, fallbackDefault) },
    models,
  }
}
