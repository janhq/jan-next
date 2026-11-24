/** Settings > General switch that shows or hides pull request status on chat rows. */
import { useState } from 'react'
import { Switch } from '@janhq/jan-client-ui-primitives'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@janhq/jan-client-ui-slots'
import type { NS } from './locales.ts'
import css from './SidebarStatusRow.module.css'

/** Accepted switch value and its Host write. */
export interface SidebarStatusRowInjected {
  readonly hooks: {
    readonly sidebarStatus: HostObservable<boolean>
    /** Whether any chat has a pull request; without one the switch has nothing to govern. */
    readonly relevant: HostObservable<boolean>
  }
  /**
   * Write the Host setting.
   * @param shown - whether rows show their status.
   * @returns whether the Host accepted it.
   */
  setShown(shown: boolean): Promise<boolean>
}

/**
 * Render the switch row while any chat has a pull request.
 * @param props - accepted value, whether it matters, writer and copy.
 * @returns the General Settings row, or nothing before any chat has a pull request.
 */
export function SidebarStatusRow({ useSidebarStatus, useRelevant, setShown, t }:
  PropsRuntime<'settings.general.item'> & PropsLocale<typeof NS> & InjectFace<SidebarStatusRowInjected>) {
  const shown = useSidebarStatus(value => value)
  const relevant = useRelevant(value => value)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  if (!relevant) return null
  return <div className={css.row} role="group" aria-label={t('settings.sidebarStatus.title')}
    data-settings-search-row="forge-sidebar-status" tabIndex={-1}>
    <div>
      <div className={css.title}>{t('settings.sidebarStatus.title')}</div>
      <div className={css.description}>{t('settings.sidebarStatus.description')}</div>
      {failed && <div role="alert">{t('settings.sidebarStatus.error')}</div>}
    </div>
    <Switch checked={shown} disabled={busy} label={t('settings.sidebarStatus.title')}
      onChange={(next) => {
        setFailed(false)
        setBusy(true)
        void setShown(next).then((accepted) => { if (!accepted) setFailed(true) }, () => { setFailed(true) })
          .finally(() => { setBusy(false) })
      }} />
  </div>
}
