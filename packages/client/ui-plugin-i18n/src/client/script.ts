/** Unicode-script heuristic that tells text written for another language from text that suits the UI locale. */

/** A non-Latin script the heuristic tracks. */
export type Script = 'han' | 'kana' | 'hangul' | 'cyrillic' | 'arabic' | 'hebrew' | 'thai' | 'devanagari' | 'greek'

const SCRIPT_PATTERNS: readonly (readonly [Script, RegExp])[] = [
  ['han', /\p{Script=Han}/u],
  ['kana', /[\p{Script=Hiragana}\p{Script=Katakana}]/u],
  ['hangul', /\p{Script=Hangul}/u],
  ['cyrillic', /\p{Script=Cyrillic}/u],
  ['arabic', /\p{Script=Arabic}/u],
  ['hebrew', /\p{Script=Hebrew}/u],
  ['thai', /\p{Script=Thai}/u],
  ['devanagari', /\p{Script=Devanagari}/u],
  ['greek', /\p{Script=Greek}/u],
]

/** Non-Latin scripts a language's own text uses, by primary language subtag. Latin suits every locale. */
const LOCALE_SCRIPTS: Readonly<Record<string, readonly Script[]>> = {
  ja: ['han', 'kana'],
  zh: ['han'],
  ko: ['hangul', 'han'],
  ru: ['cyrillic'],
  uk: ['cyrillic'],
  bg: ['cyrillic'],
  sr: ['cyrillic'],
  ar: ['arabic'],
  he: ['hebrew'],
  th: ['thai'],
  hi: ['devanagari'],
  el: ['greek'],
}

/**
 * Find the non-Latin scripts in a text.
 * @param text - any text.
 * @returns the tracked scripts that occur at least once.
 */
export function scriptsOf(text: string): ReadonlySet<Script> {
  return new Set(SCRIPT_PATTERNS.flatMap(([script, pattern]) => pattern.test(text) ? [script] : []))
}

/**
 * Read the non-Latin scripts a locale's own text uses.
 * @param locale - a locale tag.
 * @returns the scripts, empty for locales written in Latin.
 */
export function localeScripts(locale: string): readonly Script[] {
  return LOCALE_SCRIPTS[locale.toLowerCase().split('-')[0] ?? ''] ?? []
}

/**
 * Decide whether a text is written in a script the UI locale does not use. Latin letters suit every locale, so
 * only a non-Latin script the locale lacks counts: Han, Kana, or Cyrillic text in an English UI.
 * @param text - a title or other plugin text.
 * @param locale - the active UI locale tag.
 * @returns whether the text contains a script foreign to the locale.
 */
export function mismatchesLocale(text: string, locale: string): boolean {
  const allowed = localeScripts(locale)
  for (const script of scriptsOf(text)) if (!allowed.includes(script)) return true
  return false
}
