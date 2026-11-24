/** Settings > General switch that shows or hides the sidebar's Working section. */
import { useState } from 'react'
import { Switch } from '@janhq/jan-client-ui-primitives'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@janhq/jan-client-ui-slots'
import css from './WorkingSectionRow.module.css'

/** Accepted switch value and its Host write. */
export interface WorkingSectionRowInjected {
  readonly hooks: { readonly workingSection: HostObservable<boolean> }
  /**
   * Write the Host setting.
   * @param shown - whether running chats repeat at the top of the sidebar.
   * @returns whether the Host accepted it.
   */
  setShown(shown: boolean): Promise<boolean>
}

/**
 * Render the switch row.
 * @param props - accepted value, writer and copy.
 * @returns the General Settings row.
 */
export function WorkingSectionRow({ useWorkingSection, setShown, t }:
  PropsRuntime<'settings.general.item'> & PropsLocale<'workspace'> & InjectFace<WorkingSectionRowInjected>) {
  const shown = useWorkingSection(value => value)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  return <div className={css.row} role="group" aria-label={t('settings.workingSection.title')}
    data-settings-search-row="working-section" tabIndex={-1}>
    <div>
      <div className={css.title}>{t('settings.workingSection.title')}</div>
      <div className={css.description}>{t('settings.workingSection.description')}</div>
      {failed && <div role="alert">{t('settings.workingSection.error')}</div>}
    </div>
    <Switch checked={shown} disabled={busy} label={t('settings.workingSection.title')}
      onChange={(next) => {
        setFailed(false)
        setBusy(true)
        void setShown(next).then((accepted) => { if (!accepted) setFailed(true) }, () => { setFailed(true) })
          .finally(() => { setBusy(false) })
      }} />
  </div>
}
