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

// openwaifu-server's interaction bridge (extensions/dsh-openwaifu-server).
const AskQuestion = z.object({
  id: z.string(),
  question: z.string(),
  detail: z.string().optional(),
  header: z.string().optional(),
  options: z
    .array(z.object({ label: z.string(), description: z.string().optional() }))
    .optional(),
  multiSelect: z.boolean().optional(),
  intent: z.object({ kind: z.literal('plan-review'), approve: z.string() }).optional(),
})
export const InteractionParams = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('question'),
    requestId: z.string(),
    questions: z.array(AskQuestion),
  }),
  z.object({
    kind: z.literal('approval'),
    requestId: z.string(),
    toolName: z.string(),
    callId: z.string().optional(),
    reason: z.string().optional(),
  }),
])
export const WithdrawnParams = z.object({ requestId: z.string() })
export const PolicyParams = z.object({ policy: z.enum(['ask', 'auto']) })

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
// One hunk with 3 lines of context on both sides; `oldText` is null for a pure insertion.
const FileDiff = z.object({
  path: z.string(),
  oldText: z.string().nullable(),
  newText: z.string(),
})
export type FileDiff = z.infer<typeof FileDiff>
const ToolResult = z.object({
  message: z.object({ content: z.array(ContentBlock) }),
  error: z.unknown().optional(),
  meta: z.looseObject({ diffs: z.array(FileDiff).optional() }).optional(),
})
const TodoStatus = z.enum(['pending', 'in_progress', 'completed'])
export const TodoItem = z.object({ content: z.string(), status: TodoStatus })
export type TodoItem = z.infer<typeof TodoItem>
const TodoWrite = z.object({ todos: z.array(TodoItem) })
const PlanMode = z.object({ active: z.boolean() })

/**
 * A DSH tool's result as the UI keeps it: the text the model saw, plus the
 * per-hunk diffs a write or edit made. Stored verbatim on the tool part, so
 * the Changes panel rebuilds from a reloaded thread too.
 */
export type DshToolOutput = { content: string; diffs?: FileDiff[] }
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
  /** `length` when the turn hit the output cap, so the page offers Continue. */
  finishReason: 'stop' | 'length' | 'error' = 'stop'

  constructor(
    private readonly messageId: string,
    private readonly emit: (chunk: UIMessageChunk) => void,
    /** DSH changed plan mode (the user approved a plan, or /plan ran). */
    private readonly onPlanMode?: (active: boolean) => void
  ) { }

  private begin() {
    if (this.started) return
    this.emit({ type: 'start', messageId: this.messageId })
    this.started = true
  }

  /** Emits a stopped reply's partial first, so the continued one keeps it. */
  prefill(partial: { text?: string; reasoning?: string }) {
    this.begin()
    this.emit({ type: 'start-step' })
    if (partial.reasoning) {
      this.emit({ type: 'reasoning-start', id: 'prefill-r' })
      this.emit({ type: 'reasoning-delta', id: 'prefill-r', delta: partial.reasoning })
      this.emit({ type: 'reasoning-end', id: 'prefill-r' })
    }
    if (partial.text) {
      this.emit({ type: 'text-start', id: 'prefill-t' })
      this.emit({ type: 'text-delta', id: 'prefill-t', delta: partial.text })
      this.emit({ type: 'text-end', id: 'prefill-t' })
    }
    this.emit({ type: 'finish-step' })
  }

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
        this.begin()
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
              output: (result.data.meta?.diffs?.length
                ? { content: text, diffs: result.data.meta.diffs }
                : { content: text }) satisfies DshToolOutput,
              providerExecuted: true,
            }
        )
        return
      }
      // Session state the work panel follows. Data parts persist with the
      // message, so the last one in a thread is its current state.
      case 'todo/write': {
        const todo = TodoWrite.safeParse(data)
        if (!todo.success) return
        this.begin()
        this.emit({ type: 'data-todos', id: 'todos', data: todo.data.todos })
        return
      }
      case 'plan/mode': {
        const plan = PlanMode.safeParse(data)
        if (!plan.success) return
        this.onPlanMode?.(plan.data.active)
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
        if (reason?.kind === 'max-tokens') this.finishReason = 'length'
        if (reason?.kind === 'error') {
          this.finishReason = 'error'
          return reason.error?.message ?? 'DeepSeek Harness turn failed'
        }
        return
      }
    }
  }

  get hasStarted() {
    return this.started
  }
}

