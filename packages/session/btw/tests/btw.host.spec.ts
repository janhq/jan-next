import { Context } from '@janhq/cordis'
import AgentLoop from '@janhq/jan-agent-loop'
import { mountAgentLoopTestDependencies } from '@janhq/jan-agent-loop-testkit'
import { createUserMessage, LlmAdapter, ReasoningEffortId, ToolCallId, type GenerateOptions, type StreamChunk } from '@janhq/jan-llm'
import { SessionId } from '@janhq/jan-session'
import { defineContentToolFixture } from '@janhq/jan-tool-testkit'
import { expect, it, onTestFinished } from 'vitest'
import BtwRuntime from '../src/index.ts'

class Adapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  readonly mainStarted = Promise.withResolvers<GenerateOptions>()
  readonly finishMain = Promise.withResolvers<undefined>()
  readonly sideWaiting = Promise.withResolvers<AbortSignal>()
  readonly mainStreaming = Promise.withResolvers<undefined>()
  partialMain = false
  toolOnly = false
  holdSide = false

  override resolveModel(provider: string, model: string) {
    const effort = ReasoningEffortId('high')
    return Promise.resolve({
      provider, id: model, name: model,
      reasoning: { efforts: [{ id: effort, name: 'High' }], defaultEffort: effort },
      systemPromptUpdate: 'in-history' as const, toolUpdate: 'in-history' as const,
    })
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    if (options.purpose === undefined) {
      this.mainStarted.resolve(options)
      if (this.partialMain) {
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text: 'in-flight answer' }
        this.mainStreaming.resolve(undefined)
        await this.finishMain.promise
        yield { type: 'block-end', index: 0, block: { type: 'text', text: 'in-flight answer' } }
        yield { type: 'finish', reason: { kind: 'stop' } }
        return
      }
      await this.finishMain.promise
    } else if (this.holdSide && options.signal !== undefined) {
      const signal = options.signal
      this.sideWaiting.resolve(signal)
      const aborted = Promise.withResolvers<undefined>()
      signal.addEventListener('abort', () => { aborted.resolve(undefined) }, { once: true })
      await aborted.promise
      signal.throwIfAborted()
    } else if (this.toolOnly && options.toolChoice === undefined) {
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: ToolCallId('side-call'), name: 'first', arguments: '{}' } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'first ' }
    yield { type: 'text-delta', index: 0, text: 'second' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'first second' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

async function harness() {
  const ctx = new Context()
  const adapter = new Adapter()
  onTestFinished(async () => { adapter.finishMain.resolve(undefined); await ctx.fiber.dispose() })
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(BtwRuntime)
  ctx.effect(() => ctx.llm.registerAdapter(['fixture'], adapter))
  ctx.effect(() => ctx.systemPrompt.section({ name: 'fixture', order: 1, text: 'Test prompt' }))
  const executed: string[] = []
  for (const name of ['first', 'second']) {
    ctx.effect(() => ctx.tools.register(defineContentToolFixture({ name, description: name, parameters: {}, execute: async () => {
      executed.push(name)
      return [{ type: 'text', text: 'tool result' }]
    } })))
  }
  const agent = await ctx.agentLoop.create(SessionId('btw-chat'), { provider: 'fixture', model: 'fixture' })
  return { ctx, agent, adapter, executed }
}

async function collect(stream: AsyncIterable<string>): Promise<string[]> {
  const answer: string[] = []
  for await (const delta of stream) answer.push(delta)
  return answer
}

it('streams a side answer concurrently with an unchanged per-provider main prefix and no session events', async () => {
  const { ctx, agent, adapter, executed } = await harness()
  agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'main task' }] }))
  const main = await adapter.mainStarted.promise
  const before = agent.session.snapshotEvents()
  const controller = new AbortController()
  const chunks = await collect(ctx.btwRuntime.ask(agent, 'side question?', controller.signal))
  const side = adapter.requests[1]
  if (side === undefined) throw new Error('No side request reached the adapter')
  expect(chunks).toEqual(['first ', 'second'])
  expect(agent.session.snapshotEvents()).toBe(before)
  expect(agent.status).toBe('running')
  expect(main.signal?.aborted).toBe(false)
  expect(executed).toEqual([])
  expect(side.sessionId).toBe(main.sessionId)
  expect(side.signal).not.toBe(main.signal)
  expect(JSON.stringify({ tools: side.tools, toolChoice: side.toolChoice, system: side.system, messages: side.messages.slice(0, -1) }))
    .toBe(JSON.stringify({ tools: main.tools, toolChoice: main.toolChoice, system: main.system, messages: main.messages }))
  expect(side.reasoningEffort).toBe(ReasoningEffortId('high'))
  expect(side.reasoningEffort).toBe(main.reasoningEffort)
  expect(side.tools?.map(tool => tool.name)).toEqual(['first', 'second'])
  const question = side.messages.at(-1)
  expect(question?.role).toBe('user')
  expect(JSON.stringify(question?.content)).toContain('side question?')
  adapter.finishMain.resolve(undefined)
  await agent.whenIdle()
  expect(JSON.stringify(agent.session.deriveMessages())).not.toContain('side question?')
})

it('adds streaming main text after the shared prefix without logging it', async () => {
  const { ctx, agent, adapter } = await harness()
  adapter.partialMain = true
  agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'main task' }] }))
  const main = await adapter.mainStarted.promise
  await adapter.mainStreaming.promise
  const before = agent.session.snapshotEvents()
  await collect(ctx.btwRuntime.ask(agent, 'side question?', new AbortController().signal))
  const side = adapter.requests[1]
  if (side === undefined) throw new Error('No side request reached the adapter')
  expect(side.messages.slice(0, -2)).toEqual(main.messages)
  expect(side.messages.at(-2)).toMatchObject({ role: 'assistant', content: [{ type: 'text', text: 'in-flight answer' }] })
  expect(agent.session.snapshotEvents()).toBe(before)
})

it('never executes a requested tool and retries a tool-only answer once with tool use disabled', async () => {
  const { ctx, agent, adapter, executed } = await harness()
  adapter.toolOnly = true
  const before = agent.session.snapshotEvents()
  const chunks = await collect(ctx.btwRuntime.ask(agent, 'side question?', new AbortController().signal))
  expect(chunks.join('')).toBe('first second')
  expect(adapter.requests.map(options => options.toolChoice)).toEqual([undefined, 'none'])
  expect(adapter.requests[0]?.messages).toEqual(adapter.requests[1]?.messages)
  expect(adapter.requests[0]?.tools).toEqual(adapter.requests[1]?.tools)
  expect(executed).toEqual([])
  expect(agent.session.snapshotEvents()).toBe(before)
})

it('cancels only the side provider call', async () => {
  const { ctx, agent, adapter } = await harness()
  agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'main task' }] }))
  const main = await adapter.mainStarted.promise
  const before = agent.session.snapshotEvents()
  adapter.holdSide = true
  const controller = new AbortController()
  const outcome = collect(ctx.btwRuntime.ask(agent, 'side question?', controller.signal)).catch((error: unknown) => error)
  const sideSignal = await adapter.sideWaiting.promise
  controller.abort()
  await expect(outcome).resolves.toBe(controller.signal.reason)
  expect(sideSignal.aborted).toBe(true)
  expect(main.signal?.aborted).toBe(false)
  expect(agent.status).toBe('running')
  expect(agent.session.snapshotEvents()).toBe(before)
})
