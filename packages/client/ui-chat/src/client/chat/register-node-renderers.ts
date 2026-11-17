import type { Context } from '@janhq/cordis'
import type {} from '@janhq/jan-api-llama-cpp-controller/remote'
import type {} from '@janhq/jan-client-ui-conversation/client'
import type { ModelSelectionProjection } from '@janhq/jan-agent/types'
import type { SessionId, SessionSeq } from '@janhq/jan-session/types'
import type { ObservableSnapshot } from '@janhq/jan-client-store'
import type { PerformanceUsageMode } from '../../chat-settings.ts'
import type { ChatPresentationPolicy } from '../presentation-policy.ts'
import { NS } from '../locale.ts'
import { AssistantNodeView, type AssistantNodeInjected } from './AssistantNodeView.tsx'
import { sessionFilePath } from '../file-path.ts'
import { CommandNodeView, ManualCompactionNodeView } from './CommandNodeView.tsx'
import {
  CompactionNodeView, ContextMessageNodeView, ModelSwitchNodeView, RetryNodeView, TurnErrorNodeView,
  TurnMaxTokensNodeView, UnknownNodeView, UserMessageNodeView,
  type ContextRecovery,
} from './MessageItem.tsx'
import { DefaultReasoningBody, ReasoningContent } from './ReasoningContent.tsx'
import { SystemPromptNodeView } from './SystemPromptRow.tsx'
import { TurnProcessNodeView } from './TurnProcessNodeView.tsx'
import { TurnTailNodeView } from './TurnTailNodeView.tsx'
import { TurnTriggerNodeView } from './TurnTriggerNodeView.tsx'

/**
 * Register this package's business renderers behind the keyed Chat Node seat.
 * Renderers whose output depends on the work-details mode receive the policy
 * through their own registration; the seat and the other renderers do not.
 * @param ctx - owning UI Conversation context.
 * @param performanceUsage - live statistics detail preference.
 * @param presentation - live presentation policy.
 */
export function registerChatNodeRenderers(
  ctx: Context,
  performanceUsage: ObservableSnapshot<PerformanceUsageMode>,
  presentation: ObservableSnapshot<ChatPresentationPolicy>,
): void {
  const settingsUnavailable: ObservableSnapshot<boolean> = { getSnapshot: () => false, subscribe: () => () => {} }
  ctx.effect(() => ctx.slots.registerFactory({
    name: 'conversation.chat.reasoning.content',
    scope: 'root',
    locale: NS,
  }, ReasoningContent))
  ctx.slots.inject('conversation.chat.reasoning.body', () => ctx.slots.register({
    name: 'conversation.chat.reasoning.body',
    priority: 100,
  }, DefaultReasoningBody))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node', key: 'user', locale: NS,
    children: { 'conversation.chat.user.before': { kind: 'chain', scope: 'session' } },
  }, UserMessageNodeView))
  // Steering rows share the renderer without owning the message-source seat.
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node', key: 'steering', locale: NS,
    inject: () => ({ renderSlotChain: () => null }),
  }, UserMessageNodeView))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register(
    { name: 'conversation.chat.node', key: 'context', locale: NS }, ContextMessageNodeView))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register(
    { name: 'conversation.chat.node', key: 'turn-trigger', locale: NS }, TurnTriggerNodeView))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register(
    { name: 'conversation.chat.node', key: 'system-prompt', locale: NS }, SystemPromptNodeView))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'assistant-step',
    locale: NS,
    children: {
      'conversation.chat.reasoning.body': { kind: 'single', scope: 'session' },
      'conversation.chat.message.images': { kind: 'single', scope: 'session' },
    },
    inject: (sessionId): AssistantNodeInjected => ({
      hooks: { presentation },
      resolveFilePath: sessionFilePath(ctx, sessionId),
      fileMentions: (owner, getFileTriggerProps) => ctx.get('chatFileMentions')?.forClosing(owner, sessionId, getFileTriggerProps),
    }),
  }, AssistantNodeView))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'command',
    locale: NS,
    children: { 'conversation.chat.commandview': { kind: 'keyed', scope: 'session' } },
  }, CommandNodeView))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register(
    { name: 'conversation.chat.node', key: 'manual-compaction', locale: NS }, ManualCompactionNodeView))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register(
    { name: 'conversation.chat.node', key: 'compaction', locale: NS }, CompactionNodeView))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register(
    { name: 'conversation.chat.node', key: 'model-retry', locale: NS }, RetryNodeView))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register(
    { name: 'conversation.chat.node', key: 'model-switch', locale: NS }, ModelSwitchNodeView))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register(
    { name: 'conversation.chat.node', key: 'turn-error', locale: NS,
      inject: (sessionId: SessionId) => {
        const recovery: ContextRecovery = {
          modelFor: (failureSeq) => {
            const session = ctx.sessions.binding(sessionId)?.session
            if (session?.projections.faceOf('conversationContinuation').getSnapshot() !== failureSeq) return undefined
            const projected = session.projections.faceOf('modelSelection').getSnapshot() as ModelSelectionProjection | undefined
            const selection = projected?.lastUsed ?? projected?.next
            return selection?.provider === 'local' ? selection.model : undefined
          },
          contextFor: async (id) => {
            const remote = ctx.get('remote.llamaCpp')
            if (remote === undefined) return undefined
            const result = await remote.getModelContext(id)
            return result.ok ? result.value : undefined
          },
          increase: async (id) => {
            const remote = ctx.get('remote.llamaCpp')
            if (remote === undefined) return { ok: false, error: 'Local model controls are unavailable.' }
            const result = await remote.increaseModelContext(id)
            return result.ok ? { ok: true, value: result.value } : { ok: false, error: result.error.message }
          },
          retry: (seq) => { ctx.get('conversation')?.input.retry(sessionId, seq as SessionSeq) },
        }
        return {
          hooks: { settingsAvailability: ctx.get('settingsNavigation')?.availability ?? settingsUnavailable },
          openModelsSettings: () => { ctx.get('settingsNavigation')?.open('models') },
          recovery,
        }
      } }, TurnErrorNodeView))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register(
    { name: 'conversation.chat.node', key: 'turn-max-tokens', locale: NS }, TurnMaxTokensNodeView))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register(
    { name: 'conversation.chat.node', key: 'turn-process', locale: NS }, TurnProcessNodeView))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'turn-tail',
    locale: NS,
    inject: () => ({ hooks: { performanceUsage } }),
    children: {
      'conversation.chat.turnTail': { kind: 'list', scope: 'session' },
      'conversation.chat.assistant-actions': { kind: 'list', scope: 'session' },
    },
  }, TurnTailNodeView))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register(
    { name: 'conversation.chat.node', key: 'unknown', locale: NS }, UnknownNodeView))
}
