/** Acceptance rules for one generated translation. */

/** The `{name}` tokens the client locale runtime substitutes; the same expression as `LocaleRuntime.translate`. */
const PLACEHOLDER = /\{(\w+)\}/g

/** Backtick code spans, which carry commands, field names, and API identifiers. */
const CODE_SPAN = /`[^`\n]+`/g

const URL_PATTERN = /\bhttps?:\/\/\S+/gi

/** Zero-width characters and C0/C1 controls, the same set `check:i18n` rejects in dictionaries. */
const FORBIDDEN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B\uFEFF]/

/** Translations may grow by this factor plus a constant before they count as runaway output. */
const MAX_GROWTH = 8
const GROWTH_SLACK = 64

/** Why a translation was refused. */
export type TranslationProblem = 'empty' | 'placeholders' | 'code-span' | 'url' | 'control-characters' | 'too-long'

/**
 * Sort the matches of a pattern so two texts compare as multisets.
 * @param text - text to scan.
 * @param pattern - global pattern.
 * @returns matched strings in sorted order, duplicates kept.
 */
function multiset(text: string, pattern: RegExp): string[] {
  return (text.match(pattern) ?? []).toSorted()
}

/**
 * Read the placeholder tokens of a template.
 * @param text - template text.
 * @returns the sorted `{name}` tokens, duplicates kept.
 */
export function placeholdersOf(text: string): string[] {
  return multiset(text, PLACEHOLDER)
}

/**
 * Compare two sorted token lists.
 * @param a - first list.
 * @param b - second list.
 * @returns whether both lists hold the same tokens the same number of times.
 */
function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((token, index) => token === b[index])
}

/**
 * Decide whether a model's translation may replace the source text.
 * @param source - the plugin's own text.
 * @param translated - the model's output for it.
 * @returns the first rule the translation breaks, or undefined when it is acceptable.
 */
export function checkTranslation(source: string, translated: string): TranslationProblem | undefined {
  if (translated.trim() === '' && source.trim() !== '') return 'empty'
  if (FORBIDDEN.test(translated)) return 'control-characters'
  if (!sameList(placeholdersOf(source), placeholdersOf(translated))) return 'placeholders'
  if (!sameList(multiset(source, CODE_SPAN), multiset(translated, CODE_SPAN))) return 'code-span'
  // A translation introduces no link the plugin did not write.
  const known = new Set(multiset(source, URL_PATTERN))
  if (multiset(translated, URL_PATTERN).some(url => !known.has(url))) return 'url'
  if (translated.length > source.length * MAX_GROWTH + GROWTH_SLACK) return 'too-long'
  return undefined
}
