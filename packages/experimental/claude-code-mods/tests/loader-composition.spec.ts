/** Real Loader composition: the bridge mounted from a cordis.yml row beside the shipped core plugins. */

import * as NativeToolExecutor from '@janhq/jan-tool-executor-native'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@janhq/cordis'
import Loader from '@janhq/cordis-plugin-loader'
import Include from '@janhq/cordis-plugin-include'
import AgentRegistry from '@janhq/jan-agent'
import AgentLoop from '@janhq/jan-agent-loop'
import CommandRuntime from '@janhq/jan-commands'
import LocalFileSystem from '@janhq/jan-fs-local'
import WorkingDirectory from '@janhq/jan-working-directory'
import LlmRuntime, { createUserMessage } from '@janhq/jan-llm'
import SessionStore, { SessionId } from '@janhq/jan-session'
import SessionProjectionRegistry from '@janhq/jan-session-projection'
import SystemPrompt from '@janhq/jan-system-prompt'
import ToolRuntime from '@janhq/jan-tools'
import { defineContentToolFixture } from '@janhq/jan-tool-testkit'
import * as ClaudeCodeMods from '../src/index.ts'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

// Keep workspace imports in Vitest's source graph even when the config has a package scope.
vi.mock('@janhq/cordis-plugin-loader/src/resolve.ts', () => ({ createResolve: () => undefined }))

const FIXTURES = resolve(import.meta.dirname, 'fixtures')

let ctx: Context | undefined
let root: string | undefined

afterEach(async () => {
  await ctx?.fiber.dispose()
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  ctx = undefined
  root = undefined
})

it('loads from cordis.yml, counts the model\'s tool calls, and answers /tally through the composed command registry', async () => {
  root = await mkdtemp(join(tmpdir(), 'jan-cc-mods-composition-'))
  await writeFile(join(root, 'package.json'), JSON.stringify({ type: 'module' }))
  const configPath = join(root, 'cordis.yml')
  const modules = new Map<string, unknown>([
    ['@janhq/jan-llm', LlmRuntime],
    ['@janhq/jan-session', SessionStore],
    ['@janhq/jan-session-projection', SessionProjectionRegistry],

    ['@janhq/jan-system-prompt', SystemPrompt],
    ['@janhq/jan-fs-local', LocalFileSystem],
    ['@janhq/jan-working-directory', WorkingDirectory],
    ['@janhq/jan-tools', ToolRuntime],
    ['@janhq/jan-tool-executor-native', NativeToolExecutor],
    ['@janhq/jan-agent', AgentRegistry],
    ['@janhq/jan-agent-loop', AgentLoop],
    ['@janhq/jan-commands', CommandRuntime],
    ['@janhq/jan-experimental-claude-code-mods', ClaudeCodeMods],
  ])
  // A mod is a plugin like any other: here the tutorial mod's `defineMod` wrapper, mounted by file URL after the bridge.
  const firstMod = pathToFileURL(resolve(FIXTURES, 'first-mod.ts')).href
  await writeFile(configPath, [
    ...[...modules.keys()].map(name => `- name: '${name}'`),
    `- name: '${firstMod}'`,
    '  config:',
    '    greeting: The model made',
  ].join('\n') + '\n')

  const context = ctx = new Context()
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  context.loader.internal = undefined
  await context.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await context.loader.await()
  for (const entry of context.loader.entries()) await entry.fiber?.await()

  const adapter = new MockAdapter([toolCallResponse('c1', 'echo', { command: 'ls' }), textResponse('listed')])
  context.llm.registerAdapter(['mock'], adapter)
  context.tools.register(defineContentToolFixture({
    name: 'echo', description: 'echo', parameters: { command: { type: 'string' } },
    async execute(args) { return [{ type: 'text', text: `ran ${args.command}` }] },
  }))
  const agent = await context.agentLoop.create(SessionId('composed'), { provider: 'mock', model: 'mock' })
  expect(context.commands.list(agent).map(command => command.name)).toEqual(['tally'])
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'list the files here' }], source: { kind: 'user' } }))
  await agent.whenIdle()
  expect(adapter.requests).toHaveLength(2)
  const run = await context.commands.execute(agent, '/tally', [], new AbortController().signal)
  expect(run?.result).toEqual({ kind: 'success', text: 'first-mod: The model made 1 tool calls since this mod loaded' })
})
