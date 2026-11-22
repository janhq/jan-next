/** Real Loader composition: a mention becomes a pointer, and read_chat reads the mentioned chat. */
import { executeToolFixture } from '@janhq/jan-tool-testkit'

import * as NativeToolExecutor from '@janhq/jan-tool-executor-native'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@janhq/cordis'
import Loader from '@janhq/cordis-plugin-loader'
import Include from '@janhq/cordis-plugin-include'
import { agentEvents, type Agent } from '@janhq/jan-agent'
import { createUserMessage, ToolCallId } from '@janhq/jan-llm'
import * as systemPromptPlugin from '@janhq/jan-system-prompt'
import * as toolsPlugin from '@janhq/jan-tools'
import * as sessionPlugin from '@janhq/jan-session'
import * as sessionProjectionPlugin from '@janhq/jan-session-projection'
import { SessionId } from '@janhq/jan-session'
import * as queryPlugin from '@janhq/jan-session-query-sqlite'
import * as referencePlugin from '@janhq/jan-session-reference'
import * as sourcePlugin from './fixtures/source-session.ts'

let context: Context | undefined
let root: string | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('session-reference real Loader composition', () => {
  it('logs a pointer instead of the chat, then reads the mentioned chat on demand', async () => {
    root = await mkdtemp(join(tmpdir(), 'reference-loader-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, await readFile(new URL('./fixtures/cordis.yml', import.meta.url), 'utf8'))
    const ctx = context = new Context()
    ctx.baseUrl = pathToFileURL(root).href + '/'
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@janhq/jan-session', sessionPlugin],
      ['@janhq/jan-session-projection', sessionProjectionPlugin],
      ['@janhq/jan-system-prompt', systemPromptPlugin],
      ['@janhq/jan-tools', toolsPlugin],
      ['@janhq/jan-tool-executor-native', NativeToolExecutor],
      ['@janhq/jan-session-query-sqlite', queryPlugin],
      ['@janhq/jan-session-reference', referencePlugin],
      ['./source-session.ts', sourcePlugin],
    ])
    ctx.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error('Unexpected Loader import: ' + specifier)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof ctx.loader.internal>
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await ctx.loader.await()

    const target = ctx.sessions.create(SessionId('reference-target'))
    const agent = { id: target.id, ctx, session: target } as Agent
    const direct = createUserMessage({
      content: [{ type: 'text', text: 'Use ' + referencePlugin.formatSessionReferenceMention({
        sessionId: SessionId('reference-source'), label: 'Research',
      }) }],
      source: { kind: 'user' },
    })
    const decision = await agentEvents(ctx, agent).waterfall('agent/pre-step', {
      modelSelection: { provider: 'mock', model: 'mock' },
      messages: [direct], turn: 1, step: 1, signal: new AbortController().signal,
    }, () => Promise.resolve({ kind: 'enter' as const, messages: [direct] }))
    if (decision.kind !== 'enter') throw new Error('Expected admitted reference')
    expect(decision.messages).toHaveLength(2)
    for (const message of decision.messages) target.append('user/message', message, { surfaceOp: 'append' })
    const pointer = JSON.stringify(decision.messages[1])
    expect(pointer).toContain('session_id: reference-source')
    expect(pointer).not.toContain('LATEST_SOURCE_FACT')

    const read = await executeToolFixture(ctx, {
      name: referencePlugin.READ_CHAT_TOOL, callId: ToolCallId('read'),
      arguments: { session_id: 'reference-source', query: 'forty-two' },
      signal: new AbortController().signal, agent,
    })
    if (read.isError) throw new Error(read.error.message)
    const text = read.value as string
    expect(text).toContain('LATEST_SOURCE_FACT\nThe captured answer is forty-two.')
    expect(text).not.toContain('NESTED_REFERENCE_MUST_NOT_PROPAGATE')
    expect(text).not.toContain('PRIVATE_REASONING_MUST_NOT_PROPAGATE')
  })
})
