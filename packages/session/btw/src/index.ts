import type { Context } from '@janhq/cordis'
import { assembleContextFor, type Agent } from '@janhq/jan-agent'
import { createAssistantMessage, createSystemMessage, type GenerateOptions, type Message, type RequestMessage } from '@janhq/jan-llm'
import { joinContextSections, renderContextSections, renderPrompt } from '@janhq/jan-system-prompt'
import type {} from '@janhq/jan-tools'
import { Remote, RemoteError, TypertRemoteService } from '@janhq/jan-typert-protocol'

declare module '@janhq/cordis' {
  interface Context { btwRuntime: BtwRuntime }
}

declare module '@janhq/jan-llm' {
  interface LlmRequestPurposeMap { btw: true }
}

declare module '@janhq/jan-typert-protocol' {
  interface RemoteErrorDetailsMap {
    'btw/no-model': Record<string, never>
    'btw/empty-question': Record<string, never>
    'btw/answer-failed': Record<string, never>
  }
}

/** Drop an incomplete tool batch rather than supplying invented tool results. */
function completeHistory(messages: Message[]): Message[] {
  const assistant = messages.findLastIndex(message => message.role === 'assistant')
  if (assistant === -1) return messages
  const answered = new Set(messages.slice(assistant + 1).flatMap(message => message.role === 'tool' ? [message.toolCallId] : []))
  if (messages[assistant]?.content.some(block => block.type === 'tool-call' && !answered.has(block.id)) === true) {
    messages.length = assistant
  }
  return messages
}

/** A tool-free side exchange sharing the main request's conversation prefix. */
export default class BtwRuntime extends TypertRemoteService {
  static inject = ['llm', 'systemPrompt', 'tools']

  private readonly liveText = new WeakMap<Agent, string>()

  constructor(ctx: Context) {
    super(ctx, 'btwRuntime', { namespace: 'btw' })
    ctx.on('agent/assistant-stream', ({ agent, frame }) => {
      if (frame.type !== 'chunk') {
        this.liveText.delete(agent)
      } else if (frame.chunk.type === 'text-delta' && frame.chunk.text !== '') {
        this.liveText.set(agent, (this.liveText.get(agent) ?? '') + frame.chunk.text)
      }
    }, { global: true })
  }

  /**
   * Stream a side answer without starting or joining the main agent's turn.
   * @param agent - Chat whose model and conversation prefix the answer uses.
   * @param question - Temporary user question appended to the snapshot only.
   * @param signal - Cancellation for this side request only.
   * @returns Answer text deltas, in provider order.
   */
  @Remote({ mode: 'stream' })
  async *ask(agent: Agent, question: string, signal: AbortSignal): AsyncIterable<string> {
    signal.throwIfAborted()
    question = question.trim()
    if (question === '') throw new RemoteError('btw/empty-question', 'A side question is required.', {})
    const selection = agent.model.current()
    if (selection === undefined) throw new RemoteError('btw/no-model', 'The chat has no model selected.', {})
    const { session } = agent
    const header = session.requestHeader()
    const toolHistory = session.toolHistory()
    const messages: RequestMessage[] = completeHistory(session.deriveMessages())
    const config = header?.config
    const sameRoute = config?.provider === selection.provider && config.model === selection.model
    let tools = header?.tools
    const partial = this.liveText.get(agent)
    if (config !== undefined && partial !== undefined) {
      messages.push(createAssistantMessage({
        source: { provider: config.provider, model: config.model },
        content: [{ type: 'text', text: partial }],
      }))
    }
    if (header === undefined) {
      const toolSet = await agent.ctx.tools.resolve({ agent, modelSelection: selection, signal })
      try {
        const assembly = await agent.ctx.systemPrompt.assemble({ ...assembleContextFor(agent, signal), modelSelection: selection, toolSet })
        const prompt = renderPrompt(assembly)
        if (prompt !== '') messages.unshift(createSystemMessage(prompt))
        const context = joinContextSections(renderContextSections(assembly))
        if (context !== '') messages.push({ role: 'user', content: [{ type: 'text', text: context }] })
        tools = assembly.tools
      } finally {
        toolSet.dispose()
      }
    }
    messages.push({ role: 'user', content: [{ type: 'text', text: [
      'This is an ephemeral side question for the current chat. Answer briefly and directly from the conversation context. Do not use tools or ask follow-up questions.',
      '', 'Question:', question,
    ].join('\n') }] })
    const request: GenerateOptions = {
      ...sameRoute ? config : {}, ...selection, messages, toolHistory,
      ...header === undefined && agent.options.maxTokens !== undefined ? { maxTokens: agent.options.maxTokens } : {},
      ...tools === undefined || tools.length === 0 ? {} : { tools },
      sessionId: session.id, purpose: 'btw', ephemeral: true, signal,
    }
    try {
      // Keep the same tool declarations as the main call for cache reuse. A
      // tool-only reply gets one more chance with tool choice disabled.
      for (let attempt = 0; attempt < 2; attempt += 1) {
        signal.throwIfAborted()
        const options: GenerateOptions = attempt === 0 ? request : { ...request, toolChoice: 'none' }
        let toolOnly = false
        const deltas = new Set<number>()
        let answered = false
        for await (const chunk of agent.ctx.llm.stream(options)) {
          signal.throwIfAborted()
          if (chunk.type === 'text-delta' && chunk.text !== '') {
            deltas.add(chunk.index)
            answered ||= chunk.text.trim() !== ''
            yield chunk.text
          } else if (chunk.type === 'block-end' && chunk.block.type === 'text' && !deltas.has(chunk.index)) {
            answered ||= chunk.block.text.trim() !== ''
            yield chunk.block.text
          } else if (chunk.type === 'finish') {
            if (chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted') throw new Error(chunk.reason.failure.message)
            if (answered || chunk.reason.kind !== 'tool-calls') return
            toolOnly = true
          }
        }
        if (!toolOnly) return
      }
    } catch (cause: unknown) {
      signal.throwIfAborted()
      throw new RemoteError('btw/answer-failed', 'The model could not answer the side question.', {}, { cause })
    }
  }
}
