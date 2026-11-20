/** Browser approval consumer over the existing scoped Remote Event waterfall. */
import type { Context as ClientContext } from '@janhq/cordis'
import type {} from '@janhq/jan-api-remotes/client'
import type {} from '@janhq/jan-api-session-controller/client'
import type { ComposerChainProps } from '@janhq/jan-client-ui-conversation/client'
import type {} from '@janhq/jan-client-ui-renderer/client'
import type { PendingInteractionPublisher } from '@janhq/jan-client-ui-session/client'
import type { TypertClientEventListener } from '@janhq/jan-typert-protocol'
import type {} from '@janhq/jan-client-locale/client'
import type { ShortcutCommandId } from '@janhq/jan-client-shortcuts/client'
import { ApprovalCard } from './ApprovalCard.tsx'
import { ApprovalPanel } from './ApprovalPanel.tsx'
import { PendingApproval } from './contract/slots.ts'
import { en, ja, es, fr, de, ru, pt, zh } from './locales.ts'

export type {
  ApprovalCardInput,
  ApprovalComposerProps,
  ApprovalDecision,
  ApprovalDetailOwnerProps,
  ApprovalPresentationRequest,
  PendingApproval,
} from './contract/slots.ts'
export type { ApprovalKey } from './locales.ts'

/** Required services: Agent scopes, Remote Events, Session UI, Slot registry, and copy. */
export const inject = ['sessions', 'remote', 'uiSession', 'slots', 'locale']

const NS = 'approval'
/** The permission preset that grants every command and action without asking. */
const FULL_ACCESS_PRESET = 'danger-full-access'

/**
 * Build the Allow all switch for one Session, when it offers permission presets.
 * @param ctx - Client root context.
 * @param sessionId - Session that owns the pending request.
 * @returns The switch, or undefined when the Session cannot change presets or already has Full access.
 */
function fullAccessSwitch(ctx: ClientContext, sessionId: PendingApproval['sessionId']): (() => Promise<void>) | undefined {
  const session = ctx.sessions.binding(sessionId)?.session
  const selection = session?.projections.faceOf('permissions').getSnapshot() as { currentValue?: unknown } | undefined
  if (session === undefined || selection === undefined || selection.currentValue === FULL_ACCESS_PRESET) return undefined
  return async () => {
    const result = await session.command(`/permission ${FULL_ACCESS_PRESET}`)
    if (!result.ok) throw new Error(`permission switch failed: ${result.error.code}: ${result.error.message}`)
    if (!result.value.matched) throw new Error('the host offers no /permission command')
  }
}

type ApprovalListener = TypertClientEventListener<'approval/request'>
type ClientApprovalRequest = Parameters<ApprovalListener>[0]
type ClientApprovalNext = Parameters<ApprovalListener>[1]
type ClientApprovalOutcome = Awaited<ReturnType<ApprovalListener>>

/* jscpd:ignore-start -- Approval and Question intentionally mirror one Remote waterfall lifecycle. */
/** Present one request until the user answers or its lifetime ends. */
async function answerApproval(
  ctx: ClientContext,
  owner: ClientContext,
  request: ClientApprovalRequest,
  next: ClientApprovalNext,
  registerPendingInteraction: PendingInteractionPublisher<PendingApproval>,
): Promise<ClientApprovalOutcome> {
  const sessionId = ctx.sessions.scopeOf(owner)
  if (sessionId === undefined) return next()
  const pending = new PendingApproval(sessionId, {
    toolName: request.toolName,
    ...(request.callId === undefined
      ? {}
      : { callId: request.callId }),
    ...(request.reason === undefined ? {} : { reason: request.reason }),
    ...(request.displayReason === undefined ? {} : { displayReason: request.displayReason }),
    ...(request.signal === undefined ? {} : { signal: request.signal }),
  })
  const completed = Promise.withResolvers<void>()
  const remove = registerPendingInteraction(pending, async () => {
    pending.delegate()
    await completed.promise
  })
  try {
    try {
      return await pending.result
    } catch (error) {
      if (pending.isDelegation(error)) return await next()
      throw error
    }
  } finally {
    remove()
    completed.resolve()
  }
}
/* jscpd:ignore-end */

/**
 * Install approval copy and the scoped waterfall consumer.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ja, es, fr, de, ru, pt }), 'ui-approval: dictionaries')
  ctx.inject(['shortcuts'], (scope) => {
    const t = ctx.locale.bind(NS)
    scope.effect(() => scope.shortcuts.registerFixed({
      id: 'approval.allow' as ShortcutCommandId, label: () => t('allow'), keys: ['Enter'], bindings: [{ code: 'Enter', modifiers: [] }], group: 'approval',
    }), 'ui-approval: fixed allow reference')
    scope.effect(() => scope.shortcuts.registerFixed({
      id: 'approval.reject' as ShortcutCommandId, label: () => t('reject'), keys: ['Esc'], bindings: [{ code: 'Escape', modifiers: [] }], group: 'approval',
    }), 'ui-approval: fixed reject reference')
  })
  const registerPendingInteraction = ctx.uiSession.registerPendingInteraction<PendingApproval>(
    () => 0,
  )
  ctx.slots.registerFactory({
    name: 'conversation.approval.card', scope: 'session-maybe', locale: NS,
    children: { 'conversation.approval.detail': { kind: 'single', scope: 'session' } },
  }, ApprovalCard)
  ctx.slots.inject('conversation.composer', () => ctx.slots.register({
    name: 'conversation.composer',
    priority: 1,
    select: ({ pendingInteraction }: ComposerChainProps): PendingApproval | null =>
      pendingInteraction instanceof PendingApproval ? pendingInteraction : null,
    locale: NS,
    inject: () => ({
      resolveReason: (reason: NonNullable<PendingApproval['displayReason']>) => ctx.locale.resolveText(reason),
      allowAll: (sessionId: PendingApproval['sessionId']) => fullAccessSwitch(ctx, sessionId),
    }),
  }, ApprovalPanel))
  ctx.remote.$on('approval/request', function (request, next) {
    return answerApproval(ctx, this, request, next, registerPendingInteraction)
  })
}
