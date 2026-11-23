/** Price what a Session's next request would inject, and list what it equips the Agent with. */
import type { Agent } from '@janhq/jan-agent'
import { assembleContextFor } from '@janhq/jan-agent'
import type {} from '@janhq/jan-agent-preset-registry/types'
import { mcpToolOrigin } from '@janhq/jan-mcp-client'
import type {} from '@janhq/jan-mcp-manager'
import { scopeOf } from '@janhq/jan-scope'
import { isModelInvocable, isUserInvocable, type SkillSummary } from '@janhq/jan-skill'
import { joinContextSections, renderContextSections, renderPrompt } from '@janhq/jan-system-prompt'
import type { ToolDefinition } from '@janhq/jan-tools'
import type {} from '@janhq/jan-working-directory'
import { ROLE_OVERHEAD, estimateContent, estimateToolsTokens } from '@janhq/jan-token-meter/estimate'
import type { SessionContextPreviewValue, SessionInventory, SessionItemOrigin } from './types.ts'

/**
 * Where a skill was found. Filesystem roots name the folder they scanned; any
 * other provider is a plugin contributing its own skills.
 * @param skill - discovered skill metadata.
 * @returns the skill's origin.
 */
function skillOrigin(skill: SkillSummary): SessionItemOrigin {
  switch (skill.source) {
    case 'project-jan':
    case 'project-agents':
      return { kind: 'project' }
    case 'user-jan':
    case 'user-agents':
      return { kind: 'global' }
    case 'custom':
      return { kind: 'custom' }
    case 'runtime':
      return { kind: 'session' }
    default:
      return skill.provider === 'filesystem' ? { kind: 'bundled' } : { kind: 'plugin', plugin: skill.provider }
  }
}

/**
 * Split the offered tool names into MCP tools and the rest, and read the skills
 * and preset plugins the Agent runs with, each with where it comes from.
 * @param agent - Agent whose scope selects the skill view and preset composition.
 * @param toolNames - tool names the next request offers the model.
 * @param definitions - offered tool definitions, read when assembly captured its schemas.
 * @param signal - cancels the working-directory and skill reads.
 * @returns the Session inventory.
 */
async function readInventory(
  agent: Agent, toolNames: readonly string[], definitions: ReadonlyMap<string, ToolDefinition>, signal: AbortSignal,
): Promise<SessionInventory> {
  const manager = agent.ctx.get('mcpManager')
  const managed = manager?.list() ?? []
  const tools: string[] = []
  const mcpTools: { server: string; name: string; origin: SessionItemOrigin }[] = []
  for (const name of toolNames) {
    const definition = definitions.get(name)
    const mcp = definition === undefined ? undefined : mcpToolOrigin(definition)
    if (mcp === undefined) {
      tools.push(name)
      continue
    }
    const { serverName, rawName, connection } = mcp
    const server = manager?.ownsConnection(serverName, connection) === true
      ? managed.find(candidate => candidate.name === serverName)
      : undefined
    const origin: SessionItemOrigin = server?.origin.kind === 'plugin'
      ? { kind: 'plugin', plugin: server.origin.plugin }
      : { kind: scopeOf(connection.ctx) === undefined ? 'global' : 'session' }
    mcpTools.push({ server: serverName, name: rawName, origin })
  }
  const presets = agent.ctx.get('agentPresets')
  const registry = presets?.serviceFor(agent, 'skills') ?? agent.ctx.get('skills')
  const directory = agent.ctx.get('workingDirectory')
  const skills = registry === undefined
    ? []
    : (await registry.list({ scope: agent, signal, ...directory === undefined ? {} : { cwd: await directory.ensure(agent, signal) } }))
      .filter(skill => isModelInvocable(skill) || isUserInvocable(skill))
      .map(skill => ({ name: skill.name, description: skill.description, origin: skillOrigin(skill) }))
  const plugins = presets?.inspectCompositions(agent.ctx)[0]?.modules.map(module => module.moduleName)
  return { tools, mcpTools, skills, ...plugins === undefined ? {} : { plugins } }
}

/**
 * Assemble the prompt, tools, and runtime context the Agent's next step would send, without logging anything,
 * and price them with the token meter's heuristic so the figures match the `contextBreakdown` projection.
 * @param agent - Agent whose current model selection and scope compose the request.
 * @param signal - cancels tool resolution, prompt assembly and inventory reads.
 * @returns the priced parts and inventory, or null while the Agent has no model selection.
 */
export async function previewContext(agent: Agent, signal: AbortSignal): Promise<SessionContextPreviewValue | null> {
  const modelSelection = agent.model.current()
  if (modelSelection === undefined) return null
  const toolSet = await agent.ctx.tools.resolve({ agent, modelSelection, signal })
  try {
    // Copy the admitted definitions before assembly awaits: a registration removed meanwhile drops out of
    // the live view but stays in the assembled schemas, and the inventory must describe what assembly offered.
    const definitions = new Map(toolSet.view(agent))
    const assembly = await agent.ctx.systemPrompt.assemble({ ...assembleContextFor(agent, signal), modelSelection, toolSet })
    const prompt = renderPrompt(assembly)
    const context = joinContextSections(renderContextSections(assembly))
    return {
      // A text-only system prompt prices as its text plus role framing, which one text block's price equals.
      systemTokens: prompt === '' ? 0 : estimateContent([{ type: 'text', text: prompt }]),
      toolsTokens: estimateToolsTokens({ config: { ...modelSelection }, ...assembly.tools.length > 0 ? { tools: assembly.tools } : {} }),
      messageTokens: context === '' ? 0 : estimateContent([{ type: 'text', text: context }]) + ROLE_OVERHEAD,
      inventory: await readInventory(agent, assembly.tools.map(tool => tool.name), definitions, signal),
    }
  } finally {
    toolSet.dispose()
  }
}
