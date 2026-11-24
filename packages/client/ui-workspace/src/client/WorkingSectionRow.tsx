/** Settings > General switch that shows or hides the sidebar's Working section. */
import { SettingsSwitchRow } from '@janhq/jan-client-ui-primitives'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@janhq/jan-client-ui-slots'

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
  return <SettingsSwitchRow title={t('settings.workingSection.title')} description={t('settings.workingSection.description')}
    error={t('settings.workingSection.error')} searchId="working-section" checked={useWorkingSection(value => value)}
    save={next => setShown(next)} />
}
