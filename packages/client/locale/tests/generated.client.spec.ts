// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@janhq/cordis'
import { LocaleRuntime } from '@janhq/jan-client-locale/client'

function make(): LocaleRuntime {
  vi.stubGlobal('navigator', { languages: ['en'], language: 'en' })
  const locale = new LocaleRuntime(new Context(), undefined, { languages: ['en'], preference: null })
  locale.addLanguage({ id: 'ja', label: '日本語', fallback: 'en' })
  return locale
}

afterEach(() => { vi.unstubAllGlobals() })

describe('LocaleRuntime generated layer', () => {
  it('lists registered namespaces and reads registered dictionaries only', () => {
    const locale = make()
    locale.register('plugin.a', 'en', { hello: 'Hello' })
    locale.registerGenerated('plugin.a', 'ja', { from: 'en', entries: { hello: { src: 'Hello', text: 'こんにちは' } } })
    expect(locale.namespaces().filter(row => row.ns === 'plugin.a')).toEqual([{ ns: 'plugin.a', locales: ['en'] }])
    expect(locale.dictionary('plugin.a', 'EN')).toEqual({ hello: 'Hello' })
    expect(locale.dictionary('plugin.a', 'ja')).toBeUndefined()
  })

  it('fills a locale the plugin does not ship, with placeholders substituted', () => {
    const locale = make()
    const t = locale.bind('plugin.a')
    locale.register('plugin.a', 'en', { hello: 'Hello {name}' })
    locale.registerGenerated('plugin.a', 'ja', { from: 'en', entries: { hello: { src: 'Hello {name}', text: '{name} さん、こんにちは' } } })
    locale.setLocale('ja')
    expect(t('hello', { name: 'Ann' })).toBe('Ann さん、こんにちは')
    locale.setLocale('en')
    expect(t('hello', { name: 'Ann' })).toBe('Hello Ann')
  })

  it('never shadows a string the plugin registered for that locale', () => {
    const locale = make()
    const t = locale.bind('plugin.a')
    locale.register('plugin.a', 'en', { own: 'Own', missing: 'Missing' })
    locale.register('plugin.a', 'ja', { own: '自前' })
    locale.registerGenerated('plugin.a', 'ja', {
      from: 'en', entries: { own: { src: 'Own', text: '生成' }, missing: { src: 'Missing', text: '不足' } },
    })
    locale.setLocale('ja')
    expect(t('own')).toBe('自前')
    expect(t('missing')).toBe('不足')
  })

  it('applies only while the plugin still supplies the translated source text', () => {
    const locale = make()
    const t = locale.bind('plugin.a')
    const dispose = locale.register('plugin.a', 'en', { hello: 'Hello' })
    locale.registerGenerated('plugin.a', 'ja', { from: 'en', entries: { hello: { src: 'Hello', text: 'こんにちは' } } })
    locale.setLocale('ja')
    expect(t('hello')).toBe('こんにちは')
    dispose()
    locale.register('plugin.a', 'en', { hello: 'Hello there' })
    expect(t('hello')).toBe('Hello there')
  })

  it('does not apply to a namespace no plugin registered', () => {
    const locale = make()
    locale.registerGenerated('orphan', 'ja', { from: 'en', entries: { k: { src: 'K', text: 'ケ' } } })
    locale.setLocale('ja')
    expect(locale.bind('orphan')('k')).toBe('k')
  })

  it('does not collide with register in either order', () => {
    const locale = make()
    locale.registerGenerated('plugin.a', 'ja', { from: 'en', entries: { hello: { src: 'Hello', text: 'こんにちは' } } })
    expect(() => locale.register('plugin.a', 'ja', { hello: '本物' })).not.toThrow()
    expect(() => locale.register('plugin.a', 'ja', { hello: '重複' })).toThrow('already has locale')
    locale.setLocale('ja')
    expect(locale.bind('plugin.a')('hello')).toBe('本物')
  })

  it('replaces a generated table for the same namespace and locale and disposes exactly its own', () => {
    const locale = make()
    locale.register('plugin.a', 'en', { hello: 'Hello' })
    const first = locale.registerGenerated('plugin.a', 'ja', { from: 'en', entries: { hello: { src: 'Hello', text: '一' } } })
    const second = locale.registerGenerated('plugin.a', 'ja', { from: 'en', entries: { hello: { src: 'Hello', text: '二' } } })
    locale.setLocale('ja')
    const t = locale.bind('plugin.a')
    expect(t('hello')).toBe('二')
    first()
    expect(t('hello')).toBe('二')
    second()
    second()
    expect(t('hello')).toBe('Hello')
  })

  it('advances the render revision and rejects a malformed locale tag', () => {
    const locale = make()
    const before = locale.getSnapshot().revision
    const dispose = locale.registerGenerated('plugin.a', 'ja', { from: 'en', entries: {} })
    expect(locale.getSnapshot().revision).toBe(before + 1)
    dispose()
    expect(locale.getSnapshot().revision).toBe(before + 2)
    expect(() => locale.registerGenerated('plugin.a', 'not a tag', { from: 'en', entries: {} })).toThrow('BCP 47')
  })
})
