import { describe, expect, it } from 'vitest'
import { resolveToolOrigin } from '../toolOrigin'

const context = {
  isRagTool: false,
  isAgentTool: false,
}

describe('resolveToolOrigin', () => {
  it('recognises a RAG tool', () => {
    expect(
      resolveToolOrigin('search_documents', { ...context, isRagTool: true })
    ).toEqual({ kind: 'rag' })
  })

  it('names the MCP server for a server tool', () => {
    expect(
      resolveToolOrigin('read_file', { ...context, mcpServer: 'filesystem' })
    ).toEqual({ kind: 'mcp', detail: 'filesystem' })
  })

  it('prefers RAG over MCP when both somehow match', () => {
    expect(
      resolveToolOrigin('search_documents', {
        ...context,
        isRagTool: true,
        mcpServer: 'someserver',
      })
    ).toEqual({ kind: 'rag' })
  })

  it('recognises a built-in agent tool', () => {
    expect(
      resolveToolOrigin('memory', { ...context, isAgentTool: true })
    ).toEqual({ kind: 'agent' })
  })

  // Mirrors the thread route, where agent tools are dispatched before MCP, so a
  // filesystem server exposing `read` does not claim the built-in one's card.
  it('prefers the built-in agent tool over a same-named MCP tool', () => {
    expect(
      resolveToolOrigin('read', {
        ...context,
        isAgentTool: true,
        mcpServer: 'filesystem',
      })
    ).toEqual({ kind: 'agent' })
  })

  it('is undefined for an unknown tool', () => {
    expect(resolveToolOrigin('mystery', context)).toBeUndefined()
  })
})
