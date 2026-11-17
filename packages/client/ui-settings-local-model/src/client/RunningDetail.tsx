/** What the local model is doing while a Session's Turn waits on it: loading, then reading the prompt. */
import type { ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@janhq/jan-client-ui-slots'
import type {} from '@janhq/jan-client-ui-chat/client'
import type {} from '@janhq/jan-agent'
import type { LocalModelInjected } from './actions.ts'
import type { NS } from './locales.ts'
import css from './LocalModel.module.css'

export type RunningDetailProps =
  PropsRuntime<'conversation.chat.running-detail'> & PropsLocale<typeof NS> & InjectFace<LocalModelInjected>

/**
 * Tell a waiting user why the first token is slow on a local model: the worker is loading it, or
 * how much of the prompt it has read. Silent on any other route.
 * @param props - Session identity and selection, the mirrored local state, and copy.
 * @returns the detail, or null when the Session's request is not on the local route.
 */
export function RunningDetail({ sessionId, useProjection, useLocalModel, t }: RunningDetailProps): ReactNode {
  const selection = useProjection('modelSelection')
  const route = selection?.next ?? selection?.lastUsed
  const prefill = useLocalModel(({ state }) => state?.prefill?.sessionId === sessionId ? state.prefill : undefined)
  const loading = useLocalModel(({ state }) => {
    if (state === null || route?.provider !== state.provider) return undefined
    const active = state.models.find(model => model.active)
    return state.phase === 'starting' || active?.status === 'loading' ? active?.name ?? state.model.name : undefined
  })
  if (prefill !== undefined) {
    const percent = String(Math.floor(prefill.processed / prefill.total * 100))
    return <span className={css.runningDetail}>{t('runningReading', { percent })}</span>
  }
  if (loading !== undefined) return <span className={css.runningDetail}>{t('runningLoading', { name: loading })}</span>
  return null
}
