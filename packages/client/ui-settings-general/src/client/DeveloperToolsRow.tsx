/** General Settings control for shared developer-tool visibility and previews. */
import { SettingsSwitchRow } from '@janhq/jan-client-ui-primitives'
import type { ObservableSnapshot } from '@janhq/jan-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@janhq/jan-client-ui-slots'

/** Accepted setting and ordered mutation supplied by the settings owner. */
export interface DeveloperToolsRowInjected {
  hooks: { developerTools: ObservableSnapshot<boolean> }
  setEnabled(enabled: boolean): Promise<void>
}

/**
 * Render the developer-tool toggle.
 * @param props - accepted preference, writer and localized copy.
 * @returns the General Settings row.
 */
export function DeveloperToolsRow({ useDeveloperTools, setEnabled, t }:
  PropsRuntime<'settings.general.item'> & PropsLocale<'settings'> & InjectFace<DeveloperToolsRowInjected>) {
  return <SettingsSwitchRow title={t('developerTools.title')} description={t('developerTools.description')}
    error={t('developerTools.error')} searchId="developer-tools" checked={useDeveloperTools(value => value)}
    save={next => setEnabled(next).then(() => true)} />
}
