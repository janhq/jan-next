/**
 * Where a tool call came from. Jan runs four families of tools -- the built-in RAG tools, the built-in agent tools, subagent
 * dispatch, and MCP server tools -- and a collapsed card is ambiguous without
 * saying which.
 */
export type ToolOrigin =
  | { kind: 'rag' }
  | { kind: 'agent' }
  /** `task`: not a tool the workspace runs, but a whole nested agent. */
  | { kind: 'subagent' }
  | { kind: 'mcp'; detail: string }

export type ToolOriginContext = {
  /** MCP server owning this tool, when it is an MCP tool. */
  mcpServer?: string
  isRagTool: boolean
  isAgentTool: boolean
}

export const TASK_TOOL = 'task'

/**
 * Resolution order mirrors the execution order in the thread route: agent tools, then RAG, then MCP. RAG names shadowed by an MCP
 * server are already dropped from the RAG set upstream, so the two cannot both
 * match.
 */
export function resolveToolOrigin(
  toolName: string,
  { mcpServer, isRagTool, isAgentTool }: ToolOriginContext
): ToolOrigin | undefined {
  // Dispatched by the surface rather than the plugin, so it is not in the agent
  // tool set and would otherwise fall through to the unlabelled generic card.
  if (toolName === TASK_TOOL) return { kind: 'subagent' }
  if (isAgentTool) return { kind: 'agent' }
  if (isRagTool) return { kind: 'rag' }
  if (mcpServer) return { kind: 'mcp', detail: mcpServer }
  return undefined
}
