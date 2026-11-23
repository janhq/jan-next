/** Browser approval consumer over the existing scoped Remote Event waterfall. */
import type { Context as ClientContext } from '@janhq/cordis'
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
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

function useFullAccessSwitch(ctx: ClientContext, request: PendingApproval): (() => Promise<void>) | undefined {
  const session = ctx.sessions.binding(request.sessionId)?.session
  const permissions = session?.projections.faceOf('permissions')
  const subscribe = useCallback((listener: () => void) => permissions?.subscribe(listener) ?? noUnsubscribe, [permissions])
  const getSnapshot = useCallback(() => permissions?.getSnapshot(), [permissions])
  const selection = useSyncExternalStore(subscribe, getSnapshot) as { currentValue: string } | undefined
  const canSwitch = selection !== undefined && selection.currentValue !== FULL_ACCESS_PRESET
  const [availableFor, setAvailableFor] = useState<PendingApproval>()
  useEffect(() => {
    if (!canSwitch) return
    let current = true
    let revision = 0
    const refresh = (): void => {
      setAvailableFor(undefined)
      const read = ++revision
      void ctx.remote.permissionPresets.catalog().then((result) => {
        if (current && read === revision && result.ok && result.value.options.some(option => option.value === FULL_ACCESS_PRESET)) {
          setAvailableFor(request)
        }
      }, () => undefined)
    }
    const release = ctx.remote.$on('permission-presets/catalog-changed', refresh)
    refresh()
    return () => { current = false; release() }
  }, [ctx, request, permissions, canSwitch])

  if (!canSwitch || availableFor !== request) return undefined
  return async () => {
    const result = await ctx.remote.commands.execute(request.sessionId, `/permission ${FULL_ACCESS_PRESET}`, [])
    if (!result.ok) throw new Error(`permission switch failed: ${result.error.code}: ${result.error.message}`)
    if (result.value === undefined) throw new Error('the host offers no /permission command')
    if (result.value.result.kind !== 'success') throw new Error(result.value.result.text)
  }
}

const noUnsubscribe = (): void => {}

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
      useAllowAll: (request: PendingApproval) => useFullAccessSwitch(ctx, request),
    }),
  }, ApprovalPanel))
  ctx.remote.$on('approval/request', function (request, next) {
    return answerApproval(ctx, this, request, next, registerPendingInteraction)
  })
}
