import { describe, it, expect } from 'vitest'
import {
  toolActivityText,
  completedToolLabel,
  usedSkillNames,
} from './agentActivity'

describe('toolActivityText', () => {
  it('formats write with basename only', () => {
    expect(toolActivityText('write', { path: '/a/b/report.html' })).toBe(
      'Writing report.html'
    )
  })

  it('formats edit with basename only', () => {
    expect(toolActivityText('edit', { path: 'src/config.ts' })).toBe(
      'Editing config.ts'
    )
  })
  it('formats write with Windows-style path basename only', () => {
    expect(
      toolActivityText('write', { path: 'C:\\Users\\x\\report.html' })
    ).toBe('Writing report.html')
  })

  it('formats shell with truncated command', () => {
    expect(toolActivityText('shell', { command: 'ls -la' })).toBe(
      'Running ls -la'
    )
  })

  // Saved threads predate the rename and name the tool `bash`.
  it('formats a saved bash call like shell', () => {
    expect(toolActivityText('bash', { command: 'ls -la' })).toBe(
      'Running ls -la'
    )
  })

  it('truncates long shell commands to 60 chars', () => {
    const long = 'echo ' + 'x'.repeat(100)
    const text = toolActivityText('shell', { command: long })
    expect(text.startsWith('Running echo ')).toBe(true)
    expect(text.length).toBeLessThanOrEqual('Running '.length + 60)
  })

  it('formats read/ls/find/grep with basename', () => {
    expect(toolActivityText('read', { path: '/x/y.md' })).toBe('Reading y.md')
    expect(toolActivityText('ls', { path: '/x' })).toBe('Listing x')
    expect(toolActivityText('find', { path: '/x' })).toBe('Finding x')
    expect(toolActivityText('grep', { path: '/x' })).toBe('Searching x')
  })

  it('formats memory tools without a path', () => {
    expect(toolActivityText('memory', { op: 'write' })).toBe('Saving memory')
    expect(toolActivityText('memory', { op: 'delete' })).toBe('Saving memory')
    expect(toolActivityText('memory', { op: 'move' })).toBe('Saving memory')
    expect(toolActivityText('memory', { op: 'search' })).toBe('Searching memory')
    expect(toolActivityText('memory', { op: 'view' })).toBe('Reading memory')
    expect(toolActivityText('memory', {})).toBe('Reading memory')
  })

  it('names the skill being read', () => {
    expect(toolActivityText('skill_read', { name: 'pptx' })).toBe(
      'Reading pptx'
    )
    expect(
      completedToolLabel('skill_read', { name: 'pptx' }, 'output-available')
    ).toBe('Used pptx')
  })

  it('falls back to humanized tool name for unknown tools', () => {
    expect(toolActivityText('unknown_tool', { query: 'x' })).toBe('Unknown tool')
  })

  it('falls back gracefully when path/command arg is missing', () => {
    expect(toolActivityText('write', {})).toBe('Writing')
    expect(toolActivityText('shell', {})).toBe('Running')
  })
})

describe('usedSkillNames', () => {
  it('returns unique successfully loaded skill names only', () => {
    expect(
      usedSkillNames([
        {
          type: 'tool-skill_read',
          state: 'output-available',
          input: { name: 'pptx' },
        },
        {
          type: 'tool-skill_read',
          state: 'output-available',
          input: { name: 'pptx' },
        },
        {
          type: 'tool-skill_read',
          state: 'output-error',
          input: { name: 'broken' },
        },
      ])
    ).toEqual(['pptx'])
  })
})
