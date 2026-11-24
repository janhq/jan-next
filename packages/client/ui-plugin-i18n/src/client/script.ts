/** Local language detection for plugin interface text. */
import type { eld as Eld } from 'eld/extrasmall'

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

/** A character outside Latin, its extensions, and the general punctuation and symbol blocks. */
const BEYOND_LATIN = /[^\u0000-\u036f\u2000-\u2bff]/u

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
  // Latin, punctuation, and symbol blocks hold none of the tracked scripts; most text ends here without a script scan.
  if (!BEYOND_LATIN.test(text)) return false
  const allowed = localeScripts(locale)
  for (const script of scriptsOf(text)) if (!allowed.includes(script)) return true
  return false
}

/**
 * Language part shared by regional variants of a BCP-47 tag.
 * @param locale - BCP-47 locale tag.
 * @returns the lowercase primary language subtag.
 */
export function primaryLanguage(locale: string): string {
  return locale.toLowerCase().split('-', 1)[0] ?? ''
}

// Kana and Hangul decide before Han: Japanese and Korean text can contain all three sorts of CJK glyphs.
const SCRIPT_LANGUAGES: readonly (readonly [Script, string])[] = [
  ['kana', 'ja'], ['hangul', 'ko'], ['han', 'zh'], ['cyrillic', 'ru'], ['arabic', 'ar'],
  ['hebrew', 'he'], ['thai', 'th'], ['devanagari', 'hi'], ['greek', 'el'],
]
const FILE_OR_ADDRESS = /(?:^\w+:\/\/|^\S*[\/\\]\S*$|\.[\p{L}\p{N}]{1,10}$)/u
const LATIN_WORD = /\p{Script=Latin}{2,}/gu
const IDENTIFIER = /\S*(?:_|[a-z][A-Z])\S*/g

/** Pending ELD load, a plausible language, or no strong evidence of a mismatch. */
export type LanguageDetection = string | undefined | Promise<void>

let detector: typeof Eld | undefined
let loading: Promise<void> | undefined
let unavailable = false

/**
 * Guess the language of display text that does not match the active locale.
 * @param text - text a plugin displays.
 * @param locale - active locale.
 * @returns the foreign language, undefined without strong evidence, or a pending detector load to retry after.
 */
export function foreignLanguage(text: string, locale: string): LanguageDetection {
  const copy = text.trim()
  if (copy.length < 2 || FILE_OR_ADDRESS.test(copy)) return undefined
  const target = primaryLanguage(locale)
  if (BEYOND_LATIN.test(copy)) {
    const scripts = scriptsOf(copy)
    const script = SCRIPT_LANGUAGES.find(([candidate]) => scripts.has(candidate))
    if (script !== undefined) {
      const [family, fallback] = script
      if (detector !== undefined && (family === 'cyrillic' || family === 'arabic' || family === 'devanagari')) {
        const detected = detector.detect(copy.slice(0, 400))
        if (detected.language && detected.isReliable()) return detected.language === target ? undefined : detected.language
      }
      return localeScripts(locale).includes(family) ? undefined : fallback
    }
  }

  // Do not feed codes, single words, or measurements to a model trained on prose. Cap work on large nodes.
  const prose = copy.slice(0, 400).normalize('NFC').replace(IDENTIFIER, ' ')
  const words = prose.match(LATIN_WORD)
  if (words === null || words.length < 2 || words.reduce((sum, word) => sum + word.length, 0) < 9) return undefined
  if (detector === undefined) {
    if (unavailable) return undefined
    loading ??= import('eld/extrasmall').then(({ eld }) => { detector = eld }, () => { unavailable = true })
    return loading
  }
  const detection = detector.detect(prose)
  const language = detection.language
  if (language === '' || language === target || !detection.isReliable()) return undefined
  const scores = detection.getScores()
  const winner = scores[language] ?? 0
  let runnerUp = 0
  for (const id in scores) if (id !== language) runnerUp = Math.max(runnerUp, scores[id] ?? 0)
  return winner >= 0.68 && winner - runnerUp >= 0.10 ? language : undefined
}
