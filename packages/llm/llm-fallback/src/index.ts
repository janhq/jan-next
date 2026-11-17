/**
 * Model fallback chain on the agent loop's request-recovery extension point.
 * A request the selected route cannot serve (rate limit, quota, refusal, or a
 * failure the provider retry policy gave up on) continues on the next
 * configured model inside the same turn. The user's model returns at a later
 * turn start, once its cooldown passed and the conversation is small enough
 * that dropping the prompt cache costs little.
 *
 * @module @janhq/jan-llm-fallback
 */

import type { Context, Volatile } from '@janhq/cordis'
import z from '@janhq/schemastery'
import type { Agent, ModelSelection, RequestErrorAction } from '@janhq/jan-agent'
import {
  ACCOUNT_QUOTA_EXCEEDED_CODE,
  CONTENT_REFUSED_CODE,
  CONTEXT_WINDOW_EXCEEDED_CODE,
  IMAGE_OFFLOAD_REQUIRED_CODE,
  QUOTA_EXCEEDED_CODE,
} from '@janhq/jan-llm'
import type { LlmFailure } from '@janhq/jan-llm'
import type {} from '@janhq/jan-token-meter'

export const name = 'llm-fallback'
export const inject = ['llm', 'tokenMeter']

/** One provider route in the fallback chain. */
export interface FallbackRoute {
  /** Registered provider route id. */
  provider: string
  /** Provider-owned model id. */
  model: string
}

/** Live-editable fallback policy; every field is a volatile reference. */
export interface Config {
  /** Ordered models tried after the selected one fails; empty turns fallback off (default `[]`). */
  chain: Volatile<FallbackRoute[]>
  /** Seconds a failed model rests before Jan tries it again or switches back to it (default 300). */
  cooldownSeconds: Volatile<number>
  /**
   * Return to the user's model at a turn start only while the conversation
   * uses less than this percent of that model's context window (default 30).
   * Switching models drops the provider prompt cache.
   */
  switchBackBelowPercent: Volatile<number>
}

/** Runtime schema for {@link Config}. */
export const Config: z<Config> = z.object({
  chain: z.array(z.object({
    provider: z.string().required(),
    model: z.string().required(),
  })).default([]).volatile(),
  cooldownSeconds: z.natural().max(86_400).default(300).volatile(),
  switchBackBelowPercent: z.number().min(0).max(100).default(30).volatile(),
}) as unknown as z<Config>

/** Failures the selected route will likely repeat right away: switch before same-route retries. */
const SWITCH_NOW: ReadonlySet<string> = new Set([
  'RATE_LIMIT',
  QUOTA_EXCEEDED_CODE,
  ACCOUNT_QUOTA_EXCEEDED_CODE,
  CONTENT_REFUSED_CODE,
])

/** Failures other recovery owns on the same route: compaction shrinks the request instead. */
const NEVER_SWITCH: ReadonlySet<string> = new Set([
  CONTEXT_WINDOW_EXCEEDED_CODE,
  IMAGE_OFFLOAD_REQUIRED_CODE,
])

/** Per-agent fallback state while the agent runs on a chain model. */
interface Fallback {
  /** The selection the user made; restored when the chain gives it back. */
  readonly home: ModelSelection
  /** Route this plugin selected last; any other current route means the user chose. */
  readonly active: FallbackRoute
  /** The home model's context window, when its adapter declares one. */
  readonly homeWindow: number | undefined
}

function sameRoute(left: FallbackRoute, right: FallbackRoute): boolean {
  return left.provider === right.provider && left.model === right.model
}

function routeKey(route: FallbackRoute): string {
  return JSON.stringify([route.provider, route.model])
}

/**
 * Install the fallback chain.
 * @param ctx - plugin context that owns the listeners.
 * @param config - parsed config with volatile references.
 */
