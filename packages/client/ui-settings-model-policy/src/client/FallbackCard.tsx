/** Ordered fallback routes with immediate config-form writes. */
import { useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import {
  Button, IconChevronDownOutlineRegular, IconChevronUpOutlineRegular, IconPlusOutlineRegular, IconTrashOutlineRegular,
  Menu, SectionHeading, SelectMenu, Tooltip, type MenuEntry,
} from '@janhq/jan-client-ui-primitives'
import type { ConfigForm } from '@janhq/jan-client-ui-settings/client'
import type { PropsLocale, PropsRuntime } from '@janhq/jan-client-ui-slots'
import { NS } from './locales.ts'
import { useCatalog, type CatalogLoader } from './useCatalog.ts'
import { SettingRow } from './SettingRow.tsx'
import css from './PolicyCard.module.css'

export interface FallbackRoute { provider: string; model: string }
export interface FallbackSettings {
  chain: FallbackRoute[]
  cooldownSeconds: number
  switchBackBelowPercent: number
}

export type FallbackCardProps = PropsRuntime<'settings.agentLoop.item'> & PropsLocale<typeof NS> & {
  form: ConfigForm<FallbackSettings>
  loadCatalog: CatalogLoader
}

const cooldownChoices = [60, 300, 900, 3600]
const switchBackChoices = [10, 30, 50, 100]

/** A card appears only while the Host serves its namespace. */
export function FallbackCard({ form, loadCatalog, t }: FallbackCardProps) {
  const snapshot = useSyncExternalStore(listener => form.subscribe(listener), () => form.getSnapshot())
  const { catalog, error, retry } = useCatalog(loadCatalog)
  const [adding, setAdding] = useState(false)
  const addButton = useRef<HTMLButtonElement>(null)
  if (snapshot.status !== 'ready' || snapshot.value === undefined) return null
  const { chain, cooldownSeconds, switchBackBelowPercent } = snapshot.value
  const writable = snapshot.writable
  const modelName = (route: FallbackRoute): string => catalog?.groups.find(group => group.id === route.provider)
    ?.models.find(model => model.id === route.model)?.name ?? route.model
  const providerName = (route: FallbackRoute): string => catalog?.groups.find(group => group.id === route.provider)
    ?.name ?? route.provider
  const move = (index: number, target: number): void => {
    const next = [...chain]
    const [entry] = next.splice(index, 1)
    if (entry === undefined) return
    next.splice(target, 0, entry)
    void form.set('chain', next)
  }
  // Models not yet in the chain, grouped under their provider's name.
  const choices: MenuEntry[] = catalog?.groups.flatMap((group) => {
    const models = group.models.filter(model =>
      !chain.some(route => route.provider === group.id && route.model === model.id))
    if (models.length === 0) return []
    return [
      { type: 'label' as const, id: `label\0${group.id}`, text: group.name },
      ...models.map(model => ({ id: JSON.stringify([group.id, model.id]), label: model.name })),
    ]
  }) ?? []
  const rowAction = (label: string, icon: ReactNode, disabled: boolean, onClick: () => void): ReactNode =>
    <Tooltip label={label} side="top" disabled={disabled}>
      <Button variant="ghost" size="sm" className={css.iconAction} disabled={disabled} aria-label={label} icon={icon} onClick={onClick} />
    </Tooltip>
  // The current value stays selectable when it is not one of the presets.
  const cooldownOptions = [
    ...cooldownChoices.includes(cooldownSeconds) ? [] : [{ id: String(cooldownSeconds), label: `${cooldownSeconds} ${t('seconds')}` }],
    { id: '60', label: t('minute1') }, { id: '300', label: t('minute5') }, { id: '900', label: t('minute15') }, { id: '3600', label: t('hour1') },
  ]
  const switchBackOptions = [
    ...switchBackChoices.includes(switchBackBelowPercent) ? [] : [{ id: String(switchBackBelowPercent), label: `${switchBackBelowPercent}%` }],
    ...switchBackChoices.map(percent => ({ id: String(percent), label: percent === 100 ? t('always') : `${percent}%` })),
  ]
  return <section className={css.group} aria-label={t('fallbackTitle')}>
    <SectionHeading as="h3">{t('fallbackTitle')}</SectionHeading>
    <p className={css.intro}>{t('fallbackDescription')}{chain.length === 0 && <> {t('fallbackEmpty')}</>}</p>
    {chain.length > 0 && <ol className={css.list}>
      {chain.map((route, index) => <li key={`${route.provider}\0${route.model}`} className={css.listRow}>
        <span className={css.number}>{index + 1}.</span>
        <span className={css.name}>{modelName(route)}<span className={css.provider}>{providerName(route)}</span></span>
        {writable && <span className={css.actions}>
          {chain.length > 1 && rowAction(`${t('moveUp')} ${index + 1}`, <IconChevronUpOutlineRegular size={16} />, index === 0, () => { move(index, index - 1) })}
          {chain.length > 1 && rowAction(`${t('moveDown')} ${index + 1}`, <IconChevronDownOutlineRegular size={16} />, index === chain.length - 1, () => { move(index, index + 1) })}
          {rowAction(`${t('remove')} ${index + 1}`, <IconTrashOutlineRegular size={16} />, false, () => { void form.set('chain', chain.filter((_, position) => position !== index)) })}
        </span>}
      </li>)}
    </ol>}
    {writable && catalog !== null && choices.length === 0 && <p className={css.note}>{t('allModelsAdded')}</p>}
    {writable && (catalog === null || choices.length > 0) && <Menu
      open={adding}
      onClose={() => { setAdding(false) }}
      items={choices}
      onSelect={(id) => {
        setAdding(false)
        addButton.current?.focus({ preventScroll: true })
        const [provider, model] = JSON.parse(id) as [string, string]
        void form.set('chain', [...chain, { provider, model }])
      }}
      portal
      autoFocus
      anchor={<Button ref={addButton} variant="outline" size="sm" className={css.add}
        icon={<IconPlusOutlineRegular size={16} />} aria-haspopup="menu" aria-expanded={adding}
        disabled={catalog === null} onClick={() => { setAdding(open => !open) }}>
        {t('addFallback')}
      </Button>}
    />}
    {error && <div className={css.error} role="alert">{t('catalogError')} <Button variant="ghost" size="sm" onClick={retry}>{t('retry')}</Button></div>}
    <SettingRow title={t('cooldown')}>
      <SelectMenu label={t('cooldown')} disabled={!writable} value={String(cooldownSeconds)} options={cooldownOptions}
        onChange={(id) => { void form.set('cooldownSeconds', Number(id)) }} />
    </SettingRow>
    <SettingRow title={t('switchBack')} description={t('switchBackHint')}>
      <SelectMenu label={t('switchBack')} disabled={!writable} value={String(switchBackBelowPercent)} options={switchBackOptions}
        onChange={(id) => { void form.set('switchBackBelowPercent', Number(id)) }} />
    </SettingRow>
    {!writable && <p className={css.note} role="status">{t('readOnly')}</p>}
  </section>
}
