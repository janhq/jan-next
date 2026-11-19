import { describe, expect, it } from 'vitest'
import { foreignLanguage, localeScripts, mismatchesLocale, scriptsOf } from '../src/client/script.ts'
import { collectSources, lacksDictionary, metaLacksLocale, type DictionarySource } from '../src/client/sources.ts'

describe('script heuristic', () => {
  it('finds the non-Latin scripts of a text', () => {
    expect([...scriptsOf('工程图 body1')]).toEqual(['han'])
    expect([...scriptsOf('ひらがなとカタカナ')]).toEqual(['kana'])
    expect([...scriptsOf('한국어 title')]).toEqual(['hangul'])
    expect([...scriptsOf('Привет world')]).toEqual(['cyrillic'])
    expect([...scriptsOf('Assembly 3 {name}')]).toEqual([])
  })

  it('flags Han, Kana, Hangul, and Cyrillic titles in an English UI but never Latin ones', () => {
    for (const title of ['工程图 body1', 'ひらがな', '한국어', 'Привет']) expect(mismatchesLocale(title, 'en')).toBe(true)
    for (const title of ['Drawing body1', 'Éléments', 'Straße 12']) expect(mismatchesLocale(title, 'en')).toBe(false)
  })

  it('accepts the scripts a locale writes itself in', () => {
    expect(mismatchesLocale('工程图', 'zh')).toBe(false)
    expect(mismatchesLocale('工程图', 'zh-CN')).toBe(false)
    expect(mismatchesLocale('図面 ひらがな', 'ja')).toBe(false)
    expect(mismatchesLocale('Привет', 'ru')).toBe(false)
    expect(mismatchesLocale('Привет', 'ja')).toBe(true)
    expect(mismatchesLocale('ひらがな', 'zh')).toBe(true)
    expect(localeScripts('pt')).toEqual([])
  })
})

describe('foreign plugin language', () => {
  it('answers Unicode and rejects non-prose synchronously before requesting the model', () => {
    expect(foreignLanguage('特征树', 'en')).toBe('zh')
    expect(foreignLanguage('cad_sketch_new', 'en')).toBeUndefined()
    const pending = foreignLanguage('Neues Projekt erstellen', 'en')
    expect(pending).toBeInstanceOf(Promise)
    expect(foreignLanguage('Créer un projet', 'en')).toBe(pending)
  })

  async function detect(text: string, locale: string) {
    const result = foreignLanguage(text, locale)
    if (!(result instanceof Promise)) return result
    await result
    return foreignLanguage(text, locale)
  }

  it.each([
    ['特征树', 'zh'], ['还没有特征 - 用 cad_sketch_new 开始绘制', 'zh'],
    ['Neues Projekt erstellen', 'de'], ['Keine Elemente vorhanden', 'de'],
    ['Aucun élément trouvé', 'fr'], ['Tạo bản vẽ mới', 'vi'],
  ])('identifies "%s" as %s in an English UI', async (text, language) => {
    expect(await detect(text, 'en')).toBe(language)
    expect(await detect(text, language)).toBeUndefined()
  })

  it.each(['Save', 'Save changes', 'Create a new drawing', 'Feature Tree', 'cad_sketch_new',
    'featureTreeComponent', '123.50 mm', '90°', 'µm', 'Feature tree.step', '工程图.step'])('ignores "%s" in an English UI', async (text) => {
    expect(await detect(text, 'en')).toBeUndefined()
  })
})

/** Registered dictionaries as the locale runtime reports them. */
function dictionaries(tables: Record<string, Record<string, Record<string, string>>>): DictionarySource {
  return {
    namespaces: () => Object.entries(tables).map(([ns, locales]) => ({ ns, locales: Object.keys(locales) })),
    dictionary: (ns, locale) => tables[ns]?.[locale],
  }
}

describe('lacksDictionary and collectSources', () => {
  const runtime = dictionaries({
    a: { en: { x: 'X' }, zh: { x: '叉' } },
    b: { en: { y: 'Y' }, ja: { y: 'ワイ' } },
    c: { zh: { z: '子' } },
  })

  it('detects namespaces without the locale', () => {
    expect(lacksDictionary(runtime, ['a'], 'ja')).toBe(true)
    expect(lacksDictionary(runtime, ['b'], 'ja')).toBe(false)
    expect(lacksDictionary(runtime, ['b', 'a'], 'JA')).toBe(true)
    expect(lacksDictionary(runtime, ['unknown'], 'ja')).toBe(false)
    expect(lacksDictionary(runtime, [], 'ja')).toBe(false)
  })

  it('takes English as the source and copies only namespaces lacking the locale', () => {
    expect(collectSources(runtime, ['a', 'b'], 'ja')).toEqual({ sourceLocale: 'en', sources: { a: { x: 'X' } } })
  })

  it('leaves out namespaces whose source locale differs from the most common one', () => {
    expect(collectSources(runtime, ['a', 'c'], 'ja')).toEqual({ sourceLocale: 'en', sources: { a: { x: 'X' } } })
    expect(collectSources(runtime, ['c'], 'ja')).toEqual({ sourceLocale: 'zh', sources: { c: { z: '子' } } })
    expect(collectSources(runtime, [], 'ja')).toEqual({ sourceLocale: 'en', sources: {} })
  })

  it('copies the dictionary so later registration changes do not alter the request', () => {
    const live = { x: 'X' }
    const { sources } = collectSources(dictionaries({ a: { en: live } }), ['a'], 'ja')
    live.x = 'changed'
    expect(sources['a']).toEqual({ x: 'X' })
  })
})

describe('metaLacksLocale', () => {
  it('treats a plain English string as complete for an English UI and missing elsewhere', () => {
    expect(metaLacksLocale('Draws parts', 'en')).toBe(false)
    expect(metaLacksLocale('Draws parts', 'ja')).toBe(true)
    expect(metaLacksLocale('Draws parts', 'es')).toBe(true)
  })

  it('flags a plain string in a foreign script and accepts one in the locale\'s own script', () => {
    expect(metaLacksLocale('生成工程图', 'en')).toBe(true)
    expect(metaLacksLocale('生成工程图', 'zh')).toBe(false)
    expect(metaLacksLocale('生成工程图', 'ru')).toBe(true)
  })

  it('reads a translation map for the locale or its language', () => {
    expect(metaLacksLocale({ en: 'Parts', ja: '部品' }, 'ja')).toBe(false)
    expect(metaLacksLocale({ en: 'Parts', 'zh-cn': '零件' }, 'zh')).toBe(false)
    expect(metaLacksLocale({ en: 'Parts', ja: '部品' }, 'fr')).toBe(true)
    expect(metaLacksLocale({ en: 'Parts' }, 'en')).toBe(false)
  })
})
