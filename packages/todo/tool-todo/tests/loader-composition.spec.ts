import { executeToolFixture } from '@janhq/jan-tool-testkit'
// Proves `allowParallelInProgress` is real configurability and not a constant:
// the flag is set in a cordis.yml booted through the real Loader, and both faces
// it controls — the model-facing description and the accepted input — follow it.
import * as NativeToolExecutor from '@janhq/jan-tool-executor-native'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@janhq/cordis'
import Loader from '@janhq/cordis-plugin-loader'
import Include from '@janhq/cordis-plugin-include'
import { ToolCallId } from '@janhq/jan-llm'
import { Session, SessionId } from '@janhq/jan-session'
import AgentRegistry from '@janhq/jan-agent'
import type { Agent } from '@janhq/jan-agent'
import SystemPrompt from '@janhq/jan-system-prompt'
import ToolRuntime from '@janhq/jan-tools'
import SessionProjectionRegistry from '@janhq/jan-session-projection'
import * as ToolTodo from '@janhq/jan-tool-todo'
import { unsupportedModel, unsupportedInbox } from '@janhq/jan-agent-loop-testkit'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function agent(ctx: Context): Promise<Agent> {
  const scope = ctx.plugin(() => {})
  const id = SessionId('todo-loader-agent')
  const session = Session.create(id)
  const value: Agent = {
    id, options: {}, session, model: unsupportedModel(),
    inbox: unsupportedInbox(),
    status: 'idle', ctx: scope.ctx,
    followup: () => {}, steer: () => {}, inject: () => {}, send: () => {}, cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  await ctx.agents.register(value)
  return value
}

function resultText(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

/**
 * Boot a cordis.yml carrying the given tool-todo config block.
 * @param configLines - YAML lines nested under the tool's `config:` key.
 * @returns the booted context.
 */
async function boot(configLines: readonly string[]): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'jan-todo-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@janhq/jan-agent'",
    "- name: '@janhq/jan-system-prompt'",
    "- name: '@janhq/jan-tools'",
    "- name: '@janhq/jan-tool-executor-native'",
    "- name: '@janhq/jan-session-projection'",
    "- name: '@janhq/jan-tool-todo'",
    ...configLines.length > 0 ? ['  config:', ...configLines] : [],
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@janhq/jan-agent', AgentRegistry],
    ['@janhq/jan-system-prompt', SystemPrompt],
    ['@janhq/jan-tools', ToolRuntime],
    ['@janhq/jan-tool-executor-native', NativeToolExecutor],
    ['@janhq/jan-session-projection', SessionProjectionRegistry],
    ['@janhq/jan-tool-todo', ToolTodo],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  for (const entry of ctx.loader.entries()) await entry.fiber?.await()
  return ctx
}

const PARALLEL_TODOS = [
  { content: 'run subagent a', status: 'in_progress' },
  { content: 'run subagent b', status: 'in_progress' },
]

describe('tool-todo real Loader composition through cordis.yml', () => {
  it('allowParallelInProgress: false narrows the description and rejects a parallel write', async () => {
    const ctx = await boot(['    allowParallelInProgress: false'])
    const description = ctx.tools.schemas().find(s => s.name === 'todo_write')?.description ?? ''
    expect(description).toContain('keep exactly one todo `in_progress`')
    expect(description).not.toContain('several only')

    const owner = await agent(ctx)
    const result = await executeToolFixture(ctx, {
      signal: new AbortController().signal,
      callId: ToolCallId('parallel'),
      name: 'todo_write',
      arguments: { todos: PARALLEL_TODOS },
      agent: owner,
    })
    expect(result.isError).toBe(true)
    expect(resultText(result)).toContain('at most one task may be in_progress')
    expect(owner.session.snapshotEvents().some(e => e.type === 'todo/write')).toBe(false)
  }, 30_000)

  it('allowParallelInProgress: true permits a parallel write end to end', async () => {
    const ctx = await boot(['    allowParallelInProgress: true'])
    const description = ctx.tools.schemas().find(s => s.name === 'todo_write')?.description ?? ''
    expect(description).toContain('several only when work runs in parallel')

    const owner = await agent(ctx)
    const result = await executeToolFixture(ctx, {
      signal: new AbortController().signal,
      callId: ToolCallId('parallel-enabled'),
      name: 'todo_write',
      arguments: { todos: PARALLEL_TODOS },
      agent: owner,
    })
    expect(result.isError).toBe(false)
    expect(owner.session.snapshotEvents().findLast(e => e.type === 'todo/write')?.data.todos).toEqual(PARALLEL_TODOS)
  }, 30_000)

  it.each([
    { label: 'is omitted', configLines: [], failure: '$.allowParallelInProgress missing required value' },
    { label: 'is not boolean', configLines: ['    allowParallelInProgress: "no"'], failure: '$.allowParallelInProgress expected boolean' },
  ])('fails loading when allowParallelInProgress $label', async ({ configLines, failure }) => {
    // The policy is self-contained, so misconfiguration fails at load: the
    // entry's apply rejects and boot never reaches a running tool.
    await expect(boot(configLines)).rejects.toThrow(failure)
  }, 30_000)
})
