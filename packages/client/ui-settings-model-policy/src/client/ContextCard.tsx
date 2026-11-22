/** Automatic context compaction and summary model controls. */
import { useSyncExternalStore } from 'react'
import { Button, SectionHeading, SelectMenu, Switch } from '@janhq/jan-client-ui-primitives'
import type { ConfigForm } from '@janhq/jan-client-ui-settings/client'
import type { PropsLocale, PropsRuntime } from '@janhq/jan-client-ui-slots'
import { NS } from './locales.ts'
import { useCatalog, type CatalogLoader } from './useCatalog.ts'
import { SettingRow } from './SettingRow.tsx'
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
  const thresholdOptions = [...thresholds.includes(thresholdRatio) ? [] : [thresholdRatio], ...thresholds]
    .map(ratio => ({ id: String(ratio), label: `${Math.round(ratio * 100)}%` }))
  // A saved model missing from the catalog stays selectable so the current choice is visible.
  const summaryOptions = [
    { id: '', label: t('sameModel') },
    ...selection !== '' && !selectedInCatalog ? [{ id: selection, label: `${summarizationModel} (${summarizationProvider})` }] : [],
    ...catalog?.groups.flatMap(group => group.models.map(model => ({ id: JSON.stringify([group.id, model.id]), label: `${model.name} (${group.name})` }))) ?? [],
  ]
  return <section className={css.group} aria-label={t('contextTitle')}>
    <SectionHeading as="h3">{t('contextTitle')}</SectionHeading>
    <SettingRow title={t('autoCompact')} description={t('autoCompactHint')}>
      <Switch label={t('autoCompact')} checked={auto} disabled={!snapshot.writable} onChange={(value) => { void form.set('auto', value) }} />
    </SettingRow>
    <SettingRow title={t('threshold')}>
      <SelectMenu label={t('threshold')} disabled={!snapshot.writable || !auto} value={String(thresholdRatio)} options={thresholdOptions}
        onChange={(id) => { void form.set('thresholdRatio', Number(id)) }} />
    </SettingRow>
    <SettingRow title={t('summaryModel')}>
      <SelectMenu label={t('summaryModel')} disabled={!snapshot.writable || catalog === null} value={selection} options={summaryOptions}
        onChange={(id) => {
          const [provider, model] = id === '' ? ['', ''] : JSON.parse(id) as [string, string]
          void form.mutate([
            { op: 'set', path: ['summarizationProvider'], value: provider },
            { op: 'set', path: ['summarizationModel'], value: model },
          ])
        }} />
    </SettingRow>
    {error && <div className={css.error} role="alert">{t('catalogError')} <Button variant="ghost" size="sm" onClick={retry}>{t('retry')}</Button></div>}
    <SettingRow title={t('contextLength')} description={t('contextLengthHint')} />
    {!snapshot.writable && <p className={css.note} role="status">{t('readOnly')}</p>}
  </section>
}
