/** Entry point for tool switches on the connected Host. */
import { Button } from '@janhq/jan-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@janhq/jan-client-ui-slots'
import css from './ScopedSettings.module.css'

/**
 * Render the global tool settings entry.
 * @param props - localized copy and dialog opener.
 * @returns the General Settings row.
 */
export function GlobalToolsRow({ open, t }:
  PropsRuntime<'settings.general.item'> & PropsLocale<'scopedSettings'> & InjectFace<{ open: () => void }>) {
  return <div className={css.row} role="group" aria-label={t('global.title')}
    data-settings-search-row="scoped-settings.tools" tabIndex={-1}>
    <div>
      <div className={css.title}>{t('global.title')}</div>
      <p className={css.description}>{t('global.description')}</p>
    </div>
    <Button variant="outline" onClick={open}>{t('global.action')}</Button>
  </div>
}
