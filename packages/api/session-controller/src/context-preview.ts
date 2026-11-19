/** Price what a Session's next request would inject, and list what it equips the Agent with. */
import type { Agent } from '@janhq/jan-agent'
import { assembleContextFor } from '@janhq/jan-agent'
import type {} from '@janhq/jan-agent-preset-registry/types'
import type {} from '@janhq/jan-mcp-manager'
import { isModelInvocable, isUserInvocable, type SkillSummary } from '@janhq/jan-skill'
import { joinContextSections, renderContextSections, renderPrompt } from '@janhq/jan-system-prompt'
import type {} from '@janhq/jan-tools'
import type {} from '@janhq/jan-working-directory'
import { ROLE_OVERHEAD, estimateContent, estimateToolsTokens } from '@janhq/jan-token-meter/estimate'
import type { SessionContextPreviewValue, SessionInventory, SessionItemOrigin } from './types.ts'

/** MCP tools are registered as `mcp__<server>__<tool>`, with the server name sanitized to these characters. */
const MCP_TOOL = /^mcp__(.+?)__(.+)$/
const INVALID_NAME_CHARS = /[^A-Za-z0-9_-]/g

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
 * @param signal - cancels the working-directory and skill reads.
 * @returns the Session inventory.
 */
async function readInventory(agent: Agent, toolNames: readonly string[], signal: AbortSignal): Promise<SessionInventory> {
  // Managed servers are profile config or plugin registrations; an MCP tool no
  // managed server owns was mounted for this Session alone (an ACP client's servers).
  const managed = (agent.ctx.get('mcpManager')?.list() ?? [])
    .map(server => ({ ...server, prefix: `mcp__${server.name.replace(INVALID_NAME_CHARS, '_')}__` }))
    .sort((left, right) => right.prefix.length - left.prefix.length)
  const tools: string[] = []
  const mcpTools: { server: string; name: string; origin: SessionItemOrigin }[] = []
  for (const name of toolNames) {
    const server = managed.find(candidate => name.startsWith(candidate.prefix))
    if (server !== undefined) {
      mcpTools.push({
        server: server.name,
        name: name.slice(server.prefix.length),
        origin: server.origin.kind === 'plugin' ? { kind: 'plugin', plugin: server.origin.plugin } : { kind: 'global' },
      })
      continue
    }
    const mcp = MCP_TOOL.exec(name)
    if (mcp === null) {
      tools.push(name)
      continue
    }
    const [, serverName = '', toolName = ''] = mcp
    mcpTools.push({ server: serverName, name: toolName, origin: { kind: 'session' } })
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
    const assembly = await agent.ctx.systemPrompt.assemble({ ...assembleContextFor(agent, signal), modelSelection, toolSet })
    const prompt = renderPrompt(assembly)
    const context = joinContextSections(renderContextSections(assembly))
    return {
      // A text-only system prompt prices as its text plus role framing, which one text block's price equals.
      systemTokens: prompt === '' ? 0 : estimateContent([{ type: 'text', text: prompt }]),
      toolsTokens: estimateToolsTokens({ config: { ...modelSelection }, ...assembly.tools.length > 0 ? { tools: assembly.tools } : {} }),
      messageTokens: context === '' ? 0 : estimateContent([{ type: 'text', text: context }]) + ROLE_OVERHEAD,
      inventory: await readInventory(agent, assembly.tools.map(tool => tool.name), signal),
    }
  } finally {
    toolSet.dispose()
  }
}
