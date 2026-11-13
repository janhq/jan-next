import { describe, expect, it } from 'vitest'
import { resolveToolOrigin } from '../toolOrigin'

describe('resolveToolOrigin', () => {
  it('names the MCP server from a DSH mcp-client tool name', () => {
    expect(resolveToolOrigin('mcp__filesystem__read_file')).toEqual({
      kind: 'mcp',
      detail: 'filesystem',
    })
  })

  it('keeps a server name that contains underscores', () => {
    expect(resolveToolOrigin('mcp__my_srv__go')).toEqual({
      kind: 'mcp',
      detail: 'my_srv',
    })
  })

  it('labels subagent dispatch from both naming eras', () => {
    expect(resolveToolOrigin('subagent')).toEqual({ kind: 'subagent' })
    expect(resolveToolOrigin('task')).toEqual({ kind: 'subagent' })
  })

  it('treats DSH built-in tools as workspace tools', () => {
    expect(resolveToolOrigin('bash')).toEqual({ kind: 'agent' })
  })
})
