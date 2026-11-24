import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@janhq/cordis'
import type { Agent } from '@janhq/jan-agent'
import { createUserMessage, LlmAdapter, LlmError } from '@janhq/jan-llm'
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '@janhq/jan-llm'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@janhq/jan-agent-loop-testkit'
import * as LlmRetry from '@janhq/jan-llm-retry'
import { SessionId } from '@janhq/jan-session'
import TokenMeter from '@janhq/jan-token-meter'
import * as LlmFallback from '../src/index.ts'

function text(reply: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text: reply },
    { type: 'block-end', index: 0, block: { type: 'text', text: reply } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: 1 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

/** One provider route: scripted replies or failures, and a declared context window. */
class Route extends LlmAdapter {
  readonly requests: GenerateOptions[] = []

  constructor(private readonly script: (StreamChunk[] | LlmError)[], private readonly contextWindow = 1_000_000) {
    super()
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model, context: { contextWindow: this.contextWindow } })
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const entry = this.script.shift()
    if (entry === undefined) throw new Error(`script exhausted for ${options.model}`)
    if (entry instanceof LlmError) throw entry
    yield* entry
  }
}

interface Setup {
  ctx: Context
  agent: Agent
}

async function setup(
  routes: Record<string, Route>,
  config: { chain?: LlmFallback.FallbackRoute[]; cooldownSeconds?: number; switchBackBelowPercent?: number },
  options: { retry?: boolean } = {},
): Promise<Setup> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(TokenMeter)
  if (options.retry === true) await ctx.plugin(LlmRetry)
  // Raw values, as a cordis.yml supplies them: the plugin's schema turns them into volatile references.
  await ctx.plugin(LlmFallback, config)
  for (const [provider, route] of Object.entries(routes)) ctx.llm.registerAdapter([provider], route)
  const harness = await mountAgentLoopTestHarness(ctx)
  const agent = await harness.create(SessionId(`fallback-${Math.random()}`), { provider: 'main', model: 'main-model' })
  return { ctx, agent }
}

async function ask(agent: Agent, prompt = 'go'): Promise<void> {
  agent.followup(createUserMessage({ content: [{ type: 'text', text: prompt }], source: { kind: 'user' } }))
  await agent.whenIdle()
}

function turnEnds(agent: Agent): string[] {
  return agent.session.snapshotEvents().flatMap(event => event.type === 'turn/end' ? [event.data.reason.kind] : [])
}

const chain = [{ provider: 'backup', model: 'backup-model' }, { provider: 'third', model: 'third-model' }]

describe('llm-fallback', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(0)
  })
  afterEach(() => { vi.useRealTimers() })

  it('continues a rate-limited reply on the next chain model in the same turn, before same-route retries', async () => {
    const main = new Route([new LlmError('slow down', 'RATE_LIMIT')])
    const backup = new Route([text('from backup')])
    const { agent } = await setup({ main, backup }, { chain }, { retry: true })

    await ask(agent)

    expect(main.requests).toHaveLength(1)
    expect(backup.requests.map(request => request.model)).toEqual(['backup-model'])
    expect(turnEnds(agent)).toEqual(['completed'])
    expect(agent.model.current()).toMatchObject({ provider: 'backup', model: 'backup-model' })
  })

  it('switches on a refusal and walks past a chain model that also fails', async () => {
    const main = new Route([new LlmError('refused to answer', 'REFUSAL')])
    const backup = new Route([new LlmError('quota gone', 'QUOTA')])
    const third = new Route([text('from third')])
    const { agent } = await setup({ main, backup, third }, { chain })

    await ask(agent)

    expect([main.requests.length, backup.requests.length, third.requests.length]).toEqual([1, 1, 1])
    expect(turnEnds(agent)).toEqual(['completed'])
  })

  it('lets same-route recovery handle a transient failure first and switches once it gives up', async () => {
    const main = new Route([new LlmError('upstream 503', 'SERVER'), new LlmError('upstream 503', 'SERVER')])
    const backup = new Route([text('from backup')])
    const { ctx, agent } = await setup({ main, backup }, { chain })
    let sameRouteRetries = 0
    ctx.on('agent/request-error', async (_payload, next) => sameRouteRetries++ === 0 ? { kind: 'retry' } : next())

    await ask(agent)

    expect(main.requests).toHaveLength(2)
    expect(backup.requests).toHaveLength(1)
    expect(turnEnds(agent)).toEqual(['completed'])
  })

  it('never switches on a context overflow', async () => {
    const main = new Route([new LlmError('prompt is too long', 'CONTEXT_WINDOW_EXCEEDED')])
    const backup = new Route([text('unused')])
    const { agent } = await setup({ main, backup }, { chain })

    await ask(agent)

    expect(backup.requests).toHaveLength(0)
    expect(turnEnds(agent)).toEqual(['error'])
  })

  it('does nothing while the chain is empty', async () => {
    const main = new Route([new LlmError('slow down', 'RATE_LIMIT')])
    const backup = new Route([text('unused')])
    const { agent } = await setup({ main, backup }, {})

    await ask(agent)

    expect(backup.requests).toHaveLength(0)
    expect(turnEnds(agent)).toEqual(['error'])
  })

  it('returns to the chosen model at a turn start once its cooldown passed and the context is small', async () => {
    const main = new Route([new LlmError('slow down', 'RATE_LIMIT'), text('main again')])
    const backup = new Route([text('first'), text('second')])
    const { agent } = await setup({ main, backup }, { chain, cooldownSeconds: 60 })

    await ask(agent)
    vi.setSystemTime(30_000)
    await ask(agent)
    expect(backup.requests).toHaveLength(2)

    vi.setSystemTime(61_000)
    await ask(agent)
    expect(main.requests).toHaveLength(2)
    expect(agent.model.current()).toMatchObject({ provider: 'main', model: 'main-model' })
  })

  it('stays on the fallback while switching back would drop too much prompt cache', async () => {
    const main = new Route([new LlmError('slow down', 'RATE_LIMIT')])
    const backup = new Route([text('first'), text('second')])
    const { agent } = await setup({ main, backup }, { chain, cooldownSeconds: 60, switchBackBelowPercent: 0 })

    await ask(agent)
    vi.setSystemTime(61_000)
    await ask(agent)

    expect(main.requests).toHaveLength(1)
    expect(backup.requests).toHaveLength(2)
  })

  it('treats a model the user picks during fallback as the new choice', async () => {
    const main = new Route([new LlmError('slow down', 'RATE_LIMIT')])
    const backup = new Route([text('first')])
    const third = new Route([text('picked'), text('still picked')])
    const { agent } = await setup({ main, backup, third }, { chain, cooldownSeconds: 60 })

    await ask(agent)
    agent.model.select({ provider: 'third', model: 'third-model' })
    await ask(agent)
    vi.setSystemTime(61_000)
    await ask(agent)

    expect(main.requests).toHaveLength(1)
    expect(third.requests).toHaveLength(2)
  })
})
