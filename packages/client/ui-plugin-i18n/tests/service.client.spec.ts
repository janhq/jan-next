// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@janhq/cordis'
import type {} from '@janhq/jan-api-remotes/client'
import { TestRemote } from '@janhq/jan-client-test-runtime'
import type { PluginI18nConsent, PluginI18nStatus, PluginI18nTables } from '@janhq/jan-api-remotes/client'
import { LocaleRuntime } from '@janhq/jan-client-locale/client'
import { NamespaceOwnership } from '../src/client/ownership.ts'
import { PluginI18nClient } from '../src/client/service.ts'

const ok = <T>(value: T): Promise<{ ok: true; value: T }> => Promise.resolve({ ok: true, value })

/** A scripted Host: mutable stored text, consent, and calls. */
function host() {
  const state = {
    statuses: [] as PluginI18nStatus[],
    consent: { global: false, packages: [] } as PluginI18nConsent,
    tables: { locale: 'ja', packages: {}, strings: {}, runtime: {} } as PluginI18nTables,
    strings: {} as Record<string, string>,
  }
  const face = {
    statuses: vi.fn(() => ok(state.statuses)),
    consent: vi.fn(() => ok(state.consent)),
    route: vi.fn(() => ok({ provider: 'p', model: 'm' })),
    tables: vi.fn((locale: string) => ok({ ...state.tables, locale })),
    translate: vi.fn((request: { pkg: string; locale: string }) => ok({
      pkg: request.pkg, locale: request.locale, state: 'running' as const, done: 0, total: 1,
    })),
    translateStrings: vi.fn((strings: string[]) => {
      const known = strings.flatMap(text => state.strings[text] === undefined ? [] : [[text, state.strings[text]]])
      return ok(Object.fromEntries(known))
    }),
    clear: vi.fn(() => ok(undefined)),
    setConsent: vi.fn((change: { allowed: boolean }) => {
      state.consent = { ...state.consent, global: change.allowed }
      return ok(state.consent)
    }),
  }
  return { state, face }
}

async function harness(active = 'ja') {
  vi.stubGlobal('navigator', { languages: [active], language: active })
  const ctx = new Context()
  const { state, face } = host()
  const remote = new TestRemote(ctx, { pluginI18n: face })
  const locale = new LocaleRuntime(ctx, undefined, { languages: [active], preference: active })
  locale.addLanguage({ id: 'ja', label: '日本語', fallback: 'en' })
  locale.setLocale(active)
  ctx.provide('locale', locale)
  const ownership = new NamespaceOwnership(() => new Set(locale.namespaces().map(row => row.ns)))
  const client = new PluginI18nClient(ctx, ownership)
  return { ctx, state, face, remote, locale, ownership, client }
}

