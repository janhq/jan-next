/** Ordered fallback routes with immediate config-form writes. */
import { useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import {
  Button, IconChevronDownOutlineRegular, IconChevronUpOutlineRegular, IconPlusOutlineRegular, IconTrashOutlineRegular,
  Menu, Tooltip, type MenuEntry,
} from '@janhq/jan-client-ui-primitives'
import type { ConfigForm } from '@janhq/jan-client-ui-settings/client'
import type { PropsLocale, PropsRuntime } from '@janhq/jan-client-ui-slots'
import { NS } from './locales.ts'
import { useCatalog, type CatalogLoader } from './useCatalog.ts'
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
  return <section className={css.card} aria-label={t('fallbackTitle')}>
    <h3 className={css.title}>{t('fallbackTitle')}</h3>
    <p className={css.muted}>{t('fallbackDescription')}</p>
    {chain.length === 0 ? <p className={css.muted}>{t('fallbackEmpty')}</p> : <ol className={css.list}>
      {chain.map((route, index) => <li key={`${route.provider}\0${route.model}`} className={css.row}>
        <span className={css.number}>{index + 1}.</span>
        <span className={css.name}>{modelName(route)}<span className={css.provider}>{providerName(route)}</span></span>
        {writable && <span className={css.actions}>
          {chain.length > 1 && rowAction(`${t('moveUp')} ${index + 1}`, <IconChevronUpOutlineRegular size={16} />, index === 0, () => { move(index, index - 1) })}
          {chain.length > 1 && rowAction(`${t('moveDown')} ${index + 1}`, <IconChevronDownOutlineRegular size={16} />, index === chain.length - 1, () => { move(index, index + 1) })}
          {rowAction(`${t('remove')} ${index + 1}`, <IconTrashOutlineRegular size={16} />, false, () => { void form.set('chain', chain.filter((_, position) => position !== index)) })}
        </span>}
      </li>)}
    </ol>}
    {writable && catalog !== null && choices.length === 0 && <p className={css.muted}>{t('allModelsAdded')}</p>}
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
    <label className={css.field}>
      <span className={css.fieldTitle}>{t('cooldown')}</span>
      <select className={css.select} aria-label={t('cooldown')} disabled={!writable} value={cooldownSeconds} onChange={(event) => { void form.set('cooldownSeconds', Number(event.target.value)) }}>
        {!cooldownChoices.includes(cooldownSeconds) && <option value={cooldownSeconds}>{cooldownSeconds} {t('seconds')}</option>}
        <option value={60}>{t('minute1')}</option><option value={300}>{t('minute5')}</option><option value={900}>{t('minute15')}</option><option value={3600}>{t('hour1')}</option>
      </select>
    </label>
    <label className={css.field}>
      <span className={css.fieldTitle}>{t('switchBack')}</span>
      <select className={css.select} aria-label={t('switchBack')} disabled={!writable} value={switchBackBelowPercent} onChange={(event) => { void form.set('switchBackBelowPercent', Number(event.target.value)) }}>
        {!switchBackChoices.includes(switchBackBelowPercent) && <option value={switchBackBelowPercent}>{switchBackBelowPercent}%</option>}
        {switchBackChoices.map(percent => <option key={percent} value={percent}>{percent === 100 ? t('always') : `${percent}%`}</option>)}
      </select>
      <span className={css.muted}>{t('switchBackHint')}</span>
    </label>
    {!writable && <p className={css.muted} role="status">{t('readOnly')}</p>}
  </section>
}
