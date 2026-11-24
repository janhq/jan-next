/** Host registration for the browser theme preference and pre-plugin palette. */
import type {} from '@janhq/jan-settings'

import type { Volatile } from '@janhq/cordis'
import type { ThemePreference } from './theme-settings.ts'
import z from '@janhq/schemastery'

import type { Context } from '@janhq/cordis'
import type {} from '@janhq/jan-host-webserver'
import { bootThemeInjections } from './boot-theme.ts'
import { CODE_THEMES, DEFAULT_CODE_THEME, DEFAULT_PREFERENCE, FONT_SIZE_SPECS, fontSizeSchema, THEME_PREFERENCES, type CodeTheme } from './theme-settings.ts'

export {
  CODE_THEME_FIELD, CODE_THEMES, DEFAULT_CODE_THEME, type CodeTheme,
  DEFAULT_FONT_SIZE, DEFAULT_PREFERENCE, FONT_SIZE_FIELD, FONT_SIZE_MAX, FONT_SIZE_MIN,
  THEME_PREFERENCE_FIELD, THEME_PREFERENCES, THEME_SETTINGS_NAMESPACE,
  type ThemePreference, type ThemeSettings,
} from './theme-settings.ts'

/** Runtime preferences projected to the browser. */
export interface Config {
  /** Browser palette preference. */
  preference: Volatile<ThemePreference>
  /** Syntax theme for code blocks and diffs. */
  codeTheme: Volatile<CodeTheme>
  /** Browser font size in pixels. */
  fontSize: Volatile<number>
  /** Code-block font size in pixels. */
  codeFontSize: Volatile<number>
  /** Sidebar terminal font size in pixels. */
  terminalFontSize: Volatile<number>
  /** Interface and body text font list; `''` keeps the built-in stack. */
  textFontFamily: Volatile<string>
  /** Code font list; `''` keeps the built-in stack. */
  codeFontFamily: Volatile<string>
  /** Sidebar terminal font list; `''` keeps the built-in stack. */
  terminalFontFamily: Volatile<string>
}

/** Live theme and typography preferences. */
export const Config = z.object({
  preference: z.union([...THEME_PREFERENCES]).default(DEFAULT_PREFERENCE).volatile(),
  codeTheme: z.union([...CODE_THEMES]).default(DEFAULT_CODE_THEME).volatile(),
  fontSize: fontSizeSchema(FONT_SIZE_SPECS.text).volatile(),
  codeFontSize: fontSizeSchema(FONT_SIZE_SPECS.code).volatile(),
  terminalFontSize: fontSizeSchema(FONT_SIZE_SPECS.terminal).volatile(),
  textFontFamily: z.string().default('').volatile(),
  codeFontFamily: z.string().default('').volatile(),
  terminalFontFamily: z.string().default('').volatile(),
})

/** Supply the current palette before browser plugins start.
 * @param ctx Host plugin context.
 * @param config Validated live theme preferences.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.inject(['settings'], (child) => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)) })
  ctx.on('webserver/index-inject', (table) => {
    table.push(...bootThemeInjections(config.preference.get(), {
      text: config.fontSize.get(),
      code: config.codeFontSize.get(),
      terminal: config.terminalFontSize.get(),
    }, {
      text: config.textFontFamily.get(),
      code: config.codeFontFamily.get(),
      terminal: config.terminalFontFamily.get(),
    }, config.codeTheme.get()))
  }, { prepend: true })
}
