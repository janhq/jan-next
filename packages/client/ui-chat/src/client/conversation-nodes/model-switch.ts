import type { Context } from '@janhq/cordis'
import type { ConversationNodeDefinition } from '@janhq/jan-client-ui-conversation/client'
import type { AssistantStreamRecord } from '@janhq/jan-llm/assistant-stream'
import type { ModelSwitchChatData } from '../contract/chat-nodes.ts'
import { chatNode } from './common.ts'
import { displayFailure } from './event-projection.ts'

declare module '../contract/chat-nodes.ts' {
  interface ChatNodeDataMap {
    /** Another model took over mid-Turn after the model in use failed. */
    'model-switch': ModelSwitchChatData
  }
}

/**
 * One request header, failed attempt, or model selection, carrying the model
 * in use at that point so the next record can read it backwards.
 */
interface ModelRouteState {
  readonly model?: string
  /** Set on a failed attempt record. */
  readonly failure?: {
    readonly turn: number
    readonly step: number
    readonly message: string
    readonly code?: string
  }
  /** Set on a selection made in the same Step right after a failed attempt. */
  readonly fallback?: ModelSwitchChatData
}

function attemptFailure(stream: readonly AssistantStreamRecord[]): unknown {
  for (const record of stream) {
    if (record.type === 'chunk' && record.chunk.type === 'finish' && record.chunk.reason.kind === 'error') {
      return record.chunk.reason.failure
    }
  }
  return undefined
}

/**
 * Model-switch Definition. A selection recorded inside the Step whose attempt
 * just failed is a recovery switch (a fallback chain, not the user's menu
 * pick, which lands between Turns), so it gets a visible Turn-level row.
 */
export const modelSwitchDefinition: ConversationNodeDefinition<ModelRouteState> = {
  kind: 'model-route',
  target: 'chat',
  match: (event) => {
    if (event.type === 'request/header' || event.type === 'model/selection') {
      return { id: String(event.seq), role: 'start' }
    }
    if (event.type === 'assistant/attempt' && attemptFailure(event.data.stream) !== undefined) {
      return { id: String(event.seq), role: 'start' }
    }
    return null
  },
  start: (_context, match, reader) => {
    const event = match.event
    const previous = reader.previous<ModelRouteState>('model-route')?.state
    const model = previous?.model
    if (event.type === 'request/header') return { model: event.data.header.config.model }
    if (event.type === 'assistant/attempt') {
      const failure = displayFailure(attemptFailure(event.data.stream))
      return { ...model === undefined ? {} : { model }, failure: { turn: event.data.turn, step: event.data.step, ...failure } }
    }
    if (event.type !== 'model/selection') throw new Error('model-route start requires a header, attempt, or selection')
    const to = event.data.model
    const location = match.location
    const failed = previous?.failure
    if (location.kind !== 'step' || failed === undefined
      || failed.turn !== location.turn.turn || failed.step !== location.step.step) return { model: to }
    const { turn: _turn, step: _step, ...failure } = failed
    return {
      model: to,
      fallback: { seq: event.seq, ...model === undefined || model === to ? {} : { from: model }, to, failure },
    }
  },
  update: context => context.state,
  buildViewNode: (context) => {
    const fallback = context.state?.fallback
    return fallback === undefined ? null : chatNode(context, 'model-switch', fallback.seq, fallback, { groupTree: 'turn' })
  },
}

/**
 * Register the mid-Turn model-switch contribution.
 * @param ctx - owning UI Conversation context.
 */
export function registerModelSwitchConversationNode(ctx: Context): void {
  ctx.uiConversation.events.register(modelSwitchDefinition)
}
