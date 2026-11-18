import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { hashSources, I18nStore, pairEntries, type LocaleFile } from '../src/store.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function fixture(): { root: string; store: I18nStore } {
  const root = mkdtempSync(join(tmpdir(), 'jan-plugin-i18n-'))
  roots.push(root)
  return { root, store: new I18nStore(root) }
}

function file(sourceHash: string, generatedAt: number, locale = 'ja'): LocaleFile {
  return {
    format: 1, pkg: '@scope/pkg', locale, sourceLocale: 'en', sourceHash, model: 'p/m', generatedAt, kept: 0,
    entries: { ns: { k: { src: 'Hello', text: 'こんにちは' } } },
  }
}

describe('hashSources', () => {
  it('ignores key order and changes with any text', () => {
    const one = hashSources({ a: { x: '1', y: '2' }, b: { z: '3' } })
    expect(hashSources({ b: { z: '3' }, a: { y: '2', x: '1' } })).toBe(one)
    expect(hashSources({ a: { x: '1', y: '2' }, b: { z: '4' } })).not.toBe(one)
  })
})

describe('I18nStore', () => {
  it('writes under <pkg>/<hash>/<locale>.json and reads it back', async () => {
    const { root, store } = fixture()
    await store.writeLocale(file('aaaa', 1))
    expect(readdirSync(join(root, encodeURIComponent('@scope/pkg'), 'aaaa'))).toEqual(['ja.json'])
    expect(await store.readLocale('@scope/pkg', 'ja')).toEqual(file('aaaa', 1))
    expect(await store.readLocale('@scope/pkg', 'fr')).toBeUndefined()
    expect(await store.listPackages()).toEqual(['@scope/pkg'])
  })

  it('supersedes the older hash directory of the same locale and keeps other locales', async () => {
    const { root, store } = fixture()
    await store.writeLocale(file('aaaa', 1))
    await store.writeLocale(file('aaaa', 1, 'fr'))
    await store.writeLocale(file('bbbb', 2))
    const dir = join(root, encodeURIComponent('@scope/pkg'))
    expect(readdirSync(dir).toSorted()).toEqual(['aaaa', 'bbbb'])
    expect(readdirSync(join(dir, 'aaaa'))).toEqual(['fr.json'])
    expect((await store.readLocale('@scope/pkg', 'ja'))?.sourceHash).toBe('bbbb')
    expect((await store.listLocales('@scope/pkg')).map(item => item.locale)).toEqual(['fr', 'ja'])
  })

  it('treats a damaged file as absent', async () => {
    const { root, store } = fixture()
    const dir = join(root, 'dsh-cad', 'aaaa')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'ja.json'), '{not json')
    writeFileSync(join(dir, 'fr.json'), JSON.stringify({ format: 1 }))
    expect(await store.readLocale('dsh-cad', 'ja')).toBeUndefined()
    expect(await store.readLocale('dsh-cad', 'fr')).toBeUndefined()
    expect(await store.listLocales('dsh-cad')).toEqual([])
  })

  it('clears a package and keeps strings and consent out of the package list', async () => {
    const { store } = fixture()
    await store.writeLocale(file('aaaa', 1))
    await store.writeStrings('ja', { 工程图: '図面' })
    await store.writeConsent({ global: true, packages: ['x'] })
    expect(await store.listPackages()).toEqual(['@scope/pkg'])
    expect(await store.readStrings('ja')).toEqual({ 工程图: '図面' })
    expect(await store.readConsent()).toEqual({ global: true, packages: ['x'] })
    await store.clearPackage('@scope/pkg')
    expect(await store.listPackages()).toEqual([])
    await store.clearStrings()
    expect(await store.readStrings('ja')).toEqual({})
    expect(await new I18nStore(join(tmpdir(), 'jan-plugin-i18n-missing')).readConsent()).toEqual({ global: false, packages: [] })
  })
})

describe('pairEntries', () => {
  it('pairs each translation with its source and drops empty namespaces', () => {
    expect(pairEntries({ ns: { a: 'A', b: 'B' }, other: { c: 'C' } }, { ns: { a: 'あ' }, other: {} })).toEqual({
      ns: { a: { src: 'A', text: 'あ' } },
    })
  })
})
