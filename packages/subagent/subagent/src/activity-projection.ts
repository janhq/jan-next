/** Safe, bounded activity for the roster of session-backed subagents. */
import { z } from 'zod'
import type { ToolCallId } from '@janhq/jan-llm/brand'
import type { ProjectionDefinition } from '@janhq/jan-session-projection'
import type {} from '@janhq/jan-tool-executor-ptc/client'
import type { SessionEvent, TurnEndReason } from '@janhq/jan-session'
import { ROOT_AGENT_NAME } from './names.ts'
import type { SubagentActivityEntry } from './projection-types.ts'

const HISTORY_LIMIT = 6
const OPEN_CALL_LIMIT = 16
const TOOL_NAME = /^[a-zA-Z0-9_.-]{1,64}$/u
const serial = z.number().int().nonnegative()
const timeAndSeq = { at: serial, seq: serial }
const activitySchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...timeAndSeq, kind: z.literal('calling-tool'), tool: z.string().regex(TOOL_NAME).nullable() }),
  z.strictObject({
    ...timeAndSeq, kind: z.enum([
      'preparing', 'requesting-model', 'working', 'waiting-inbox', 'messaging-parent', 'finished', 'failed', 'stopped',
    ]),
  }),
])
const viewSchema = z.strictObject({ current: activitySchema, recent: z.array(activitySchema).min(1).max(HISTORY_LIMIT) })
const stateSchema = z.strictObject({
  parentId: z.string().optional(),
  parentIsRoot: z.boolean(),
  inheritedEventCount: serial,
  active: z.boolean(),
  view: viewSchema.nullable(),
  calls: z.array(z.strictObject({ id: z.string(), stage: activitySchema })).max(OPEN_CALL_LIMIT),
})
type ActivityState = z.infer<typeof stateSchema>

function appendActivity(state: ActivityState, current: SubagentActivityEntry): ActivityState {
  const history = state.view?.recent ?? []
  return { ...state, view: { current, recent: [...history.slice(-(HISTORY_LIMIT - 1)), current] } }
}

function parentRecipient(state: ActivityState, rawArgs: unknown): boolean {
  if (state.parentId === undefined || typeof rawArgs !== 'object' || rawArgs === null || !('agent' in rawArgs)) return false
  return rawArgs.agent === state.parentId || (state.parentIsRoot && rawArgs.agent === ROOT_AGENT_NAME)
}

function nativeRelayArgs(args: string): unknown {
  // Classification must never make roster cost proportional to an unbounded message body.
  if (args.length > 16_384) return undefined
  try {
    return JSON.parse(args)
  } catch (error: unknown) {
    if (error instanceof SyntaxError) return undefined
    throw error
  }
}

function startCall(state: ActivityState, event: SessionEvent<'tool/call' | 'tool/ptc-dispatch-start'>): ActivityState {
  const { name, arguments: args } = event.data
  const id = event.type === 'tool/call' ? event.data.callId : event.data.subCallId
  const position = { at: event.time, seq: event.seq }
  const stage: SubagentActivityEntry = name === 'wait_agent'
    ? { ...position, kind: 'waiting-inbox' }
    : name === 'send_message' && parentRecipient(state, event.type === 'tool/call' ? nativeRelayArgs(event.data.arguments) : args)
      ? { ...position, kind: 'messaging-parent' }
      : { ...position, kind: 'calling-tool', tool: TOOL_NAME.test(name) ? name : null }
  const calls = [...state.calls.slice(-(OPEN_CALL_LIMIT - 1)), { id, stage }]
  return appendActivity({ ...state, calls }, stage)
}

function finishCall(state: ActivityState, id: ToolCallId, event: SessionEvent): ActivityState {
  const index = state.calls.findIndex(call => call.id === id)
  if (index < 0) return state
  const calls = state.calls.filter((_call, i) => i !== index)
  if (index < calls.length) return { ...state, calls }
  const current = calls.at(-1)?.stage
  if (current === undefined) return appendActivity({ ...state, calls }, { kind: 'working', at: event.time, seq: event.seq })
  const view = state.view
  return view === null ? state : { ...state, calls, view: { ...view, current } }
}

function terminalStage(reason: TurnEndReason): 'finished' | 'failed' | 'stopped' {
  switch (reason.kind) {
    case 'completed': return 'finished'
    case 'aborted':
    case 'interrupted': return 'stopped'
    default: return 'failed'
  }
}

/** Fold only own child events and publish the same summary through list and live-control reads. */
export const subagentActivityProjectionDefinition = {
  key: 'subagentActivity',
  stateVersion: 1,
  stateSchema,
  init: (header, inheritedEventCount) => ({
    ...(header.parentSession === undefined ? {} : { parentId: header.parentSession }),
    parentIsRoot: header.delegationDepth === 1,
    inheritedEventCount,
    active: false,
    calls: [],
    view: null,
  }),
  apply: (state, event) => {
    if (event.seq < state.inheritedEventCount) return state
    switch (event.type) {
      case 'subagent/descriptor':
        return appendActivity({ ...state, calls: [], view: null }, { kind: 'preparing', at: event.time, seq: event.seq })
      case 'turn/start': {
        const started = { ...state, active: true, calls: [] }
        return state.view === null ? started : appendActivity(started, { kind: 'preparing', at: event.time, seq: event.seq })
      }
      case 'turn/end':
        if (!state.active) return state
        return state.view === null ? { ...state, active: false } : appendActivity(
          { ...state, active: false, calls: [] }, { kind: terminalStage(event.data.reason), at: event.time, seq: event.seq },
        )
      default:
        if (!state.active || state.view === null) return state
    }
    switch (event.type) {
      case 'step/start':
        return appendActivity(state, { kind: 'requesting-model', at: event.time, seq: event.seq })
      case 'assistant/message':
      case 'assistant/attempt':
        return state.view.current.kind === 'requesting-model'
          ? appendActivity(state, { kind: 'working', at: event.time, seq: event.seq })
          : state
      case 'step/end':
        return state.calls.length === 0 && state.view.current.kind === 'working'
          ? state
          : appendActivity({ ...state, calls: [] }, { kind: 'working', at: event.time, seq: event.seq })
      case 'tool/call':
      case 'tool/ptc-dispatch-start':
        return startCall(state, event)
      case 'tool/result':
        return finishCall(state, event.data.message.toolCallId, event)
      case 'tool/ptc-dispatch':
        return finishCall(state, event.data.subCallId, event)
      default:
        return state
    }
  },
  wire: { viewSchema: viewSchema.nullable(), view: state => state.view },
} satisfies ProjectionDefinition<'subagentActivity', ActivityState>
