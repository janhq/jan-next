/** Choosing the dictionaries a translator needs and the locales a package lacks. */
import type { LocalizedText } from '@janhq/jan-package-manifest'
import type { PluginI18nSources } from '@janhq/jan-api-remotes/client'
import type { LocaleRuntime } from '@janhq/jan-client-locale/client'
import { localeScripts, mismatchesLocale, scriptsOf } from './script.ts'

/** The registered-dictionary reads a translator needs. */
export type DictionarySource = Pick<LocaleRuntime, 'namespaces' | 'dictionary'>

/** Text to translate and the locale it is written in. */
export interface CollectedSources {
  /** Locale of every namespace in `sources`. */
  readonly sourceLocale: string
  readonly sources: PluginI18nSources
}

/**
 * Whether any of a package's namespaces lacks a registered dictionary for a locale.
 * @param runtime - registered dictionaries.
 * @param namespaces - namespaces the package registered.
 * @param locale - target locale.
 * @returns true when at least one namespace has no registered dictionary in that locale.
 */
export function lacksDictionary(runtime: DictionarySource, namespaces: readonly string[], locale: string): boolean {
  const rows = runtime.namespaces()
  const target = locale.toLowerCase()
  return namespaces.some((ns) => {
    const row = rows.find(candidate => candidate.ns === ns)
    return row !== undefined && !row.locales.includes(target)
  })
}

/**
 * Gather the source text of a package's namespaces that lack the target locale. English is the source when a
 * namespace has it; otherwise its first registered locale. One request has one source locale, so namespaces in
 * another source locale than the most common one are left out.
 * @param runtime - registered dictionaries.
 * @param namespaces - namespaces the package registered.
 * @param locale - target locale.
 * @returns the source locale and each missing namespace's dictionary.
 */
export function collectSources(runtime: DictionarySource, namespaces: readonly string[], locale: string): CollectedSources {
  const rows = runtime.namespaces()
  const target = locale.toLowerCase()
  const candidates: { ns: string; from: string }[] = []
  for (const ns of namespaces) {
    const row = rows.find(candidate => candidate.ns === ns)
    if (row === undefined || row.locales.includes(target)) continue
    const from = row.locales.includes('en') ? 'en' : row.locales[0]
    if (from !== undefined) candidates.push({ ns, from })
  }
  const counts = new Map<string, number>()
  for (const { from } of candidates) counts.set(from, (counts.get(from) ?? 0) + 1)
  const sourceLocale = [...counts].toSorted((a, b) => b[1] - a[1] || (a[0] === 'en' ? -1 : 1))[0]?.[0] ?? 'en'
  const sources: PluginI18nSources = {}
  for (const { ns, from } of candidates) {
    const dictionary = from === sourceLocale ? runtime.dictionary(ns, from) : undefined
    if (dictionary !== undefined) sources[ns] = { ...dictionary }
  }
  return { sourceLocale, sources }
}

/**
 * Whether package display text lacks the locale. A plain string states no locale: it lacks the UI locale when it is
 * written in a foreign script, or when the UI is not English and the text is not in the locale's own non-Latin
 * script. A translation map lacks it when no key names the locale's language.
 * @param text - a package title or description.
 * @param locale - active UI locale tag.
 * @returns whether the text lacks the locale.
 */
export function metaLacksLocale(text: LocalizedText, locale: string): boolean {
  const id = locale.toLowerCase()
  const primary = id.split('-')[0] ?? id
  if (typeof text === 'string') {
    if (mismatchesLocale(text, locale)) return true
    // A plain string states no locale. English suits an English UI; elsewhere only text already in the
    // locale's own non-Latin script counts as written for it.
    return primary !== 'en' && !localeScripts(locale).some(script => scriptsOf(text).has(script))
  }
  return !Object.keys(text).some(key => key === id || key.split('-')[0] === primary)
}
