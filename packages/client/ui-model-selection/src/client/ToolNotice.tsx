/**
 * Composer dock entry shown while the selected model declares it cannot use
 * tools. It appears as soon as such a model is selected, offers a one-click
 * switch to the nearest model that can, and can be dismissed for this chat
 * and model; selecting another model clears it.
 */
import { useState, useSyncExternalStore } from 'react'
import { Button, IconCloseOutlineRegular, IconInfoOutlineRegular } from '@janhq/jan-client-ui-primitives'
import type { ObservableSnapshot } from '@janhq/jan-client-store'
import type { ModelSelection } from '@janhq/jan-api-remotes/client'
import type { PropsLocale, PropsRuntime } from '@janhq/jan-client-ui-slots'
import type { ModelDirectoryState } from './directory.ts'
import { toolRefusalOf } from './tool-check.ts'
import css from './ToolNotice.module.css'

/** What one session's notice reads and does. */
export interface ToolNoticeInjected {
  /** The session's model directory store. */
  directory: ObservableSnapshot<ModelDirectoryState>
  /** Switch the session's model; resolves false when the switch failed. */
  select: (selection: ModelSelection) => Promise<boolean>
  /** Whether the notice was dismissed for this session and the given `provider/model`. */
  dismissed: (model: string) => boolean
  /** Dismiss the notice for this session and the given `provider/model`. */
  dismiss: (model: string) => void
}

/** Full props of the dock entry. */
export type ToolNoticeProps = ToolNoticeInjected & PropsRuntime<'conversation.input.dock'> & PropsLocale<'model'>

/** Renders the refusal while it applies and is not dismissed, nothing otherwise. */
export function ToolNotice({ directory, select, dismissed, dismiss, t }: ToolNoticeProps) {
  const state = useSyncExternalStore(fn => directory.subscribe(fn), () => directory.getSnapshot())
  const [switching, setSwitching] = useState(false)
  // Re-render after a dismissal; the dismissal itself lives with the session so a remount keeps it.
  const [, setDismissals] = useState(0)
  const refusal = toolRefusalOf(state)
  const key = state.current === null ? '' : `${state.current.provider}/${state.current.model}`
  if (refusal === undefined || dismissed(key)) return null
  const alternative = refusal.alternative
  return (
    <div className={css.frame}>
      <div className={css.notice} role="status" data-model-tool-notice="">
        <IconInfoOutlineRegular size={16} className={css.icon} aria-hidden />
        <div className={css.text}>
          <p className={css.title}>{t('tools.unusable', { model: refusal.model })}</p>
          <p className={css.hint}>{t(alternative === undefined ? 'tools.hintNone' : 'tools.hint')}</p>
        </div>
        {alternative !== undefined && (
          <Button size="sm" className={css.action} disabled={switching}
            onClick={() => {
              setSwitching(true)
              void select(alternative.selection).finally(() => { setSwitching(false) })
            }}>
            {t('tools.useModel', { model: alternative.name })}
          </Button>
        )}
        <Button size="sm" className={css.close} aria-label={t('tools.dismiss')}
          onClick={() => {
            dismiss(key)
            setDismissals(count => count + 1)
          }}>
          <IconCloseOutlineRegular size={14} />
        </Button>
      </div>
    </div>
  )
}
