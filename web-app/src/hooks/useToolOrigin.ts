import { useMemo } from 'react'
import { resolveToolOrigin, type ToolOrigin } from '@/lib/toolOrigin'

/** Which family a tool call belongs to, read from its DSH tool name. */
export const useToolOrigin = (toolName: string): ToolOrigin =>
  useMemo(() => resolveToolOrigin(toolName), [toolName])
