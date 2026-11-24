/** Settings > General switch that shows or hides pull request status on chat rows. */
import { SettingsSwitchRow } from '@janhq/jan-client-ui-primitives'
import type { HostObservable, InjectFace, PropsLocale } from '@janhq/jan-client-ui-slots'
import type {} from '@janhq/jan-client-ui-settings/client'
import type { NS } from './locales.ts'

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
  PropsLocale<typeof NS> & InjectFace<SidebarStatusRowInjected>) {
  const shown = useSidebarStatus(value => value)
  const relevant = useRelevant(value => value)
  if (!relevant) return null
  return <SettingsSwitchRow title={t('settings.sidebarStatus.title')} description={t('settings.sidebarStatus.description')}
    error={t('settings.sidebarStatus.error')} searchId="forge-sidebar-status" checked={shown} save={next => setShown(next)} />
}
