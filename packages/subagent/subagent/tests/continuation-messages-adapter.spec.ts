import { mountWorkingDirectoryFixture } from './working-directory-fixture.ts'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@janhq/cordis'
import AgentLoop from '@janhq/jan-agent-loop'
import { mountAgentLoopTestDependencies } from '@janhq/jan-agent-loop-testkit'
import { createUserMessage } from '@janhq/jan-llm'
import * as LlmPiAi from '@janhq/jan-llm-pi-ai'
import { SessionId } from '@janhq/jan-session'
import * as JsonlSessionPersistence from '@janhq/jan-session-persistence-jsonl'
import * as SubagentSpawn from '@janhq/jan-subagent-spawn-in-process'
import { anthropicFrame, anthropicMessageStart, closeMockServers, mockServer } from '../../../llm/llm-pi-ai/tests/mock-server.ts'
import SubagentRuntime, { type SubagentRunEndInfo } from '../src/index.ts'
import { loadStoredSession } from './persistence-helpers.ts'

const MODEL = 'messages-model'

afterEach(async () => {
  await closeMockServers()
  vi.unstubAllEnvs()
})

function messagesResponse(blocks: Record<string, unknown>[]) {
  return {
    events: [
      anthropicMessageStart,
      ...blocks.flatMap((content_block, index) => [
        anthropicFrame({ type: 'content_block_start', index, content_block }),
        anthropicFrame({ type: 'content_block_stop', index }),
      ]),
      anthropicFrame({ type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } }),
      anthropicFrame({ type: 'message_stop' }),
    ],
  }
}

it('continues the parent through Anthropic Messages after a reasoning-bearing continuable child settles', async () => {
  const root = mkdtempSync(join(tmpdir(), 'jan-settlement-messages-'))
  const ctx = new Context()
  try {
    const http = await mockServer([
      messagesResponse([{ type: 'thinking', thinking: 'child reasoning', signature: 'child-signature' }, { type: 'text', text: 'child answer' }]),
      messagesResponse([{ type: 'text', text: 'parent answer' }]),
      messagesResponse([{ type: 'text', text: 'parent answer' }]),
    ])
    const { requests } = http
    vi.stubEnv('MESSAGES_TEST_KEY', 'test-key')
    await mountAgentLoopTestDependencies(ctx, { workingDirectory: true })
    await ctx.plugin(JsonlSessionPersistence, { root })
    await ctx.plugin(AgentLoop, { agents: [] })
    await mountWorkingDirectoryFixture(ctx)
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(SubagentSpawn, { providerName: 'spawn' })
    await ctx.plugin(LlmPiAi, { providers: { messages: {
      api: 'anthropic-messages', baseURL: http.url, apiKeyEnv: 'MESSAGES_TEST_KEY', cacheRetention: 'none', models: [{ id: MODEL }],
    } } })
    const parent = await ctx.agentLoop.create(SessionId('parent'), { provider: 'messages', model: MODEL })
    const ends: SubagentRunEndInfo[] = []
    const settled = Promise.withResolvers<undefined>()
    ctx.on('subagent/end', (info) => {
      ends.push(info)
      settled.resolve(undefined)
    })

    const started = await ctx.subagents.startActivation({
      delivery: 'parent',
      provider: 'spawn',
      label: 'child task',
      parent, prompt: [{ type: 'text', text: 'child task' }],
      signal: new AbortController().signal,
    })
    await settled.promise
    await parent.whenIdle()

    const output = [{ type: 'reasoning', text: 'child reasoning' }, { type: 'text', text: 'child answer' }]
    expect(ends).toHaveLength(1)
    expect(ends[0]?.lastAssistantMessage).toEqual(output)
    const child = await loadStoredSession(ctx.sessionPersistence, started.childId)
    expect(child.events.filter(event => event.type === 'assistant/message').at(-1))
      .toMatchObject({ data: { message: { content: output } } })
    expect(parent.session.snapshotEvents().at(-1))
      .toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
    expect(requests).toHaveLength(2)
    expect(http.paths).toEqual(['/v1/messages?beta=true', '/v1/messages?beta=true'])
    const notice = parent.session.deriveMessages().find(message => message.source.kind === 'subagent-settled')
    const closingContent = [
      { type: 'text', text: 'Background subagent agent-1 finished and will do no further work unless you send it more.' },
      { type: 'text', text: 'Status: completed\nSummary: See closing message below.\nEvidence: Not reported.\n'
        + 'Blockers: Not reported.\nChanged files: Not reported.' },
      { type: 'text', text: 'Its closing message:' },
      { type: 'text', text: 'child answer' },
    ]
    expect(notice?.content).toEqual(closingContent)
    expect(notice?.source).toMatchObject({
      stopReason: 'completed', senderSessionId: started.childId,
    })
    const noticeWithContext = [
      {
        role: 'user',
        content: 'Current runtime context. This snapshot supersedes earlier runtime-context snapshots.\n\n'
          + `Current working directory: ${JSON.stringify(process.cwd())}.`,
      },
      { role: 'user', content: closingContent.map(block => block.text).join('') },
    ]
    expect(requests[1]).toEqual(expect.objectContaining({ messages: noticeWithContext }))

    parent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'continue' }] }))
    await parent.whenIdle()
    expect(parent.session.snapshotEvents().filter(event => event.type === 'turn/end'))
      .toMatchObject([{ data: { reason: { kind: 'completed' } } }, { data: { reason: { kind: 'completed' } } }])
    expect(requests).toHaveLength(3)
    expect(requests[2]).toMatchObject({ messages: [
      ...noticeWithContext,
      { role: 'assistant', content: [{ type: 'text', text: 'parent answer' }] },
      { role: 'user', content: 'continue' },
    ] })
  } finally {
    try {
      await ctx.fiber.dispose()
    } finally {
      rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    }
  }
})
