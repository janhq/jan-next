/** Constant-size continuation eligibility over the complete durable Session. */
import type {} from './types.ts'
import type {} from '@janhq/jan-compaction/types'
import type { ProjectionDefinition } from '@janhq/jan-session-projection'
import type { SessionSeq } from '@janhq/jan-session/types'
import { brandNumber } from '@janhq/jan-brand'
import { CONTEXT_WINDOW_EXCEEDED_CODE } from '@janhq/jan-llm'
import { z } from 'zod'

// Explicit manual requests use a fixed product policy, independent of automatic retry configuration.
const CONTINUABLE_FAILURES: ReadonlySet<string> = new Set([
  'RATE_LIMIT', 'SERVER', 'TIMEOUT', 'TRANSPORT', 'EMPTY_RESPONSE', 'STREAM_CLOSED',
])

const sequenceSchema = z.number().int().nonnegative().transform(brandNumber<SessionSeq>)
const endingSchema = z.union([sequenceSchema, z.object({ overflow: sequenceSchema })]).nullable()
const stateSchema = z.object({
  admitted: z.boolean(),
  failedAttempt: z.boolean(),
  ending: endingSchema,
})

/** Recoverable manual-continuation facts over admitted user input and empty retry messages. */
export type ContinuationState = z.infer<typeof stateSchema>

const EMPTY: ContinuationState = { admitted: false, failedAttempt: false, ending: null }

/** Eligibility requires admitted human work and a failed settlement in the last request step. */
export const continuationProjectionDefinition = {
  key: 'conversationContinuation',
  stateVersion: 5,
  stateSchema,
  init: (): ContinuationState => EMPTY,
  apply: (state, event) => {
    switch (event.type) {
      case 'turn/start':
        return EMPTY
      case 'step/start':
      case 'assistant/message':
        return state.failedAttempt ? { ...state, failedAttempt: false } : state
      case 'user/message':
        return !state.admitted && event.surfaceOp === 'append'
          && ((event.data.source.kind === 'user' && event.data.content.length > 0)
            || (event.data.source.kind === 'retry' && event.data.content.length === 0))
          ? { ...state, admitted: true } : state
      case 'assistant/attempt':
        return state.failedAttempt ? state : { ...state, failedAttempt: true }
      case 'turn/end': {
        if (event.data.reason.kind !== 'error' || !state.admitted || !state.failedAttempt) return EMPTY
        const { code } = event.data.reason.error
        if (code === CONTEXT_WINDOW_EXCEEDED_CODE) return { ...EMPTY, ending: { overflow: event.seq } }
        return CONTINUABLE_FAILURES.has(code) ? { ...EMPTY, ending: event.seq } : EMPTY
      }
      case 'compaction/end':
        return state.ending !== null && typeof state.ending === 'object' && event.data.turn === null && event.data.error === undefined
          ? { ...EMPTY, ending: state.ending.overflow } : state
      default:
        return state
    }
  },
  wire: {
    viewSchema: endingSchema,
    view: (state: ContinuationState) => state.ending,
  },
} satisfies ProjectionDefinition<'conversationContinuation', ContinuationState>