export function apply(ctx: Context, config: Config): void {
  const now = (): number => Date.now()
  const fallbacks = new WeakMap<Agent, Fallback>()
  // Shared across agents: a rate-limited or exhausted account is exhausted for every conversation.
  const restingUntil = new Map<string, number>()
  let disposed = false

  function resting(route: FallbackRoute, at: number): boolean {
    const until = restingUntil.get(routeKey(route))
    if (until === undefined) return false
    if (until > at) return true
    restingUntil.delete(routeKey(route))
    return false
  }

  function rest(route: FallbackRoute, failure: LlmFailure, at: number): void {
    const retryAfterMs = failure.providerRetryAfterMs !== undefined && Number.isFinite(failure.providerRetryAfterMs)
      ? failure.providerRetryAfterMs
      : 0
    restingUntil.set(routeKey(route), at + Math.max(config.cooldownSeconds.get() * 1000, retryAfterMs))
  }

  /** Select the next usable chain route; undefined when none is left. */
  async function fallBack(agent: Agent, failure: LlmFailure, signal: AbortSignal): Promise<RequestErrorAction> {
    const failed = agent.model.current()
    if (failed === undefined) return undefined
    const at = now()
    rest(failed, failure, at)
    let previous = fallbacks.get(agent)
    // The user picked another model since this plugin last switched: their pick is the new home.
    if (previous !== undefined && !sameRoute(failed, previous.active) && !sameRoute(failed, previous.home)) {
      previous = undefined
    }
    const home = previous?.home ?? failed
    const target = [home, ...config.chain.get()].find(route => !sameRoute(route, failed) && !resting(route, at))
    if (target === undefined) return undefined
    if (sameRoute(target, home)) {
      fallbacks.delete(agent)
      agent.model.select(home)
    } else {
      const homeWindow = previous === undefined
        ? await ctx.llm.resolveModelInfo(home.provider, home.model, signal)
          .then(info => info.context?.contextWindow, () => undefined)
        : previous.homeWindow
      if (signal.aborted || disposed) return undefined
      fallbacks.set(agent, { home, active: { provider: target.provider, model: target.model }, homeWindow })
      agent.model.select({ provider: target.provider, model: target.model })
    }
    ctx.logger.info(
      `llm-fallback: ${failed.provider}/${failed.model} failed with ${failure.code}; `
      + `continuing on ${target.provider}/${target.model}`,
    )
    return { kind: 'retry' }
  }

  // Prepended: a fast-switch failure must reach this listener before same-route retries.
  ctx.on('agent/request-error', async ({ agent, failure, signal }, next) => {
    if (disposed || config.chain.get().length === 0 || NEVER_SWITCH.has(failure.code)) return next()
    if (SWITCH_NOW.has(failure.code)) {
      const action = await fallBack(agent, failure, signal)
      return action ?? (signal.aborted ? undefined : next())
    }
    const downstream = await next()
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- the effect can dispose the plugin while `next()` awaits.
    if (downstream !== undefined || signal.aborted || disposed) return downstream
    return fallBack(agent, failure, signal)
  }, true)

  // A waking delivery emits `running` synchronously before the first step
  // reads the selection, so a switch made here prices that whole turn.
  ctx.on('agent/status', ({ agent, status }) => {
    if (status !== 'running' || disposed) return
    const fallback = fallbacks.get(agent)
    if (fallback === undefined) return
    const current = agent.model.current()
    if (current === undefined || !sameRoute(current, fallback.active)) {
      fallbacks.delete(agent)
      return
    }
    if (resting(fallback.home, now())) return
    if (fallback.homeWindow !== undefined) {
      const used = ctx.tokenMeter.measure(agent.session).totalTokens
      if (used >= fallback.homeWindow * config.switchBackBelowPercent.get() / 100) return
    }
    fallbacks.delete(agent)
    agent.model.select(fallback.home)
    ctx.logger.info(`llm-fallback: switching back to ${fallback.home.provider}/${fallback.home.model}`)
  })

  ctx.effect(() => () => { disposed = true }, 'llm-fallback: stop switching')
}
