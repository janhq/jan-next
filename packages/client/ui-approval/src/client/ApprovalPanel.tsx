/** Composer adapter for one pending tool-approval waterfall. */
import type { ApprovalComposerProps } from './contract/slots.ts'

/**
 * Render the shared card using the tool approval's one-shot decision policy.
 * Allow all grants this request and switches its Session to Full access, so
 * later calls in the same chat run without asking.
 * @param props Selector-matched request and standard Slot props.
 * @returns The approval composer takeover.
 */
export function ApprovalPanel(props: ApprovalComposerProps) {
  const approval = props.matched
  const reason = approval.displayReason === undefined ? approval.reason : props.resolveReason(approval.displayReason)
  const allowAll = props.allowAll(approval.sessionId)
  return props.renderFactorySlot('conversation.approval.card', {
    requestKey: approval.key,
    title: reason ?? props.t('escalation', { toolName: approval.toolName }),
    ...(approval.callId === undefined ? {} : { callId: approval.callId }),
    canAnswer: () => approval.answerable,
    onAllow: () => approval.answer('allowed-once'),
    onReject: () => approval.answer('rejected'),
    ...(allowAll === undefined
      ? {}
      : {
        alwaysLabel: props.t('allowAll'),
        alwaysHint: props.t('allowAllHint'),
        onAlways: async () => {
          await allowAll()
          await approval.answer('allowed-once')
        },
      }),
  })
}
