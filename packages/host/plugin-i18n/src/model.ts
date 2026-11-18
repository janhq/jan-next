/** The no-tools model round trip behind plugin translation, on the user's default model route. */
import type { Context } from '@janhq/cordis'
import { BlockAssembler, type GenerateOptions, type LlmResolvedModelInfo, type ReasoningEffortId } from '@janhq/jan-llm'
import { deadline } from '@janhq/jan-timeout'
import type { ModelCall } from './translate.ts'
// Type-only: the `agentDefaultModel` service merge; the `llm` merge arrives with the value import above.
import type {} from '@janhq/jan-agent-default-model'

declare module '@janhq/jan-llm/types' {
  interface LlmRequestPurposeMap {
    'plugin-i18n': true
  }
}

/** Capability-owned timeout code for one translation request. */
export const PLUGIN_I18N_TIMEOUT_CODE = 'PLUGIN_I18N_TIMEOUT'

/** Execution limits of one request. */
export interface ModelLimits {
  readonly maxOutputTokens: number
  readonly timeoutMs: number
}

/** Least supported reasoning effort of a route: translation needs no deliberation. */
const leastEffort = (model: Readonly<LlmResolvedModelInfo>): ReasoningEffortId | undefined => model.reasoning?.efforts[0]?.id

/**
 * Read the route translations run on.
 * @param ctx - context exposing `agentDefaultModel`.
 * @returns the default provider and model.
 */
export function routeOf(ctx: Context): { provider: string; model: string } {
  const { provider, model } = ctx.agentDefaultModel.currentSelection()
  return { provider, model }
}

/**
 * Bind a model round trip to the current default route. The request carries no tools and no session; it never
 * enters a Session log.
 * @param ctx - context exposing `llm` and `agentDefaultModel`.
 * @param limits - output-token cap and end-to-end deadline per request.
 * @param signal - cancellation of the whole job.
 * @returns a call that resolves the route at each invocation.
 */
export function modelCall(ctx: Context, limits: ModelLimits, signal: AbortSignal): ModelCall {
  return async (system, input) => {
    using bounded = deadline(signal, limits.timeoutMs, PLUGIN_I18N_TIMEOUT_CODE)
    const { provider, model } = routeOf(ctx)
    const controls = { provider, model, maxTokens: limits.maxOutputTokens, temperature: 0 }
    const call = await ctx.llm.prepareCall(controls, bounded.signal, (proposed, info) => {
      const effort = leastEffort(info)
      return { ...proposed, ...effort === undefined ? {} : { reasoningEffort: effort } }
    })
    const options: GenerateOptions = {
      ...call.config,
      system,
      messages: [{ role: 'user', content: [{ type: 'text', text: input }] }],
      purpose: 'plugin-i18n',
      signal: bounded.signal,
    }
    const assembler = new BlockAssembler()
    for await (const chunk of call.stream(options)) {
      bounded.signal.throwIfAborted()
      assembler.push(chunk)
    }
    bounded.signal.throwIfAborted()
    const finish = assembler.finish
    if (finish.kind === 'error' || finish.kind === 'aborted') throw new Error(finish.failure.message)
    if (finish.kind !== 'stop') throw new Error(`translation ended with ${finish.kind}`)
    return assembler.blocks().flatMap(block => block.type === 'text' ? [block.text] : []).join('')
  }
}
