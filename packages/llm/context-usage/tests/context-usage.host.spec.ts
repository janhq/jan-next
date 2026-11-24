import { Context } from '@janhq/cordis'
import AgentLoop from '@janhq/jan-agent-loop'
import { mountAgentLoopTestDependencies } from '@janhq/jan-agent-loop-testkit'
import BasicCompactionEngine from '@janhq/jan-compaction-basic'
import { createUserMessage, LlmAdapter, ToolCallId, type GenerateOptions, type StreamChunk } from '@janhq/jan-llm'
import { SessionId } from '@janhq/jan-session'
import TokenMeter from '@janhq/jan-token-meter'
import { defineContentToolFixture } from '@janhq/jan-tool-testkit'
import { describe, expect, it, onTestFinished } from 'vitest'
import ContextUsageService from '../src/index.ts'
import { attribute, scale } from '../src/breakdown.ts'
import type { ContextUsageCategory } from '../src/types.ts'

const WINDOW = 100_000

class Adapter extends LlmAdapter {
  calls = 0

  override resolveModel(provider: string, model: string) {
    return Promise.resolve({
      provider, id: model, name: model, context: { contextWindow: WINDOW },
      systemPromptUpdate: 'in-history' as const, toolUpdate: 'in-history' as const,
    })
  }

  override async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.calls += 1
    if (this.calls === 1) {
      yield { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'I should read the notes first.' } }
      yield { type: 'block-end', index: 1, block: { type: 'tool-call', id: ToolCallId('call-1'), name: 'read_notes', arguments: '{"path":"notes.md"}' } }
      yield { type: 'usage', usage: { inputTokens: 900, outputTokens: 40 } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'The notes say to ship on Friday.' } }
    yield { type: 'usage', usage: { inputTokens: 1_500, outputTokens: 12 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

async function chat(options: { compaction?: boolean } = {}) {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(TokenMeter)
  if (options.compaction !== false) await ctx.plugin(BasicCompactionEngine, { thresholdRatio: 0.8, headroomTokens: 0, maxTokens: 32 })
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(ContextUsageService)
  ctx.effect(() => ctx.llm.registerAdapter(['fixture'], new Adapter()))
  ctx.effect(() => ctx.systemPrompt.section({ name: 'identity', order: 1, text: 'You are a careful assistant.' }))
  ctx.effect(() => ctx.systemPrompt.section({ name: 'house-rules', order: 2, text: 'Always cite the file you read. '.repeat(20) }))
  ctx.effect(() => ctx.tools.register(defineContentToolFixture({
    name: 'read_notes', description: 'Read a notes file', parameters: {},
    execute: async () => [{ type: 'text', text: 'Ship on Friday. '.repeat(200) }],
  })))
  const agent = await ctx.agentLoop.create(SessionId('context-chat'), { provider: 'fixture', model: 'fixture' })
  return { ctx, agent }
}

function category(categories: readonly ContextUsageCategory[], id: ContextUsageCategory['id']) {
  return categories.find(entry => entry.id === id)
}

describe('context usage', () => {
  it('splits the provider-anchored occupancy across what the chat actually sent', async () => {
    const { ctx, agent } = await chat()
    agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'What do my notes say?' }] }))
    await agent.whenIdle()

    const usage = await ctx.contextUsage.breakdown(agent, AbortSignal.timeout(5_000))

    expect(usage.usedSource).toBe('provider')
    expect(usage.contextWindow).toBe(WINDOW)
    expect(usage.autoCompactTokens).toBe(80_000)
    expect(usage.categories.reduce((sum, entry) => sum + entry.tokens, 0)).toBe(usage.usedTokens)
    expect(usage.categories.map(entry => entry.id)).toEqual(expect.arrayContaining([
      'systemPrompt', 'janTools', 'userMessages', 'assistantMessages', 'assistantThinking', 'toolCalls', 'toolOutput',
    ]))
    expect(category(usage.categories, 'systemPrompt')?.entries.map(entry => entry.label))
      .toEqual(['house-rules', 'harness:identity', 'identity'])
    expect(category(usage.categories, 'toolOutput')?.entries.map(entry => entry.label)).toEqual(['read_notes'])
    // The 3 KB tool result outweighs everything the user and the model wrote.
    const output = category(usage.categories, 'toolOutput')?.tokens ?? 0
    expect(output).toBeGreaterThan((category(usage.categories, 'userMessages')?.tokens ?? 0) * 10)
  })

  it('estimates a blank chat from the prompt and tools it would send, without automatic compaction', async () => {
    const { ctx, agent } = await chat({ compaction: false })

    const usage = await ctx.contextUsage.breakdown(agent, AbortSignal.timeout(5_000))

    expect(usage.usedSource).toBe('estimate')
    expect(usage.autoCompactTokens).toBeUndefined()
    expect(usage.categories.map(entry => entry.id)).toEqual(['systemPrompt', 'janTools'])
    expect(usage.usedTokens).toBeGreaterThan(0)
  })
})

describe('attribution', () => {
  it('names each quoted instruction file and gives route repricing to images', () => {
    const tally = attribute({
      messages: [
        {
          message: {
            id: 'm1', role: 'user', source: { kind: 'agent-instructions', form: 'instructions', changes: [] },
            content: [{ type: 'text', text: `Instructions from: AGENTS.md\n\n${'a'.repeat(400)}\n\nInstructions from: docs/AGENTS.md\n\n${'b'.repeat(40)}` }],
          } as never,
          tokens: 120, heuristicTokens: 120,
        },
        {
          message: {
            id: 'm2', role: 'user', source: { kind: 'user' },
            content: [{ type: 'text', text: 'look' }, { type: 'image', mediaType: 'image/png', ref: 'img-1' }],
          } as never,
          tokens: 1_030, heuristicTokens: 30,
        },
      ],
      tools: [],
      mcpServers: new Map(),
      sections: [],
    })
    const { categories } = scale(tally, undefined)
    const files = category(categories, 'instructionFiles')?.entries ?? []
    expect(files.map(entry => entry.label)).toEqual(['AGENTS.md', 'docs/AGENTS.md'])
    expect(files[0]?.tokens).toBeGreaterThan((files[1]?.tokens ?? 0) * 5)
    const images = category(categories, 'userMessages')?.entries.find(entry => entry.label === 'images')
    expect(images?.tokens).toBeGreaterThanOrEqual(1_000)
  })

  it('keeps integer category totals equal to the anchored figure', () => {
    const tally = attribute({
      messages: [],
      tools: [
        { name: 'read', description: 'Read a file', parameters: {} },
        { name: 'mcp__github__search', description: 'Search GitHub', parameters: {} },
        { name: 'mcp__github__get_pr', description: 'Get a pull request', parameters: {} },
      ],
      mcpServers: new Map([['mcp__github__search', 'github'], ['mcp__github__get_pr', 'github']]),
      sections: [],
    })
    const { categories, usedTokens } = scale(tally, 1_001)
    expect(usedTokens).toBe(1_001)
    expect(categories.reduce((sum, entry) => sum + entry.tokens, 0)).toBe(1_001)
    expect(category(categories, 'mcpTools')?.entries.map(entry => entry.label)).toEqual(['github'])
  })
})
