/** Agent files of each supported tool read into Jan profiles, and Jan files written back. */
import { expect, it } from 'vitest'
import { parseProfile, renderProfile, type ProfileFile } from '../src/parse.ts'
import type { AgentProfile } from '../src/types.ts'

function file(source: ProfileFile['source'], relative: string, text: string): ProfileFile {
  return { source, scope: 'project', writable: source === 'jan', path: `/p/${relative}`, relative, text }
}

function profile(input: ProfileFile): AgentProfile {
  const parsed = parseProfile(input)
  if ('problem' in parsed) throw new Error(parsed.problem)
  return parsed.profile
}

it('maps Claude tool names and keeps a model alias for selection time', () => {
  const read = profile(file('claude', 'reviewer.md', [
    '---', 'name: reviewer', 'description: Reviews changes', 'tools: Read, Grep, Glob', 'model: haiku', 'effort: high', '---', '', 'Review only.', '',
  ].join('\n')))
  expect(read).toMatchObject({
    id: 'reviewer', description: 'Reviews changes', use: 'all', instructions: 'Review only.',
    tools: ['read', 'grep', 'glob'], disallowedTools: [], model: { model: 'haiku', reasoningEffort: 'high' }, warnings: [],
  })
})

it('drops unsupported Claude tool entries with warnings and never keeps an empty allowlist', () => {
  const read = profile(file('claude', 'x.md', [
    '---', 'name: x', 'tools: [Bash(git *), mcp__github__create_issue]', 'disallowedTools: Edit, mcp__github', 'skills: [a]', '---', 'Body',
  ].join('\n')))
  expect(read.tools).toBeUndefined()
  expect(read.disallowedTools).toEqual(['edit', 'apply_patch', 'mcp:github'])
  expect(read.warnings).toEqual([
    'skills is ignored',
    'tools entry Bash(git *) is not supported',
    'tools entry mcp__github__create_issue is not supported',
    'tools names no supported tool, so every tool stays available',
  ])
})

it('names an opencode agent by its path and maps a whole-resource deny rule', () => {
  const read = profile(file('opencode', 'team/reviewer.md', [
    '---', 'description: Team reviewer', 'mode: subagent', 'model: anthropic/claude-sonnet-5-5',
    'permissions:', '  - { action: edit, resource: "*", effect: deny }', '  - { action: bash, resource: "git *", effect: allow }',
    'steps: 5', '---', 'Look closely.',
  ].join('\n')))
  expect(read).toMatchObject({
    id: 'team/reviewer', use: 'subagent', model: { provider: 'anthropic', model: 'claude-sonnet-5-5' },
    disallowedTools: ['edit', 'write', 'apply_patch'],
  })
  expect(read.warnings).toEqual(['steps is ignored', 'permissions rule for bash on git * is ignored'])
})

it('reads a Codex TOML agent with developer instructions and a disabled shell', () => {
  const read = profile(file('codex', 'fixer.toml', [
    'name = "fixer"', 'description = "Fixes builds"', 'model = "gpt-6"', 'model_reasoning_effort = "medium"',
    'developer_instructions = """', 'Fix the build.', '"""', 'sandbox_mode = "read-only"', '', '[features]', 'shell_tool = false',
  ].join('\n')))
  expect(read).toMatchObject({
    id: 'fixer', instructions: 'Fix the build.', disallowedTools: ['bash'], model: { model: 'gpt-6', reasoningEffort: 'medium' },
    sandbox: 'read-only', warnings: [],
  })
})

it('reads and writes a Jan sandbox cap, and warns on an unknown one', () => {
  const draft = { id: 'worker', description: 'Builds', use: 'all' as const, sandbox: 'workspace-write' as const, instructions: 'Build.' }
  expect(profile(file('jan', 'worker.md', renderProfile(draft)))).toMatchObject({ sandbox: 'workspace-write', warnings: [] })
  const odd = profile(file('jan', 'x.md', ['---', 'sandbox: yolo', '---', 'X'].join('\n')))
  expect(odd.sandbox).toBeUndefined()
  expect(odd.warnings).toEqual(['sandbox "yolo" is not read-only, workspace-write, danger-full-access'])
})

it('records an unknown key as a warning instead of rejecting the file', () => {
  const read = profile(file('jan', 'helper.md', ['---', 'description: Helps', 'temperature: 0.2', '---', 'Help.'].join('\n')))
  expect(read).toMatchObject({ id: 'helper', writable: true, warnings: ['unknown key temperature'] })
})

it('reports a Claude file without a name and an invalid id as problems', () => {
  expect(parseProfile(file('claude', 'a.md', '---\ndescription: d\n---\n'))).toEqual({ problem: 'missing name' })
  expect(parseProfile(file('jan', 'a.md', '---\nname: ../up\n---\n'))).toEqual({ problem: 'invalid name "../up"' })
})

it('writes Claude-compatible keys that read back to the same profile', () => {
  const text = renderProfile({
    id: 'reviewer', description: 'Reviews: changes', use: 'subagent', instructions: 'Review.\n',
    model: { provider: 'tokamak', model: 'anthropic/claude-sonnet-5-5', reasoningEffort: 'high' },
    tools: ['read', 'grep', 'glob', 'mcp:github'], disallowedTools: ['edit', 'apply_patch', 'bash'],
  })
  expect(text).toBe([
    '---', 'name: reviewer', 'description: "Reviews: changes"', 'mode: subagent', 'model: tokamak/anthropic/claude-sonnet-5-5#high',
    'tools: Read, Grep, Glob, mcp__github', 'disallowedTools: Edit, Bash', '---', 'Review.', '',
  ].join('\n'))
  expect(profile(file('jan', 'reviewer.md', text))).toMatchObject({
    id: 'reviewer', use: 'subagent', instructions: 'Review.', warnings: [],
    model: { provider: 'tokamak', model: 'anthropic/claude-sonnet-5-5', reasoningEffort: 'high' },
    tools: ['read', 'grep', 'glob', 'mcp:github'], disallowedTools: ['edit', 'apply_patch', 'bash'],
  })
})
