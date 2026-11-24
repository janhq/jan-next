/**
 * The `/context` breakdown: what one chat's next request is made of, by prompt
 * section, instruction file, skill, tool, message kind and injected context,
 * against its context window and automatic-compaction threshold.
 * @module @janhq/jan-context-usage
 */
import type { Context } from '@janhq/cordis'
import { assembleContextFor, type Agent } from '@janhq/jan-agent'
import type {} from '@janhq/jan-compaction'
import type { ToolSchema } from '@janhq/jan-llm'
import { mcpToolOrigin } from '@janhq/jan-mcp-client'
import { renderPrompt, type PromptAssembly } from '@janhq/jan-system-prompt'
import type {} from '@janhq/jan-token-meter'
import type {} from '@janhq/jan-tools'
import { Remote, TypertRemoteService } from '@janhq/jan-typert-protocol'
import { attribute, scale, type PricedMessage } from './breakdown.ts'
import type { ContextUsage } from './types.ts'

export type * from './types.ts'

declare module '@janhq/cordis' {
  interface Context { contextUsage: ContextUsageService }
}

/** Render each section alone so its text can be found inside the logged prompt. */
function renderSections(assembly: PromptAssembly): { name: string; text: string }[] {
  return assembly.sections.flatMap((section) => {
    try {
      const text = renderPrompt({ ...assembly, sections: [section] })
      return text === '' ? [] : [{ name: section.name, text }]
    } catch {
      // A section that cannot render alone is still counted, under `other`.
      return []
    }
  })
}

/** Reads one chat's context composition on demand; it adds nothing to the chat. */
export default class ContextUsageService extends TypertRemoteService {
  static inject = ['llm', 'systemPrompt', 'tokenMeter', 'tools']

  constructor(ctx: Context) {
    super(ctx, 'contextUsage', { namespace: 'contextUsage' })
  }

  /**
   * Break the chat's next request down into categories and named entries.
   * @param agent - chat to measure.
   * @param signal - cancels prompt assembly and capacity lookups.
   * @returns categories that sum to the occupancy the composer meter shows, plus capacity and threshold.
   */
  @Remote('breakdown')
  async breakdown(agent: Agent, signal: AbortSignal): Promise<ContextUsage> {
    const { session } = agent
    const header = session.requestHeader()
    const selection = agent.model.current()
    const route = header?.config ?? selection
    const assembly = selection === undefined ? undefined : await this.assemble(agent, selection, signal)
    const measurement = this.ctx.tokenMeter.measure(session)
    // Nodes whose event derives no message are priced at exactly 0 heuristic tokens; every other node costs at
    // least the role overhead. Dropping them aligns the meter with the derived transcript without reading old events.
    const priced = measurement.nodes.filter(node => node.heuristicTokens > 0)
    const derived = session.deriveMessages()
    if (priced.length !== derived.length) {
      throw new Error(`context-usage: ${priced.length} priced surface nodes do not match ${derived.length} derived messages`)
    }
    const messages: PricedMessage[] = derived.flatMap((message, index) => {
      const node = priced[index]
      return node === undefined ? [] : [{ message, tokens: node.tokens, heuristicTokens: node.heuristicTokens }]
    })
    const mcpServers = new Map<string, string>()
    for (const definition of agent.ctx.tools.definitions(agent)) {
      const origin = mcpToolOrigin(definition)
      if (origin !== undefined) mcpServers.set(definition.name, origin.serverName)
    }
    const tools: readonly ToolSchema[] = header?.tools ?? assembly?.tools ?? []
    const tally = attribute({
      messages,
      tools,
      mcpServers,
      sections: assembly === undefined ? [] : renderSections(assembly),
      ...assembly === undefined ? {} : { pendingSystemPrompt: renderPrompt(assembly) },
    })
    const anchored = measurement.baseline.kind === 'usage'
    const { categories, usedTokens } = scale(tally, anchored ? measurement.totalTokens : undefined)
    const measuredWindow = this.ctx.tokenMeter.contextPressure(session).contextWindow
    const contextWindow = measuredWindow !== undefined || route === undefined
      ? measuredWindow
      : (await this.ctx.llm.resolveModelInfo(route.provider, route.model, signal)).context?.contextWindow
    const autoCompactTokens = await this.ctx.get('compaction')?.autoCompactThreshold(agent, signal)
    return {
      ...route === undefined ? {} : { model: { provider: route.provider, model: route.model } },
      ...contextWindow === undefined ? {} : { contextWindow },
      usedTokens,
      usedSource: anchored ? 'provider' : 'estimate',
      ...autoCompactTokens === undefined ? {} : { autoCompactTokens },
      categories,
    }
  }

  /** Assemble the prompt the next step would send, to name its sections; nothing is logged. */
  private async assemble(
    agent: Agent, modelSelection: NonNullable<ReturnType<Agent['model']['current']>>, signal: AbortSignal,
  ): Promise<PromptAssembly | undefined> {
    const toolSet = await agent.ctx.tools.resolve({ agent, modelSelection, signal })
    try {
      return await agent.ctx.systemPrompt.assemble({ ...assembleContextFor(agent, signal), modelSelection, toolSet })
    } catch (error: unknown) {
      signal.throwIfAborted()
      this.ctx.logger.warn(`context-usage: prompt sections unavailable: ${error instanceof Error ? error.message : String(error)}`)
      return undefined
    } finally {
      toolSet.dispose()
    }
  }
}
