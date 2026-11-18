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

const HINT = '建模区为空 · 在对话中描述零件'
const EXPORT = '导出'

/** A scripted Host that translates strings from a table and records what it was asked. */
function host() {
  const state = {
    statuses: [] as PluginI18nStatus[],
    consent: { global: false, packages: [] } as PluginI18nConsent,
    translations: { [HINT]: 'The model area is empty - describe a part in the chat', [EXPORT]: 'Export', '搜索': 'Search', '取消': 'Cancel' } as Record<string, string>,
    /** Strings the Host already stored and lists under a package. */
    stored: {} as Record<string, string[]>,
  }
  const face = {
    statuses: vi.fn(() => ok(state.statuses)),
    consent: vi.fn(() => ok(state.consent)),
    route: vi.fn(() => ok({ provider: 'p', model: 'm', source: 'default' as const })),
    tables: vi.fn((locale: string) => ok({
      locale,
      packages: {},
      strings: Object.fromEntries(Object.values(state.stored).flat().map(text => [text, state.translations[text] ?? text])),
      runtime: state.stored,
    } satisfies PluginI18nTables)),
    translate: vi.fn((request: { pkg: string; locale: string }) => ok({
      pkg: request.pkg, locale: request.locale, state: 'done' as const, done: 0, total: 0,
    })),
    translateStrings: vi.fn((strings: string[], _locale: string, pkg?: string) => {
      if (pkg !== undefined && !state.consent.packages.includes(pkg)) {
        return Promise.resolve({ ok: false as const, error: new Error('not consented') })
      }
      const known = strings.flatMap(text => state.translations[text] === undefined ? [] : [[text, state.translations[text]]])
      return ok(Object.fromEntries(known))
    }),
    clear: vi.fn((pkg: string) => {
      state.consent = { ...state.consent, packages: state.consent.packages.filter(name => name !== pkg) }
      return ok(undefined)
    }),
    setConsent: vi.fn(() => ok(state.consent)),
  }
  return { state, face }
}

const clients: PluginI18nClient[] = []

async function harness(active = 'en') {
  vi.stubGlobal('navigator', { languages: [active], language: active })
  const ctx = new Context()
  const { state, face } = host()
  const remote = new TestRemote(ctx, { pluginI18n: face })
  const locale = new LocaleRuntime(ctx, undefined, { languages: [active], preference: active })
  locale.setLocale(active)
  ctx.provide('locale', locale)
  const ownership = new NamespaceOwnership(() => new Set(locale.namespaces().map(row => row.ns)))
  const client = new PluginI18nClient(ctx, ownership, document)
  clients.push(client)
  return { ctx, state, face, remote, locale, client }
}

/** Mount a plugin's panel the way the slot renderer does: inside an owner marker. */
function mountPanel(owner: string, html: string): HTMLElement {
  const container = document.createElement('div')
  container.setAttribute('data-plugin-owner', owner)
  container.innerHTML = html
  document.body.append(container)
  return container
}

/** Let the observer deliver, the debounce elapse, and the Host answer. */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(400)
  await vi.advanceTimersByTimeAsync(0)
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => {
  // Every client watches the shared document, so none may outlive its test.
  for (const client of clients.splice(0)) client.dispose()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  document.body.replaceChildren()
})

