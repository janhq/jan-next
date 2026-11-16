// @vitest-environment jsdom
/** The web search and fetch page as the Plugins page renders it: two provider menus and the selected providers' descriptions. */

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsFormShell } from '@deepseek-ai/dsh-client-ui-primitives'
import { WebSearchCard, type WebSearchCardProps } from '../src/client/WebSearchCard.tsx'
import type { WebProviderOption, WebSearchCardState } from '../src/client/web-search-card-controller.ts'
import { en, zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t = ((key: keyof typeof en, params?: Record<string, unknown>) =>
  en[key].replace(/\{(\w+)\}/g, (match, name: string) => params !== undefined && name in params ? String(params[name]) : match)) as WebSearchCardProps['t']

const settled: SettingsFormShell = { available: true, writable: true, dirty: false, invalid: false, saving: false, failed: false }

/** Each provider's registered description; the page shows the active language's entry. */
const DESCRIPTIONS: Record<string, { en: string; zh: string }> = {
  'exa': { en: 'Exa search.', zh: 'Exa 搜索' },
  'http': { en: 'Direct fetch description.', zh: '本机获取说明' },
}

function options(...ids: string[]): WebProviderOption[] {
  return ids.map(id => ({
    id, ...id === 'exa' ? { title: 'Exa' } : {}, ...DESCRIPTIONS[id] === undefined ? {} : { description: DESCRIPTIONS[id] }, missing: false,
  }))
}

/** Menu entries as the controller orders them. */
const SEARCH_OPTIONS = options('exa', 'brave')
const FETCH_OPTIONS = options('http', 'jina')

/** The locale service's resolution, with Chinese active. */
const resolveText = vi.fn((text: string | { en: string; [locale: string]: string }) => typeof text === 'string' ? text : text.zh ?? text.en)

/** Exa search with local fetch. */
function shipped(): WebSearchCardState {
  return {
    ...settled,
    selectionBlocked: false,
    providersFailed: false,
    search: { selected: 'exa', options: SEARCH_OPTIONS, kind: 'plugin', auto: false },
    fetch: { selected: 'http', options: FETCH_OPTIONS, kind: 'local', auto: false },
  }
}

function cardActions() {
  return { selectProvider: vi.fn(), retryProviders: vi.fn(), save: vi.fn(), discard: vi.fn() }
}

function renderPage(state: WebSearchCardState = shipped(), view: 'page' | 'summary' = 'page') {
  const store = createSnapshotStore<WebSearchCardState>(state)
  const actions = cardActions()
  const props = { ...actions, view, t, resolveText, useWebSearchCard: bindSnapshotSelector(store) } as WebSearchCardProps
  render(<WebSearchCard {...props} />)
  return { actions, store }
}

/** The provider menus, named by their section title followed by the selected provider. */
const searchMenu = () => screen.getByRole('button', { name: new RegExp(`^${en.searchSection} `) })
const fetchMenu = () => screen.getByRole('button', { name: new RegExp(`^${en.fetchSection} `) })
const region = (name: string) => within(screen.getByRole('region', { name }))
/** The text of every paragraph in a section, in order. */
const paragraphs = (name: string) => [...screen.getByRole('region', { name }).querySelectorAll('p')].map(node => node.textContent)

describe('WebSearchCard', () => {
  it('renders its one-liner alone in the summary view', () => {
    renderPage(shipped(), 'summary')
    expect(document.body.textContent).toBe(en.description)
  })

  it('titles the page and its two sections by the provider each one picks', () => {
    renderPage()
    expect(en.title).toBe('Web search and fetch')
    expect(zh.title).toBe('网页搜索与获取')
    expect([en.searchSection, en.fetchSection]).toEqual(['Web search provider', 'Web fetch provider'])
    expect([zh.searchSection, zh.fetchSection]).toEqual(['网页搜索提供方', '网页获取提供方'])
    expect(screen.getByRole('heading', { name: en.searchSection })).toBeTruthy()
    expect(screen.getByRole('heading', { name: en.fetchSection })).toBeTruthy()
    expect(screen.getByRole('region', { name: en.searchSection })).toBeTruthy()
    expect(screen.getByRole('region', { name: en.fetchSection })).toBeTruthy()
  })

  it('names each provider menu by its section title and the selected provider, with no label of its own', () => {
    renderPage()
    expect(searchMenu().getAttribute('aria-labelledby')).toBe('plugin-config-web-search-section plugin-config-web-search-provider-value')
    expect(screen.getByRole('button', { name: `${en.searchSection} Exa` })).toBe(searchMenu())
    expect(screen.getByRole('button', { name: `${en.fetchSection} ${en.providerLocal}` })).toBe(fetchMenu())
    for (const title of [en.searchSection, en.fetchSection]) expect(screen.getAllByText(title)).toHaveLength(1)
    expect(document.querySelectorAll('label[for="plugin-config-web-search-provider"], label[for="plugin-config-web-fetch-provider"]')).toHaveLength(0)
  })

  it('shows no settings fields for any provider', () => {
    renderPage()
    expect(screen.queryByRole('textbox')).toBeNull()
    // The Fetch section holds only its title and provider menu block.
    expect(screen.getByRole('region', { name: en.fetchSection }).children).toHaveLength(2)
  })

  it('selects a provider from the menu and leaves the current one alone', () => {
    const { actions } = renderPage()
    fireEvent.click(searchMenu())
    expect(searchMenu().getAttribute('aria-expanded')).toBe('true')
    expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual(['Exa', 'brave'])
    fireEvent.click(screen.getByRole('menuitem', { name: 'Exa' }))
    expect(screen.queryByRole('menuitem')).toBeNull()
    fireEvent.click(fetchMenu())
    expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual([en.providerLocal, 'jina'])
    fireEvent.click(screen.getByRole('menuitem', { name: en.providerLocal }))
    expect(actions.selectProvider).not.toHaveBeenCalled()
    fireEvent.click(fetchMenu())
    fireEvent.click(screen.getByRole('menuitem', { name: 'jina' }))
    expect(actions.selectProvider).toHaveBeenLastCalledWith('fetchProvider', 'jina')
    expect(actions.save).not.toHaveBeenCalled()
  })

  it('shows each selected provider’s registered description as plain text, with no action of its own', () => {
    renderPage()
    expect(region(en.fetchSection).getByText('本机获取说明').tagName).toBe('P')
    expect(region(en.fetchSection).queryAllByRole('button').map(button => button.id)).toEqual(['plugin-config-web-fetch-provider'])
    expect(resolveText).toHaveBeenCalledWith(DESCRIPTIONS.http)
  })

  it('shows a plugin provider’s description before the pointer to its own settings, and nothing for a provider without one', () => {
    const base = shipped()
    renderPage({
      ...base,
      fetch: { ...base.fetch, selected: 'jina', kind: 'plugin', options: [{ id: 'jina', description: { en: 'Jina.', zh: '' }, missing: false }] },
    })
    expect(paragraphs(en.searchSection)).toEqual(['Exa 搜索', en.pluginProviderHint])
    // An empty translation shows no paragraph.
    expect(paragraphs(en.fetchSection)).toEqual([en.pluginProviderHint])
  })

  it('closes an open menu without selecting on Escape', () => {
    const { actions } = renderPage()
    fireEvent.click(searchMenu())
    fireEvent.keyDown(screen.getAllByRole('menuitem')[0]!, { key: 'Escape' })
    expect(screen.queryByRole('menuitem')).toBeNull()
    expect(actions.selectProvider).not.toHaveBeenCalled()
  })

  it('names plugin providers by title or id, and marks a selection the Host does not register', () => {
    const base = shipped()
    renderPage({
      ...base,
      search: {
        selected: 'perplexity', kind: 'none', auto: false,
        options: [...SEARCH_OPTIONS, { id: 'perplexity', missing: true }],
      },
      fetch: { ...base.fetch, selected: 'jina', kind: 'plugin' },
    })
    expect(searchMenu().textContent).toBe('perplexity (not loaded)')
    expect(zh.providerMissing).toBe('{id}（未加载）')
    expect(fetchMenu().textContent).toBe('jina')
    expect(screen.getAllByText(en.pluginProviderHint)).toHaveLength(1)
    fireEvent.click(searchMenu())
    expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual(['Exa', 'brave', 'perplexity (not loaded)'])
  })

  it('explains a plugin Search provider and an unselected Fetch provider', () => {
    renderPage({ ...shipped(), fetch: { selected: '', kind: 'none', auto: false, options: [] } })
    expect(searchMenu().textContent).toBe('Exa')
    expect(fetchMenu().textContent).toBe(en.providerAuto)
    expect(screen.getByText(en.pluginProviderHint)).toBeTruthy()
  })

  it('offers automatic selection where the deployment composes no provider', () => {
    const base = shipped()
    const { actions } = renderPage({
      ...base,
      search: { ...base.search, auto: true },
      fetch: { ...base.fetch, selected: '', kind: 'none', auto: true },
    })
    expect(fetchMenu().textContent).toBe(en.providerAuto)
    fireEvent.click(searchMenu())
    expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual([en.providerAuto, 'Exa', 'brave'])
    fireEvent.click(screen.getByRole('menuitem', { name: en.providerAuto }))
    expect(actions.selectProvider).toHaveBeenCalledWith('searchProvider', '')
    fireEvent.click(fetchMenu())
    fireEvent.click(screen.getByRole('menuitem', { name: en.providerAuto }))
    expect(actions.selectProvider).toHaveBeenCalledTimes(1)
  })

  it('reports a failed provider list read in each section and retries it', () => {
    const { actions } = renderPage({ ...shipped(), providersFailed: true })
    for (const name of [en.searchSection, en.fetchSection]) {
      expect(region(name).getByRole('status').textContent).toBe(`${en.providersFailed}${en.retry}`)
      fireEvent.click(region(name).getByRole('button', { name: en.retry }))
    }
    expect(zh.providersFailed).toBe('无法读取提供方列表，此菜单可能不完整')
    expect(actions.retryProviders).toHaveBeenCalledTimes(2)
    expect(searchMenu().textContent).toBe('Exa')
  })

  it('shows no provider list notice while the list read succeeds', () => {
    renderPage()
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByRole('button', { name: en.retry })).toBeNull()
  })

  it('disables the menus while the settings document is read-only', () => {
    renderPage({ ...shipped(), writable: false })
    expect(searchMenu()).toHaveProperty('disabled', true)
    expect(fetchMenu()).toHaveProperty('disabled', true)
  })

  it.each([{ invalid: true }, { failed: true }])('locks every menu while an error must stay visible: %j', (state) => {
    renderPage({ ...shipped(), ...state, selectionBlocked: true })
    expect(searchMenu()).toHaveProperty('disabled', true)
    expect(fetchMenu()).toHaveProperty('disabled', true)
    fireEvent.click(searchMenu())
    expect(screen.queryByRole('menuitem')).toBeNull()
    expect(searchMenu().getAttribute('aria-expanded')).toBe('false')
  })

  it('closes an open menu and reports it collapsed when the menus lock', () => {
    const { store } = renderPage()
    fireEvent.click(searchMenu())
    expect(screen.getAllByRole('menuitem')).toHaveLength(2)
    act(() => { store.set({ ...shipped(), invalid: true, selectionBlocked: true }) })
    expect(screen.queryByRole('menuitem')).toBeNull()
    expect(searchMenu().getAttribute('aria-expanded')).toBe('false')
  })
})
