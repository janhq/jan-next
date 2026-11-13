/**
 * Where a tool call came from: a DSH built-in tool, a subagent dispatch, or an
 * MCP server. A collapsed card is ambiguous without saying which.
 */
export type ToolOrigin =
  | { kind: 'agent' }
  /** A whole nested agent rather than a tool. */
  | { kind: 'subagent' }
  | { kind: 'mcp'; detail: string }

/** Subagent dispatch: `task` from Jan-era history, `subagent` from DSH. */
const SUBAGENT_TOOLS = new Set(['task', 'subagent'])

/** DSH's mcp-client names every tool `mcp__<serverName>__<rawName>`. */
const MCP_TOOL = /^mcp__([A-Za-z0-9_-]+?)__./

export function resolveToolOrigin(toolName: string): ToolOrigin {
  if (SUBAGENT_TOOLS.has(toolName)) return { kind: 'subagent' }
  const mcp = MCP_TOOL.exec(toolName)
  if (mcp) return { kind: 'mcp', detail: mcp[1] }
  return { kind: 'agent' }
}