describe('on-screen translation of plugin-rendered text', () => {
  it('replaces the foreign text and attributes of a consented plugin once the Host translated them', async () => {
    const h = await harness()
    const panel = mountPanel('dsh-cad', `<p id="hint">${HINT}</p><button id="export" title="${EXPORT}" aria-label="${EXPORT}">${EXPORT}</button><input id="q" placeholder="搜索">`)
    h.state.consent = { global: false, packages: ['dsh-cad'] }
    await h.client.refresh()
    // Nothing is replaced before the answer arrives.
    expect(panel.querySelector('#hint')?.textContent).toBe(HINT)
    await settle()
    expect(h.face.translateStrings).toHaveBeenCalledTimes(1)
    expect(h.face.translateStrings.mock.calls[0]?.slice(1, 4)).toEqual(['en', 'dsh-cad', false])
    expect(panel.querySelector('#hint')?.textContent).toBe('The model area is empty - describe a part in the chat')
    const button = panel.querySelector('#export')
    expect(button?.textContent).toBe('Export')
    expect(button?.getAttribute('title')).toBe('Export')
    expect(button?.getAttribute('aria-label')).toBe('Export')
    expect(panel.querySelector('#q')?.getAttribute('placeholder')).toBe('Search')
  })

  it('leaves a plugin without consent untouched and never sends its text', async () => {
    const h = await harness()
    const other = mountPanel('other-plugin', `<p>${HINT}</p><button title="${EXPORT}">${EXPORT}</button>`)
    const mine = mountPanel('dsh-cad', `<p>${EXPORT}</p>`)
    h.state.consent = { global: true, packages: [] }
    await h.client.refresh()
    await settle()
    expect(other.textContent).toBe(`${HINT}${EXPORT}`)
    expect(other.querySelector('button')?.getAttribute('title')).toBe(EXPORT)
    expect(mine.textContent).toBe(EXPORT)
    expect(h.face.translateStrings).not.toHaveBeenCalled()
    // Consenting for one plugin does not reach the other.
    h.state.consent = { global: false, packages: ['dsh-cad'] }
    await h.client.refresh()
    await settle()
    expect(mine.textContent).toBe('Export')
    expect(other.textContent).toBe(`${HINT}${EXPORT}`)
    expect(h.face.translateStrings.mock.calls.flatMap(call => call[0])).toEqual([EXPORT])
  })

  it('translates text outside any owner marker never, and text the UI locale already uses never', async () => {
    const h = await harness()
    const outside = document.createElement('p')
    outside.textContent = HINT
    document.body.append(outside)
    const panel = mountPanel('dsh-cad', '<p>Already English</p>')
    h.state.consent = { global: false, packages: ['dsh-cad'] }
    await h.client.refresh()
    await settle()
    expect(outside.textContent).toBe(HINT)
    expect(panel.textContent).toBe('Already English')
    expect(h.face.translateStrings).not.toHaveBeenCalled()
  })

  it('never touches inputs, textareas, editable regions, code, pre, or canvas', async () => {
    const h = await harness()
    const panel = mountPanel('dsh-cad', [
      `<input id="field" value="${EXPORT}">`,
      `<textarea id="area">${EXPORT}</textarea>`,
      `<div id="edit" contenteditable="true">${EXPORT}</div>`,
      `<code id="code">${EXPORT}</code>`,
      `<pre id="pre"><span>${EXPORT}</span></pre>`,
      `<canvas id="canvas" aria-label="${EXPORT}">${EXPORT}</canvas>`,
      '<textarea id="note" placeholder="搜索"></textarea>',
      `<div contenteditable="false"><span id="locked">${EXPORT}</span></div>`,
    ].join(''))
    h.state.consent = { global: false, packages: ['dsh-cad'] }
    await h.client.refresh()
    await settle()
    expect((panel.querySelector('#field') as HTMLInputElement).value).toBe(EXPORT)
    expect(panel.querySelector('#area')?.textContent).toBe(EXPORT)
    expect((panel.querySelector('#area') as HTMLTextAreaElement).value).toBe(EXPORT)
    expect(panel.querySelector('#edit')?.textContent).toBe(EXPORT)
    expect(panel.querySelector('#code')?.textContent).toBe(EXPORT)
    expect(panel.querySelector('#pre')?.textContent).toBe(EXPORT)
    expect(panel.querySelector('#canvas')?.textContent).toBe(EXPORT)
    expect(panel.querySelector('#canvas')?.getAttribute('aria-label')).toBe(EXPORT)
    // A textarea's placeholder is interface copy and a non-editable island inside nothing editable is too.
    expect(panel.querySelector('#note')?.getAttribute('placeholder')).toBe('Search')
    expect(panel.querySelector('#locked')?.textContent).toBe('Export')
  })

  it('restores the original text and attributes when the plugin is cleared', async () => {
    const h = await harness()
    const panel = mountPanel('dsh-cad', `<p id="hint">${HINT}</p><button id="export" title="${EXPORT}">${EXPORT}</button>`)
    h.state.consent = { global: false, packages: ['dsh-cad'] }
    await h.client.refresh()
    await settle()
    expect(panel.querySelector('#hint')?.textContent).not.toBe(HINT)
    await h.client.clear('dsh-cad')
    await settle()
    expect(panel.querySelector('#hint')?.textContent).toBe(HINT)
    expect(panel.querySelector('#export')?.textContent).toBe(EXPORT)
    expect(panel.querySelector('#export')?.getAttribute('title')).toBe(EXPORT)
    // Nothing is replaced again, and a plugin that renders new text afterwards stays as written.
    const calls = h.face.translateStrings.mock.calls.length
    panel.querySelector('#hint')!.textContent = HINT
    await settle()
    expect(panel.querySelector('#hint')?.textContent).toBe(HINT)
    expect(h.face.translateStrings).toHaveBeenCalledTimes(calls)
  })

  it('translates a plugin re-render with the same source text again, without a flicker loop', async () => {
    const h = await harness()
    const panel = mountPanel('dsh-cad', `<p id="hint">${HINT}</p>`)
    h.state.consent = { global: false, packages: ['dsh-cad'] }
    await h.client.refresh()
    await settle()
    const translated = 'The model area is empty - describe a part in the chat'
    const hint = panel.querySelector('#hint') as HTMLElement
    expect(hint.textContent).toBe(translated)
    let records = 0
    const counter = new MutationObserver((batch) => { records += batch.length })
    counter.observe(panel, { childList: true, subtree: true, characterData: true, attributes: true })
    const requests = h.face.translateStrings.mock.calls.length
    // The plugin re-renders three times by replacing the node, and three times by rewriting its data.
    for (let round = 0; round < 3; round++) {
      hint.textContent = HINT
      await vi.advanceTimersByTimeAsync(0)
      expect(hint.textContent).toBe(translated)
      ;(hint.firstChild as Text).data = HINT
      await vi.advanceTimersByTimeAsync(0)
      expect(hint.textContent).toBe(translated)
    }
    // The plugin's write plus one write of ours per re-render; replacing a node also records the removal and the addition.
    const afterRenders = records + counter.takeRecords().length
    expect(afterRenders).toBeLessThanOrEqual(6 * 3)
    // Nothing moves afterwards, and the cache answers without another request.
    await settle()
    expect(records + counter.takeRecords().length).toBe(afterRenders)
    expect(h.face.translateStrings).toHaveBeenCalledTimes(requests)
    counter.disconnect()
  })

  it('translates text a plugin adds after consent and strings that arrive in one request', async () => {
    const h = await harness()
    const panel = mountPanel('dsh-cad', '<p id="a">首页</p>')
    h.state.consent = { global: false, packages: ['dsh-cad'] }
    await h.client.refresh()
    await settle()
    panel.insertAdjacentHTML('beforeend', `<p id="b">${EXPORT}</p><p id="c">搜索</p><p id="d">取消</p>`)
    await settle()
    expect(panel.querySelector('#b')?.textContent).toBe('Export')
    expect(panel.querySelector('#c')?.textContent).toBe('Search')
    expect(panel.querySelector('#d')?.textContent).toBe('Cancel')
    // Three strings added in one pass travel in one request; the one without a translation stays as written.
    expect(h.face.translateStrings.mock.calls.at(-1)?.[0]).toEqual([EXPORT, '搜索', '取消'])
    expect(panel.querySelector('#a')?.textContent).toBe('首页')
  })

  it('translates the owner marker of a panel that mounts later, and ignores one unmounted meanwhile', async () => {
    const h = await harness()
    h.state.consent = { global: false, packages: ['dsh-cad'] }
    await h.client.refresh()
    const later = mountPanel('dsh-cad', `<p>${EXPORT}</p>`)
    await settle()
    expect(later.textContent).toBe('Export')
    later.remove()
    await settle()
    expect(later.textContent).toBe('Export')
  })

  it('translates the strings again on Run again and applies the new translation', async () => {
    const h = await harness()
    const panel = mountPanel('dsh-cad', `<p>${EXPORT}</p>`)
    h.state.consent = { global: false, packages: ['dsh-cad'] }
    await h.client.refresh()
    await settle()
    expect(panel.textContent).toBe('Export')
    h.state.translations[EXPORT] = 'Export model'
    void h.client.translate('dsh-cad', true)
    await settle()
    expect(h.face.translateStrings.mock.calls.at(-1)).toEqual([[EXPORT], 'en', 'dsh-cad', true])
    expect(panel.textContent).toBe('Export model')
  })

  it('lists what the Host stored for the package and survives a restart of the page', async () => {
    const h = await harness()
    const panel = mountPanel('dsh-cad', `<p>${EXPORT}</p>`)
    h.state.consent = { global: false, packages: ['dsh-cad'] }
    h.state.stored = { 'dsh-cad': [EXPORT, '搜索'] }
    await h.client.refresh()
    // The stored translation is applied at once, without asking the Host again.
    expect(panel.textContent).toBe('Export')
    expect(h.face.translateStrings).not.toHaveBeenCalled()
    expect(h.client.getSnapshot().screen['dsh-cad']).toEqual([
      { source: EXPORT, text: 'Export' }, { source: '搜索', text: 'Search' },
    ])
  })

  it('shows why on-screen translation failed and stops asking', async () => {
    const h = await harness()
    mountPanel('dsh-cad', `<p>${EXPORT}</p>`)
    h.state.consent = { global: false, packages: ['dsh-cad'] }
    h.face.translateStrings.mockImplementation(() => Promise.resolve({ ok: false as const, error: new Error('model offline') }))
    await h.client.refresh()
    await settle()
    expect(h.client.getSnapshot().failures).toEqual({ 'dsh-cad': 'model offline' })
    await settle()
    expect(h.face.translateStrings).toHaveBeenCalledTimes(1)
  })

  it('puts the originals back when the language changes', async () => {
    const h = await harness()
    const panel = mountPanel('dsh-cad', `<p>${EXPORT}</p>`)
    h.state.consent = { global: false, packages: ['dsh-cad'] }
    await h.client.refresh()
    await settle()
    expect(panel.textContent).toBe('Export')
    h.locale.setLocale('zh')
    h.client.localeChanged()
    // The Han text suits a Chinese UI, so it stays as the plugin wrote it.
    await settle()
    expect(panel.textContent).toBe(EXPORT)
  })

  it('restores everything and stops observing on dispose', async () => {
    const h = await harness()
    const panel = mountPanel('dsh-cad', `<p>${EXPORT}</p>`)
    h.state.consent = { global: false, packages: ['dsh-cad'] }
    await h.client.refresh()
    await settle()
    h.client.dispose()
    expect(panel.textContent).toBe(EXPORT)
    panel.insertAdjacentHTML('beforeend', '<p>搜索</p>')
    await settle()
    expect(panel.textContent).toBe(`${EXPORT}搜索`)
  })

  it('translates the name, description, and settings the Plugins page shows about a consented plugin, and only that plugin', async () => {
    const h = await harness()
    const page = document.createElement('div')
    page.innerHTML = [
      `<li data-plugin-package="dsh-cad"><h3>${EXPORT}</h3><p>搜索</p><code>dsh-cad</code></li>`,
      '<div data-plugin-detail="dsh-cad"><label>取消</label><input placeholder="搜索"></div>',
      `<div data-plugin-row-detail="dsh-cad#viewer"><span id="row">${EXPORT}</span></div>`,
      `<li data-plugin-package="other-plugin"><h3 id="other">${EXPORT}</h3></li>`,
      `<li data-translation-package="dsh-cad"><span id="tab" lang="und">${EXPORT}</span></li>`,
    ].join('')
    document.body.append(page)
    h.state.consent = { global: false, packages: ['dsh-cad'] }
    await h.client.refresh()
    await settle()
    expect(page.querySelector('li[data-plugin-package="dsh-cad"]')?.textContent).toBe('ExportSearchdsh-cad')
    expect(page.querySelector('[data-plugin-detail] label')?.textContent).toBe('Cancel')
    expect(page.querySelector('[data-plugin-detail] input')?.getAttribute('placeholder')).toBe('Search')
    expect(page.querySelector('#row')?.textContent).toBe('Export')
    // Another plugin's card and the Translations tab's own listing of source text stay as written.
    expect(page.querySelector('#other')?.textContent).toBe(EXPORT)
    expect(page.querySelector('#tab')?.textContent).toBe(EXPORT)
    await h.client.clear('dsh-cad')
    await settle()
    expect(page.querySelector('li[data-plugin-package="dsh-cad"] h3')?.textContent).toBe(EXPORT)
    expect(page.querySelector('#row')?.textContent).toBe(EXPORT)
  })
})
