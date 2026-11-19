/** Price what a Session's next request would inject before any message is sent. */
import type { Agent } from '@janhq/jan-agent'
import { assembleContextFor } from '@janhq/jan-agent'
import { joinContextSections, renderContextSections, renderPrompt } from '@janhq/jan-system-prompt'
import type {} from '@janhq/jan-tools'
import { ROLE_OVERHEAD, estimateContent, estimateToolsTokens } from '@janhq/jan-token-meter/estimate'
import type { SessionContextPreviewValue } from './types.ts'

/**
 * Assemble the prompt, tools, and runtime context the Agent's next step would send, without logging anything,
 * and price them with the token meter's heuristic so the figures match the `contextBreakdown` projection.
 * @param agent - Agent whose current model selection and scope compose the request.
 * @param signal - cancels tool resolution and prompt assembly.
 * @returns the priced parts, or null while the Agent has no model selection.
 */
export async function previewContext(agent: Agent, signal: AbortSignal): Promise<SessionContextPreviewValue | null> {
  const modelSelection = agent.model.current()
  if (modelSelection === undefined) return null
  const toolSet = await agent.ctx.tools.resolve({ agent, modelSelection, signal })
  try {
    const assembly = await agent.ctx.systemPrompt.assemble({ ...assembleContextFor(agent, signal), modelSelection, toolSet })
    const prompt = renderPrompt(assembly)
    const context = joinContextSections(renderContextSections(assembly))
    return {
      // A text-only system prompt prices as its text plus role framing, which one text block's price equals.
      systemTokens: prompt === '' ? 0 : estimateContent([{ type: 'text', text: prompt }]),
      toolsTokens: estimateToolsTokens({ config: { ...modelSelection }, ...assembly.tools.length > 0 ? { tools: assembly.tools } : {} }),
      messageTokens: context === '' ? 0 : estimateContent([{ type: 'text', text: context }]) + ROLE_OVERHEAD,
    }
  } finally {
    toolSet.dispose()
  }
}
