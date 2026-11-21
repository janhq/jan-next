/** Desktop General Settings row that resets chosen Jan data and relaunches. */
import { useState } from 'react'
import { Button, Checkbox, Modal } from '@janhq/jan-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@janhq/jan-client-ui-slots'
import css from './FactoryResetRow.module.css'

/** What a reset can remove, in display order; the desktop owner maps each to its files. */
export const FACTORY_RESET_CATEGORIES = ['chats', 'settings', 'plugins', 'credentials', 'skills', 'logs'] as const
export type FactoryResetCategory = typeof FACTORY_RESET_CATEGORIES[number]

/** Desktop reset bridge supplied by the settings owner. */
export interface FactoryResetRowInjected {
  /** Stop Jan, remove the chosen data and relaunch; settles only when the request was refused. */
  reset: (categories: readonly FactoryResetCategory[]) => Promise<void>
}

/**
 * Render the reset row and its confirmation, where every item starts ticked and can be unticked.
 * @param props - reset bridge and localized copy.
 * @returns the General Settings row.
 */
export function FactoryResetRow({ reset, t }:
  PropsRuntime<'settings.general.item'> & PropsLocale<'settings'> & InjectFace<FactoryResetRowInjected>) {
  const [open, setOpen] = useState(false)
  const [chosen, setChosen] = useState<ReadonlySet<FactoryResetCategory>>(() => new Set(FACTORY_RESET_CATEGORIES))
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const close = () => { if (!busy) setOpen(false) }
  const start = () => {
    setFailed(false)
    setBusy(true)
    // Success quits the app; a settled promise means nothing was removed.
    void reset(FACTORY_RESET_CATEGORIES.filter(category => chosen.has(category)))
      .then(() => { setFailed(true) }, () => { setFailed(true) })
      .finally(() => { setBusy(false) })
  }
  return <div className={css.row}>
    <div>
      <div className={css.title}>{t('factoryReset.title')}</div>
      <div className={css.description}>{t('factoryReset.description')}</div>
    </div>
    <button type="button" className={css.danger} onClick={() => {
      setChosen(new Set(FACTORY_RESET_CATEGORIES))
      setFailed(false)
      setOpen(true)
    }}>{t('factoryReset.open')}</button>
    <Modal open={open} onClose={close} title={t('factoryReset.title')} closeLabel={t('factoryReset.cancel')}
      footer={<>
        <Button variant="ghost" disabled={busy} onClick={close}>{t('factoryReset.cancel')}</Button>
        <button type="button" className={css.confirm} disabled={busy || chosen.size === 0} onClick={start}>
          {busy ? t('factoryReset.working') : t('factoryReset.confirm')}
        </button>
      </>}>
      <div className={css.body}>
        <p role="alert" className={css.warning}>{t('factoryReset.warning')}</p>
        <fieldset className={css.list} disabled={busy}>
          <legend className={css.legend}>{t('factoryReset.legend')}</legend>
          {FACTORY_RESET_CATEGORIES.map(category => <Checkbox key={category} label={t(`factoryReset.item.${category}`)}
            checked={chosen.has(category)} onChange={(next) => {
              setChosen((current) => {
                const updated = new Set(current)
                if (next) updated.add(category)
                else updated.delete(category)
                return updated
              })
            }} />)}
        </fieldset>
        <p className={css.kept}>{t('factoryReset.kept')}</p>
        {failed && <p role="alert" className={css.warning}>{t('factoryReset.error')}</p>}
      </div>
    </Modal>
  </div>
}
