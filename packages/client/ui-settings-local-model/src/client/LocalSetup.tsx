/** First-run option: offer the local model, then own the step body while it downloads and starts. */
import { useEffect, useRef, type ReactNode } from 'react'
import { Button, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings-models/client'
import type { LocalModelInjected } from './actions.ts'
import type { NS } from './locales.ts'
import { downloadSize, Failure, Progress, Status } from './parts.tsx'
import css from './LocalModel.module.css'

/** Onboarding-slot props plus the plugin's injected state and actions. */
export type LocalSetupProps = PropsRuntime<'settings.models.local-setup'> & PropsLocale<typeof NS> & InjectFace<LocalModelInjected>

/** @returns the collapsed offer or the expanded setup body. */
export function LocalSetup({ expanded, expand, collapse, complete, useLocalModel, actions, t }: LocalSetupProps): ReactNode {
  const state = useLocalModel(snapshot => snapshot.state)
  const phase = state?.phase
  // A reload during a download reopens the step on its progress rather than the offer.
  // Only once per mount: after Cancel or Back the user's choice wins over a lagging phase.
  const autoExpanded = useRef(false)
  useEffect(() => {
    if (autoExpanded.current || expanded || (phase !== 'downloading' && phase !== 'starting')) return
    autoExpanded.current = true
    expand()
  }, [expanded, phase, expand])
  if (state === null) return null

  if (!expanded) {
    return (
      <button type="button" className={`${css.offer} ${css.offerPrimary}`} data-testid="onboarding-choice-local" onClick={() => {
        autoExpanded.current = true
        if (state.phase === 'missing' || state.phase === 'failed') actions.install()
        else if (state.phase === 'installed' || state.phase === 'stopped') actions.start()
        expand()
      }}>
        <span className={css.offerHead}>
          <span className={css.offerTitle}>{t('offerTitle')}</span>
          <Tag tone="info">{t('recommended')}</Tag>
        </span>
        <span className={css.muted}>{t('offerDetail', { name: state.model.name, size: downloadSize(state) })}</span>
      </button>
    )
  }

  const busy = state.phase === 'downloading' || state.phase === 'starting' || state.phase === 'checking'
  return (
    <div data-testid="local-setup">
      <div className={css.header}>
        <p className={css.muted}>{t(state.phase === 'running' ? 'readyDetail' : 'setupDetail', { name: state.model.name })}</p>
        <Status state={state} t={t} />
      </div>
      <Progress state={state} t={t} />
      <Failure state={state} t={t} />
      <p className={css.muted}>{t('moreModels')}</p>
      <div className={css.spread}>
        <div className={css.actions}>
          {!busy && state.phase !== 'running' && <Button variant="ghost" size="sm" onClick={collapse}>{t('back')}</Button>}
          {state.phase === 'downloading' && <Button variant="ghost" size="sm" onClick={() => { actions.cancel(); collapse() }}>{t('cancel')}</Button>}
        </div>
        <div className={css.actions}>
          {state.phase === 'failed' && <Button variant="primary" size="sm" onClick={actions.install}>{t('retry')}</Button>}
          {state.phase === 'missing' && <Button variant="primary" size="sm" onClick={actions.install}>
            {t('download', { size: downloadSize(state) })}
          </Button>}
          {(state.phase === 'installed' || state.phase === 'stopped')
            && <Button variant="primary" size="sm" onClick={actions.start}>{t('start')}</Button>}
          {busy && <Button variant="outline" size="sm" data-testid="local-setup-background" onClick={complete}>{t('continueInBackground')}</Button>}
          {state.phase === 'running' && <Button variant="primary" size="sm" data-testid="local-setup-done" onClick={complete}>{t('done')}</Button>}
        </div>
      </div>
    </div>
  )
}
