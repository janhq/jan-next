/** Settings → Models card: the local server (start, stop, remove everything) and the model manager. */
import type { ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings-models/client'
import type { LocalModelInjected } from './actions.ts'
import type { NS } from './locales.ts'
import { ModelManager } from './ModelManager.tsx'
import { downloadSize, Failure, Progress, Status } from './parts.tsx'
import css from './LocalModel.module.css'

/** Footer-slot props plus the plugin's injected state and actions. */
export type LocalModelCardProps = PropsRuntime<'settings.models.footer'> & PropsLocale<typeof NS> & InjectFace<LocalModelInjected>

/** @returns the card, or null until the Host state arrives. */
export function LocalModelCard({ useLocalModel, actions, t }: LocalModelCardProps): ReactNode {
  const mirror = useLocalModel(snapshot => snapshot)
  const state = mirror.state
  if (state === null) return null
  const { phase } = state
  const installed = phase === 'installed' || phase === 'stopped' || phase === 'running' || phase === 'starting'
  return (
    <section className={css.card} data-testid="local-model-card" aria-label={t('title')}>
      <div className={css.header}>
        <div>
          <h3 className={css.title}>{state.models.length === 0 ? t('title') : `${t('title')} · ${state.model.name}`}</h3>
          <p className={css.muted}>{t('subtitle')}</p>
        </div>
        <Status state={state} t={t} />
      </div>
      {phase === 'running' && state.contextSize !== undefined
        && <p className={css.muted} data-testid="local-model-context">{t('contextInfo', { tokens: state.contextSize.toLocaleString() })}</p>}
      <Progress state={state} t={t} />
      <Failure state={state} t={t} />
      {!mirror.connected && <p className={css.muted}>{t('connectionLost')}</p>}
      <div className={css.actions}>
        {phase === 'missing' && <Button variant="primary" size="sm" data-testid="local-model-download" onClick={actions.install}>
          {t('download', { size: downloadSize(state) })}
        </Button>}
        {phase === 'downloading' && <Button variant="outline" size="sm" onClick={actions.cancel}>{t('cancel')}</Button>}
        {(phase === 'installed' || phase === 'stopped') && <Button variant="primary" size="sm" data-testid="local-model-start" onClick={actions.start}>{t('start')}</Button>}
        {(phase === 'running' || phase === 'starting')
          && <Button variant="outline" size="sm" data-testid="local-model-stop" onClick={actions.stop}>{t('stop')}</Button>}
        {phase === 'failed' && <Button variant="primary" size="sm" data-testid="local-model-retry" onClick={actions.install}>{t('retry')}</Button>}
        {(installed || phase === 'failed') && phase !== 'starting'
          && <Button variant="ghost" size="sm" data-testid="local-model-remove" onClick={actions.uninstall}>{t('remove')}</Button>}
      </div>
      <ModelManager state={state} actions={actions} t={t} />
    </section>
  )
}