/** Register a plugin namespace the way a plugin fiber would, attributed to a package. */
function register(h: Awaited<ReturnType<typeof harness>>, pkg: string, ns: string, dict: Record<string, string>, uid = 1): void {
  h.ownership.begin(uid)
  h.locale.register(ns, 'en', dict)
  h.ownership.end(uid, pkg)
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('PluginI18nClient', () => {
  it('registers stored tables as a generated layer that never shadows the plugin', async () => {
    const h = await harness()
    h.locale.register('cad', 'en', { open: 'Open', close: 'Close' })
    h.locale.register('cad', 'ja', { close: '閉じる' })
    h.state.tables = {
      locale: 'ja',
      packages: {
        'dsh-cad': {
          sourceLocale: 'en',
          entries: { cad: { open: { src: 'Open', text: '開く' }, close: { src: 'Close', text: '生成' } } },
        },
      },
      strings: {},
      runtime: {},
    }
    await h.client.refresh()
    const t = h.locale.bind('cad')
    expect(t('open')).toBe('開く')
    expect(t('close')).toBe('閉じる')
    expect(h.client.getSnapshot().ready).toBe(true)
    expect(h.client.getSnapshot().route).toEqual({ provider: 'p', model: 'm' })
  })

  it('replaces generated tables on every read and drops them on dispose', async () => {
    const h = await harness()
    h.locale.register('cad', 'en', { open: 'Open' })
    h.state.tables = { locale: 'ja', packages: { p: { sourceLocale: 'en', entries: { cad: { open: { src: 'Open', text: '一' } } } } }, strings: {}, runtime: {} }
    await h.client.refresh()
    h.state.tables = { locale: 'ja', packages: { p: { sourceLocale: 'en', entries: { cad: { open: { src: 'Open', text: '二' } } } } }, strings: {}, runtime: {} }
    await h.client.refresh()
    expect(h.locale.bind('cad')('open')).toBe('二')
    h.client.dispose()
    expect(h.locale.bind('cad')('open')).toBe('Open')
  })

  it('reloads the tables of the new locale when the language changes', async () => {
    const h = await harness('en')
    await h.client.refresh()
    expect(h.face.tables).toHaveBeenLastCalledWith('en')
    h.locale.setLocale('ja')
    h.client.localeChanged()
    await vi.advanceTimersByTimeAsync(0)
    expect(h.face.tables).toHaveBeenLastCalledWith('ja')
  })

  describe('assess', () => {
    it('offers nothing for a plain English plugin in an English UI', async () => {
      const h = await harness('en')
      await h.client.refresh()
      expect(h.client.assess({ pkg: 'p', meta: ['Draws parts', 'Plugin'] })).toBeNull()
    })

    it('offers a plugin whose display text lacks the locale, naming the language and the model', async () => {
      const h = await harness('ja')
      await h.client.refresh()
      expect(h.client.assess({ pkg: 'p', meta: [{ en: 'Parts' }] })).toEqual({
        pkg: 'p', locale: 'ja', language: '日本語', route: { provider: 'p', model: 'm' },
      })
    })

    it('offers a plugin whose text is in another script even in the matching language', async () => {
      const h = await harness('en')
      await h.client.refresh()
      expect(h.client.assess({ pkg: 'p', meta: ['生成工程图'] })?.locale).toBe('en')
    })

    it('offers nothing when the plugin ships the locale', async () => {
      const h = await harness('ja')
      await h.client.refresh()
      expect(h.client.assess({ pkg: 'p', meta: [{ en: 'Parts', ja: '部品' }] })).toBeNull()
      register(h, 'p', 'p.ns', { a: 'A' })
      h.locale.register('p.ns', 'ja', { a: 'あ' })
      expect(h.client.assess({ pkg: 'p', meta: [{ en: 'Parts', ja: '部品' }] })).toBeNull()
    })

    it('offers when an attributed namespace lacks the locale although the display text has it', async () => {
      const h = await harness('ja')
      await h.client.refresh()
      register(h, 'p', 'p.ns', { a: 'A' })
      expect(h.client.assess({ pkg: 'p', meta: [{ en: 'Parts', ja: '部品' }] })?.pkg).toBe('p')
      expect(h.client.assess({ pkg: 'other', meta: [{ en: 'Parts', ja: '部品' }] })).toBeNull()
    })

    it('offers nothing once a translation of the locale is stored', async () => {
      const h = await harness('ja')
      h.state.statuses = [{
        pkg: 'p', consented: true, runtime: [], job: null,
        locales: [{ locale: 'ja', sourceLocale: 'en', model: 'p/m', generatedAt: 1, namespaces: [], entries: 0, kept: 0 }],
      }]
      await h.client.refresh()
      expect(h.client.assess({ pkg: 'p', meta: [{ en: 'Parts' }] })).toBeNull()
    })
  })

  describe('translate', () => {
    it('sends the attributed namespaces that lack the locale and resolves when the Host job ends', async () => {
      const h = await harness('ja')
      register(h, 'dsh-cad', 'cad', { open: 'Open' })
      h.locale.register('other', 'en', { z: 'Z' })
      await h.client.refresh()
      const pending = h.client.translate('dsh-cad')
      await vi.advanceTimersByTimeAsync(0)
      expect(h.face.translate).toHaveBeenCalledWith({
        pkg: 'dsh-cad', locale: 'ja', sourceLocale: 'en', sources: { cad: { open: 'Open' } },
      })
      let settled = false
      void pending.then(() => { settled = true })
      await vi.advanceTimersByTimeAsync(10)
      expect(settled).toBe(false)
      h.state.statuses = [{
        pkg: 'dsh-cad', consented: true, runtime: [], locales: [],
        job: { pkg: 'dsh-cad', locale: 'ja', state: 'done', done: 1, total: 1 },
      }]
      h.client.hostChanged()
      await expect(pending).resolves.toMatchObject({ state: 'done' })
    })

    it('passes rerun through and surfaces a failed job', async () => {
      const h = await harness('ja')
      await h.client.refresh()
      const pending = h.client.translate('p', true)
      await vi.advanceTimersByTimeAsync(0)
      expect(h.face.translate).toHaveBeenCalledWith(expect.objectContaining({ rerun: true }))
      h.state.statuses = [{
        pkg: 'p', consented: true, runtime: [], locales: [],
        job: { pkg: 'p', locale: 'ja', state: 'failed', done: 0, total: 1, message: 'offline' },
      }]
      h.client.hostChanged()
      await expect(pending).resolves.toMatchObject({ state: 'failed', message: 'offline' })
    })

    it('rejects when the Host refuses the request', async () => {
      const h = await harness('ja')
      h.face.translate.mockReturnValueOnce(Promise.resolve({ ok: false, error: new Error('too large') }) as never)
      await expect(h.client.translate('p')).rejects.toThrow('too large')
    })
  })

  it('translates again in the background when a consented package activates with a missing locale', async () => {
    const h = await harness('ja')
    h.state.consent = { global: false, packages: ['dsh-cad'] }
    await h.client.refresh()
    register(h, 'dsh-cad', 'cad', { open: 'Open' })
    h.client.activated('dsh-cad')
    await vi.advanceTimersByTimeAsync(0)
    expect(h.face.translate).toHaveBeenCalledTimes(1)
    h.client.activated('not-consented')
    await vi.advanceTimersByTimeAsync(0)
    expect(h.face.translate).toHaveBeenCalledTimes(1)
  })

  it('does not translate on activation when the stored text already covers the namespaces', async () => {
    const h = await harness('ja')
    h.state.consent = { global: false, packages: ['p'] }
    h.state.statuses = [{
      pkg: 'p', consented: true, runtime: [], job: null,
      locales: [{ locale: 'ja', sourceLocale: 'en', model: 'p/m', generatedAt: 1, namespaces: ['n'], entries: 1, kept: 0 }],
    }]
    await h.client.refresh()
    register(h, 'p', 'n', { a: 'A' })
    h.client.activated('p')
    await vi.advanceTimersByTimeAsync(0)
    expect(h.face.translate).not.toHaveBeenCalled()
  })

  it('forwards clear and the global switch, then reads again', async () => {
    const h = await harness('ja')
    await h.client.refresh()
    await h.client.clear('p')
    expect(h.face.clear).toHaveBeenCalledWith('p')
    await h.client.setGlobal(true)
    expect(h.face.setConsent).toHaveBeenCalledWith({ allowed: true })
    expect(h.client.getSnapshot().consent.global).toBe(true)
  })

  describe('tool titles', () => {
    it('does nothing without consent', async () => {
      const h = await harness('en')
      await h.client.refresh()
      const view = h.client.titles.getSnapshot()
      view.request('工程图 body1')
      await vi.advanceTimersByTimeAsync(500)
      expect(h.face.translateStrings).not.toHaveBeenCalled()
      expect(view.display('工程图 body1')).toBe('工程图 body1')
    })

    it('batches foreign-script titles, skips matching ones, and shows the source until the translation arrives', async () => {
      const h = await harness('en')
      h.state.consent = { global: true, packages: [] }
      h.state.strings = { '工程图 body1': 'Drawing body1', '装配': 'Assembly' }
      await h.client.refresh()
      const views: string[] = []
      h.client.titles.subscribe(() => { views.push(h.client.titles.getSnapshot().display('工程图 body1')) })
      const before = h.client.titles.getSnapshot()
      before.request('工程图 body1')
      before.request('装配')
      before.request('Already English')
      before.request('工程图 body1')
      expect(before.display('工程图 body1')).toBe('工程图 body1')
      await vi.advanceTimersByTimeAsync(200)
      expect(h.face.translateStrings).toHaveBeenCalledTimes(1)
      expect(h.face.translateStrings).toHaveBeenCalledWith(['工程图 body1', '装配'], 'en')
      const after = h.client.titles.getSnapshot()
      expect(after).not.toBe(before)
      expect(after.display('工程图 body1')).toBe('Drawing body1')
      expect(after.display('装配')).toBe('Assembly')
      expect(after.display('Already English')).toBe('Already English')
      expect(views.at(-1)).toBe('Drawing body1')
    })

    it('splits a large burst into several requests and never asks for a string twice', async () => {
      const h = await harness('en')
      h.state.consent = { global: true, packages: [] }
      await h.client.refresh()
      const view = h.client.titles.getSnapshot()
      for (let index = 0; index < 90; index++) view.request(`标题${String(index)}`)
      await vi.advanceTimersByTimeAsync(1000)
      expect(h.face.translateStrings.mock.calls.map(call => call[0].length)).toEqual([40, 40, 10])
      view.request('标题0')
      await vi.advanceTimersByTimeAsync(1000)
      expect(h.face.translateStrings).toHaveBeenCalledTimes(3)
    })

    it('keeps the source and stops asking after a Host failure', async () => {
      const h = await harness('en')
      h.state.consent = { global: true, packages: [] }
      await h.client.refresh()
      h.face.translateStrings.mockReturnValueOnce(Promise.resolve({ ok: false, error: new Error('offline') }) as never)
      const logger = vi.spyOn(h.ctx.logger, 'warn').mockImplementation(() => {})
      const view = h.client.titles.getSnapshot()
      view.request('装配')
      await vi.advanceTimersByTimeAsync(200)
      expect(logger).toHaveBeenCalled()
      view.request('装配')
      await vi.advanceTimersByTimeAsync(200)
      expect(h.face.translateStrings).toHaveBeenCalledTimes(1)
      expect(view.display('装配')).toBe('装配')
    })

    it('shows cached strings the Host returned at start-up only while consent stands', async () => {
      const h = await harness('en')
      h.state.consent = { global: true, packages: [] }
      h.state.tables = { locale: 'en', packages: {}, strings: { '装配': 'Assembly' }, runtime: {} }
      await h.client.refresh()
      expect(h.client.titles.getSnapshot().display('装配')).toBe('Assembly')
      h.state.consent = { global: false, packages: [] }
      await h.client.refresh()
      expect(h.client.titles.getSnapshot().display('装配')).toBe('装配')
    })

    it('forgets translations and requests when the language changes', async () => {
      const h = await harness('en')
      h.state.consent = { global: true, packages: [] }
      h.state.strings = { '装配': 'Assembly' }
      await h.client.refresh()
      h.client.titles.getSnapshot().request('装配')
      await vi.advanceTimersByTimeAsync(200)
      expect(h.client.titles.getSnapshot().display('装配')).toBe('Assembly')
      h.state.tables = { locale: 'ja', packages: {}, strings: {}, runtime: {} }
      h.locale.setLocale('ja')
      h.client.localeChanged()
      await vi.advanceTimersByTimeAsync(0)
      expect(h.client.titles.getSnapshot().display('装配')).toBe('装配')
    })
  })
})
