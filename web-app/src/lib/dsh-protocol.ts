/**
 * DeepSeek Harness SDK wire, parsed at the boundary, and the mapping from its
 * session events to AI SDK UI chunks. No app imports, so it runs anywhere.
 */
import type { UIMessageChunk } from 'ai'
import { z } from 'zod'

// DSH frames are IPC from another process, so every shape is parsed once at
// the boundary rather than trusted. Unknown event types and chunk kinds pass
// through untouched: DSH adds them freely and this view ignores them.
const ContentBlockBase = z.looseObject({
  type: z.string(),
  text: z.string().optional(),
  toolCallId: z.string().optional(),
  isError: z.boolean().optional(),
})
type ContentBlock = z.infer<typeof ContentBlockBase> & {
  content?: ContentBlock[]
}
const ContentBlock: z.ZodType<ContentBlock> = z.lazy(() =>
  ContentBlockBase.extend({ content: z.array(ContentBlock).optional() })
)

export const Response = z.object({
  id: z.number(),
  result: z.unknown().optional(),
  error: z.object({ message: z.string().optional() }).optional(),
})
export const Notification = z.object({
  method: z.string(),
  params: z.looseObject({ sessionId: z.string().optional() }),
})
export const StatusParams = z.object({ status: z.string() })
export const EventParams = z.object({
  event: z.object({ type: z.string(), data: z.record(z.string(), z.unknown()) }),
})
export type SessionEvent = z.infer<typeof EventParams>['event']

const Chunk = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text-delta'), index: z.number(), text: z.string() }),
  z.object({ type: z.literal('reasoning-delta'), index: z.number(), text: z.string() }),
  z.object({
    type: z.literal('usage'),
    usage: z.object({
      inputTokens: z.number().optional(),
      outputTokens: z.number().optional(),
    }),
  }),
])
const ToolCall = z.object({ callId: z.string(), name: z.string(), arguments: z.unknown() })
const ToolResult = z.object({
  message: z.object({ content: z.array(ContentBlock) }),
  error: z.unknown().optional(),
})
const TurnEnd = z.object({
  reason: z
    .object({
      kind: z.string(),
      error: z.object({ message: z.string().optional() }).optional(),
    })
    .optional(),
})
const Step = z.object({ step: z.number() })

/** Text of a tool result, which DSH carries as content blocks. */
function resultText(blocks: ContentBlock[] | undefined): string {
  return (blocks ?? [])
    .map((b) => (b.type === 'text' ? (b.text ?? '') : `[${b.type}]`))
    .join('\n')
}

function parseArgs(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

/** Maps one DSH turn's session events onto AI SDK UI message chunks. */
export class DshTurnMapper {
  private textOpen = new Set<number>()
  private reasoningOpen = new Set<number>()
  private step = 0
  private started = false
  /** Output tokens reported so far, for the message metadata. */
  usage = { inputTokens: 0, outputTokens: 0 }

  constructor(private readonly emit: (chunk: UIMessageChunk) => void) {}

  private id(kind: string, index: number) {
    return `${kind}-${this.step}-${index}`
  }

  private closeBlocks() {
    for (const i of this.textOpen) this.emit({ type: 'text-end', id: this.id('t', i) })
    for (const i of this.reasoningOpen)
      this.emit({ type: 'reasoning-end', id: this.id('r', i) })
    this.textOpen.clear()
    this.reasoningOpen.clear()
  }

  /** Returns an error message when the event ends the turn with one. */
  handle(event: SessionEvent): string | undefined {
    const data = event.data
    switch (event.type) {
      case 'step/start': {
        if (!this.started) {
          this.emit({ type: 'start' })
          this.started = true
        }
        const step = Step.safeParse(data)
        this.step = step.success ? step.data.step : this.step + 1
        this.emit({ type: 'start-step' })
        return
      }
      case 'assistant/chunk': {
        const parsed = Chunk.safeParse(data.chunk)
        if (!parsed.success) return
        const chunk = parsed.data
        if (chunk.type === 'text-delta') {
          if (!this.textOpen.has(chunk.index)) {
            this.textOpen.add(chunk.index)
            this.emit({ type: 'text-start', id: this.id('t', chunk.index) })
          }
          this.emit({
            type: 'text-delta',
            id: this.id('t', chunk.index),
            delta: chunk.text,
          })
        } else if (chunk.type === 'reasoning-delta') {
          if (!this.reasoningOpen.has(chunk.index)) {
            this.reasoningOpen.add(chunk.index)
            this.emit({ type: 'reasoning-start', id: this.id('r', chunk.index) })
          }
          this.emit({
            type: 'reasoning-delta',
            id: this.id('r', chunk.index),
            delta: chunk.text,
          })
        } else {
          // Each step reports its own request; the last input is the context
          // size, outputs add up across steps.
          this.usage = {
            inputTokens: chunk.usage.inputTokens ?? this.usage.inputTokens,
            outputTokens: this.usage.outputTokens + (chunk.usage.outputTokens ?? 0),
          }
        }
        return
      }
      // Static (not dynamic) tool parts: the chat view renders `tool-<name>`
      // parts only. providerExecuted keeps the SDK from running them again.
      case 'tool/call': {
        const call = ToolCall.safeParse(data)
        if (!call.success) return
        this.closeBlocks()
        this.emit({
          type: 'tool-input-available',
          toolCallId: call.data.callId,
          toolName: call.data.name,
          input: parseArgs(call.data.arguments),
          providerExecuted: true,
        })
        return
      }
      case 'tool/result': {
        const result = ToolResult.safeParse(data)
        const block = result.success ? result.data.message.content[0] : undefined
        if (!result.success || !block?.toolCallId) return
        const text = resultText(block.content)
        const toolCallId = block.toolCallId
        this.emit(
          result.data.error !== undefined || block.isError
            ? {
                type: 'tool-output-error',
                toolCallId,
                errorText: text || 'Tool failed',
                providerExecuted: true,
              }
            : {
                type: 'tool-output-available',
                toolCallId,
                output: text,
                providerExecuted: true,
              }
        )
        return
      }
      case 'step/end':
        this.closeBlocks()
        this.emit({ type: 'finish-step' })
        return
      case 'turn/end': {
        this.closeBlocks()
        const end = TurnEnd.safeParse(data)
        const reason = end.success ? end.data.reason : undefined
        if (reason?.kind === 'error')
          return reason.error?.message ?? 'DeepSeek Harness turn failed'
        return
      }
    }
  }

  get hasStarted() {
    return this.started
  }
}

