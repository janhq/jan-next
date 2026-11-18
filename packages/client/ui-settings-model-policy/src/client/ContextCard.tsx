/** Automatic context compaction and summary model controls. */
import { useSyncExternalStore } from 'react'
import { Button, Switch } from '@janhq/jan-client-ui-primitives'
import type { ConfigForm } from '@janhq/jan-client-ui-settings/client'
import type { PropsLocale, PropsRuntime } from '@janhq/jan-client-ui-slots'
import { NS } from './locales.ts'
import { useCatalog, type CatalogLoader } from './useCatalog.ts'
import css from './PolicyCard.module.css'

/** Host `compaction-settings` preferences; an unset field keeps the compaction backend's default. */
export interface CompactionSettings {
  auto?: boolean
  thresholdRatio?: number
  summarizationProvider?: string
  summarizationModel?: string
}
export type ContextCardProps = PropsRuntime<'settings.agentLoop.item'> & PropsLocale<typeof NS> & {
  form: ConfigForm<CompactionSettings>
  loadCatalog: CatalogLoader
}
const thresholds = [0.5, 0.7, 0.8, 0.9]
/** compaction-basic's own defaults, shown until the user picks a value. */
const DEFAULT_AUTO = true
const DEFAULT_THRESHOLD_RATIO = 0.8

/** Context controls mount only while the Host serves compaction-settings. */
export function ContextCard({ form, loadCatalog, t }: ContextCardProps) {
  const snapshot = useSyncExternalStore(listener => form.subscribe(listener), () => form.getSnapshot())
  const { catalog, error, retry } = useCatalog(loadCatalog)
  if (snapshot.status !== 'ready' || snapshot.value === undefined) return null
  const auto = snapshot.value.auto ?? DEFAULT_AUTO
  const thresholdRatio = snapshot.value.thresholdRatio ?? DEFAULT_THRESHOLD_RATIO
  const summarizationProvider = snapshot.value.summarizationProvider ?? ''
  const summarizationModel = snapshot.value.summarizationModel ?? ''
  const selection = summarizationProvider === '' && summarizationModel === '' ? '' : JSON.stringify([summarizationProvider, summarizationModel])
  const selectedInCatalog = catalog?.groups.some(group => group.id === summarizationProvider
    && group.models.some(model => model.id === summarizationModel))
  return <section className={css.card} aria-label={t('contextTitle')}>
    <h3 className={css.title}>{t('contextTitle')}</h3>
    <div className={css.switchRow}>
      <span className={css.fieldTitle}>{t('autoCompact')}</span>
      <Switch label={t('autoCompact')} checked={auto} disabled={!snapshot.writable} onChange={(value) => { void form.set('auto', value) }} />
    </div>
    <p className={css.muted}>{t('autoCompactHint')}</p>
    <label className={css.field}>
      <span className={css.fieldTitle}>{t('threshold')}</span>
      <select className={css.select} aria-label={t('threshold')} disabled={!snapshot.writable || !auto} value={thresholdRatio} onChange={(event) => { void form.set('thresholdRatio', Number(event.target.value)) }}>
        {!thresholds.includes(thresholdRatio) && <option value={thresholdRatio}>{Math.round(thresholdRatio * 100)}%</option>}
        {thresholds.map(ratio => <option key={ratio} value={ratio}>{Math.round(ratio * 100)}%</option>)}
      </select>
    </label>
    <label className={css.field}>
      <span className={css.fieldTitle}>{t('summaryModel')}</span>
      <select className={css.select} aria-label={t('summaryModel')} disabled={!snapshot.writable || catalog === null} value={selection} onChange={(event) => {
        const [provider, model] = event.target.value === '' ? ['', ''] : JSON.parse(event.target.value) as [string, string]
        void form.mutate([
          { op: 'set', path: ['summarizationProvider'], value: provider },
          { op: 'set', path: ['summarizationModel'], value: model },
        ])
      }}>
        <option value="">{t('sameModel')}</option>
        {selection !== '' && !selectedInCatalog && <option value={selection}>{summarizationModel} ({summarizationProvider})</option>}
        {catalog?.groups.flatMap(group => group.models.map(model => <option key={`${group.id}\0${model.id}`} value={JSON.stringify([group.id, model.id])}>{model.name} ({group.name})</option>))}
      </select>
    </label>
    {error && <div className={css.error} role="alert">{t('catalogError')} <Button variant="ghost" size="sm" onClick={retry}>{t('retry')}</Button></div>}
    <div className={css.field}><span className={css.fieldTitle}>{t('contextLength')}</span><p className={css.muted}>{t('contextLengthHint')}</p></div>
    {!snapshot.writable && <p className={css.muted} role="status">{t('readOnly')}</p>}
  </section>
}
