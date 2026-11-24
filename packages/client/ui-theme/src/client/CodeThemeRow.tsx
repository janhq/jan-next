/**
 * Syntax theme row rendered inside the font settings group: title + description
 * + one pill per built-in theme. The selection follows the persisted setting,
 * never the click echo.
 */
import { Pill } from '@janhq/jan-client-ui-primitives'
import type { PropsLocale, PropsRuntime, PropsStore } from '@janhq/jan-client-ui-slots'
import { CODE_THEMES, type CodeTheme } from '../theme-settings.ts'
import type {} from '@janhq/jan-client-ui-settings/client'
import type { createFontRowStore } from './settings-store.ts'
import rowCss from './FontSizeRow.module.css'
import css from './CodeThemeRow.module.css'

/** Injected business face: the syntax theme write. */
export interface CodeThemeRowInjected {
  /** Change the syntax theme. */
  setCodeTheme: (theme: CodeTheme) => void
}

/** Full component props: runtime share + store share + locale seat + injected face. */
export type CodeThemeRowComponentProps =
  PropsRuntime<'settings.general.item'> & PropsStore<ReturnType<typeof createFontRowStore>>
  & PropsLocale<'settings.theme'> & CodeThemeRowInjected

/**
 * Render the syntax theme row.
 * @param props - composed slot props.
 * @returns the row element tree.
 */
export function CodeThemeRow({ t, setCodeTheme, useStore }: CodeThemeRowComponentProps) {
  const codeTheme = useStore(s => s.codeTheme)
  const title = t('codeTheme.title')
  return (
    <div className={rowCss.row}>
      <div className={rowCss.rowText}>
        <div className={rowCss.title}>{title}</div>
        <div className={rowCss.desc}>{t('codeTheme.description')}</div>
      </div>
      <div className={css.options} role="group" aria-label={title}>
        {CODE_THEMES.map(theme => (
          <Pill key={theme} active={codeTheme === theme} aria-pressed={codeTheme === theme} onClick={() => { setCodeTheme(theme) }}>
            {t(`codeTheme.${theme}`)}
          </Pill>
        ))}
      </div>
    </div>
  )
}
