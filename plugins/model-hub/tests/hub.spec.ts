// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import * as primitives from '@janhq/jan-client-ui-primitives'
import type * as ReactAPI from 'react'
import { afterEach, expect, it, vi } from 'vitest'

const React: typeof ReactAPI = createRequire(import.meta.resolve('@testing-library/react'))('react')
const source = readFileSync(join(import.meta.dirname, '../client.js'), 'utf8')

function row(model_name: string, developer: string, downloads: number, file: string, file_size: string, options = {}) {
  return { model_name, developer, downloads, ...options, quants: [{ file_size, path: `https://huggingface.co/${developer}/${model_name}/resolve/main/${file}.gguf` }] }
}

const catalog = [
  row('Gemma-GGUF', 'Google', 60, 'gemma-Q8_0', '4 GB', { createdAt: '2024-02-21', tools: true }),
  row('Qwen3-Coder-GGUF', 'Alibaba', 40, 'qwen3-coder-IQ2_XXS', '1.2 GB', { createdAt: '2025-01-01', tools: true }),
  row('Llama-GGUF', 'Meta', 30, 'llama-Q4_K_M', '900 MB', { createdAt: '2024-07-23', num_mmproj: 1 }),
]

function mount(local = {}, remote = {}, fetch: (url: string) => Promise<unknown> = async () => ({ ok: true, json: async () => catalog })) {
  type Source = { subscribe: (listener: () => void) => () => void; getSnapshot: () => unknown }
  type PanelProps = { t: typeof t; useLocal: () => unknown; runAction: (kind: string, target: object) => Promise<void> }
  let panel!: ReactAPI.ComponentType<PanelProps>
  let props!: { hooks: { local: Source }; runAction: PanelProps['runAction'] }
  let optionRow!: ReactAPI.ComponentType<{ dismiss: () => void; sessionId?: string; t: typeof t }>
  let panelInfo = { activePanelId: null as string | null }
  const panelListeners = new Set<() => void>()
  const selectPanel = vi.fn((id: string | null) => {
    panelInfo = { activePanelId: id }
    for (const listener of panelListeners) listener()
  })
  const openSession = vi.fn()
  // The workspace reports the Session it opened, as ui-workspace does just before selecting it.
  const startSession = vi.fn((_workspace?: string, options?: { onOpen?: (id: string) => void }) => { options?.onOpen?.('s2') })
  const selectModel = vi.fn(async () => ({ ok: true }))
  const updates: Array<(next: object) => void> = []
  let copy: Record<string, string>
  const t = (key: string, values: Record<string, unknown> = {}) => (copy[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => String(values[name]))
  const state = { models: [], downloads: [], catalog: [], provider: 'local', ...local }
  const scope = {
    layout: {
      selectPanel,
      panelInfo: { getSnapshot: () => panelInfo, subscribe: (listener: () => void) => { panelListeners.add(listener); return () => panelListeners.delete(listener) } },
    },
    sessions: { list: { getSnapshot: () => ({ byId: { s1: { id: 's1' } } }), subscribe: () => () => {} } },
    uiWorkspace: { openSession, startSession },
    'remote.session': { selectModel },
    locale: { register: (_: string, translations: { en: Record<string, string> }) => { copy = translations.en }, bind: () => t },
    effect: (run: () => void) => run(),
    remote: { session: { selectModel }, llamaCpp: { async *follow() {
      yield state
      // Later feed states come from the test through `update`.
      while (true) yield await new Promise<object>((resolve) => { updates.push(resolve) })
    }, ...remote } },
    slots: {
      inject: (_: string, run: () => void) => run(),
      register: (options: { name: string; inject?: () => typeof props }, component: typeof panel) => {
        if (options.name === 'conversation.input.model.options') optionRow = component as never
        if (options.name !== 'main' || options.inject === undefined) return
        panel = component
        props = options.inject()
      },
    },
  }
  runInNewContext(source, {
    window: {
      addEventListener() {},
      __ModuleLoader__: { load: ({ factory }: { factory: (require: (id: string) => unknown) => { apply: (ctx: object) => void } }) => {
        const plugin = factory(id => id === 'react' ? React : primitives)
        plugin.apply({ ...scope, inject: (_: string[], apply: (injected: object) => void) => apply(scope) })
      } },
    },
    setTimeout: () => 0, clearTimeout: () => {}, document, sessionStorage, AbortController,
    fetch,
  })
  const localSource = props.hooks.local
  render(React.createElement(panel, { t, runAction: props.runAction, useLocal: () => React.useSyncExternalStore(localSource.subscribe, localSource.getSnapshot) }))
  const update = async (next: object) => { await act(async () => { updates.shift()?.({ ...state, ...next }) }) }
  return { optionRow, selectPanel, openSession, startSession, selectModel, update, runAction: props.runAction, t }
}

const names = () => screen.getAllByRole('heading', { level: 2 }).map(element => element.textContent)
const search = (value: string) => { fireEvent.change(screen.getByRole('searchbox'), { target: { value } }) }
const allModels = () => { fireEvent.click(screen.getByRole('tab', { name: 'All models' })) }

afterEach(() => {
  cleanup()
  document.querySelector('style[data-plugin="@janhq/jan-model-hub"]')?.remove()
})

it('draws each publisher’s Hugging Face picture once per account and keeps the monogram otherwise', async () => {
  const avatar = (owner: string) => `https://cdn-avatars.huggingface.co/v1/production/uploads/${owner}.png`
  const reply = (status: number, body: unknown = {}) => ({ ok: status < 400, status, json: async () => body })
  const fetch = vi.fn(async (url: string) => {
    if (url.includes('model_catalog')) return reply(200, catalog)
    if (url.endsWith('/organizations/Google/avatar')) return reply(200, { avatarUrl: avatar('google') })
    if (url.endsWith('/users/Alibaba/avatar')) return reply(200, { avatarUrl: avatar('alibaba') })
    // A default picture reads worse than the monogram.
    if (url.endsWith('/users/Meta/avatar')) return reply(200, { avatarUrl: 'https://huggingface.co/avatars/0f40.svg' })
    return reply(404)
  })
  mount({}, {}, fetch)
  await waitFor(() => expect(document.querySelectorAll(`img[src="${avatar('alibaba')}"]`).length).toBeGreaterThan(0))
  expect(document.querySelectorAll(`img[src="${avatar('google')}"]`).length).toBeGreaterThan(1)
  const lookups = fetch.mock.calls.map(([url]) => url).filter(url => url.includes('/avatar'))
  expect(lookups.sort()).toEqual([
    'https://huggingface.co/api/organizations/Alibaba/avatar', 'https://huggingface.co/api/organizations/Google/avatar',
    'https://huggingface.co/api/organizations/Meta/avatar', 'https://huggingface.co/api/users/Alibaba/avatar',
    'https://huggingface.co/api/users/Meta/avatar',
  ])
  expect([...document.querySelectorAll('img')].some(image => image.getAttribute('src')?.includes('/avatars/'))).toBe(false)
})

it('ranks partial and mistyped names and finds developers and quant files', async () => {
  mount()
  allModels()
  await screen.findByRole('heading', { name: 'Qwen3-Coder' })
  for (const query of ['qwe', 'qwn coder', 'alibaba', 'iq2_xxs']) {
    search(query)
    expect(names()).toEqual(['Qwen3-Coder'])
  }
})

it('sorts by downloads, size, name and catalog creation date', async () => {
  mount()
  allModels()
  await screen.findByRole('heading', { name: 'Gemma' })
  expect(names()).toEqual(['Gemma', 'Qwen3-Coder', 'Llama'])
  for (const [label, order] of [
    ['Smallest size', ['Llama', 'Qwen3-Coder', 'Gemma']],
    ['Name', ['Gemma', 'Llama', 'Qwen3-Coder']],
    ['Recently added', ['Qwen3-Coder', 'Llama', 'Gemma']],
  ] as const) {
    fireEvent.click(screen.getByRole('button', { name: /^Sort:/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: label }))
    expect(names()).toEqual(order)
  }
})

it('combines filters, counts results and clears an empty search', async () => {
  mount({ models: [{ id: 'qwen', name: 'qwen3-coder-IQ2_XXS', repo: 'Alibaba/Qwen3-Coder-GGUF', active: false }] })
  allModels()
  await screen.findByRole('heading', { name: 'Qwen3-Coder' })
  fireEvent.click(screen.getByRole('button', { name: 'Tools' }))
  fireEvent.click(screen.getByRole('button', { name: 'Installed' }))
  expect(screen.getByText('1 result')).toBeTruthy()
  expect(names()).toEqual(['Qwen3-Coder'])
  expect(screen.getByRole('button', { name: 'Use' })).toBeTruthy()
  search('zzzzzz')
  expect(screen.getByText('0 results')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
  expect(names()).toEqual(['Gemma', 'Qwen3-Coder', 'Llama'])
})

it('does not take another repository\'s file with the same name for an installed variant', async () => {
  mount({ models: [{ id: 'qwen-2', name: 'qwen3-coder-IQ2_XXS', repo: 'Someone/Qwen3-Coder-GGUF', active: false }] })
  allModels()
  await screen.findByRole('heading', { name: 'Qwen3-Coder' })
  fireEvent.click(screen.getByRole('button', { name: 'Installed' }))
  expect(screen.getByText('No matching models')).toBeTruthy()
})

it('filters against host memory when hardware is available', async () => {
  mount({ hardware: { memoryBytes: 3e9, backend: 'cpu', devices: [] } })
  allModels()
  await screen.findByRole('heading', { name: 'Gemma' })
  fireEvent.click(screen.getByRole('button', { name: 'Fits this computer' }))
  expect(names()).toEqual(['Qwen3-Coder', 'Llama'])
})

it('shows progress and pauses or cancels a transfer from its card', async () => {
  const pauseDownload = vi.fn(async () => ({ ok: true }))
  const cancelDownload = vi.fn(async () => ({ ok: true }))
  mount({ downloads: [{ id: 'qwen', name: 'qwen3-coder-IQ2_XXS', repo: 'Alibaba/Qwen3-Coder-GGUF', progress: { receivedBytes: 500e6, totalBytes: 1e9, bytesPerSecond: 42e6 } }] }, { pauseDownload, cancelDownload })
  allModels()
  const card = (await screen.findByRole('heading', { name: 'Qwen3-Coder' })).closest('li')!
  expect(within(card).getByRole('progressbar').getAttribute('value')).toBe('50')
  // 500 MB left at 42 MB/s: 11.9 s, rounded up so it never reads 0 before the end.
  expect(within(card).getByText(/^42 MB\/s · 12 s(ec)? left$/)).toBeTruthy()
  await act(async () => { fireEvent.click(within(card).getByRole('button', { name: 'Pause' })) })
  expect(pauseDownload).toHaveBeenCalledWith('qwen')
  fireEvent.click(await within(card).findByRole('button', { name: 'Cancel download' }))
  const dialog = screen.getByRole('dialog')
  fireEvent.click(within(dialog).getByRole('checkbox'))
  fireEvent.click(within(dialog).getByRole('button', { name: 'Discard file' }))
  await waitFor(() => expect(cancelDownload).toHaveBeenCalledWith('qwen'))
})

it('opens on Explore: features fitting models and leads each shelf into the filtered list', async () => {
  mount({ hardware: { memoryBytes: 3e9, backend: 'cpu', devices: [] } })
  const featured = await screen.findByRole('region', { name: 'Featured' })
  expect(within(featured).getByRole('heading', { level: 2 }).textContent).toBe('Qwen3-Coder')
  fireEvent.click(within(featured).getByRole('button', { name: 'Next' }))
  expect(within(featured).getByRole('heading', { level: 2 }).textContent).toBe('Llama')
  expect(within(screen.getByRole('region', { name: 'Runs well on this computer' })).queryByText('Gemma')).toBeNull()
  fireEvent.click(within(screen.getByRole('region', { name: 'Can use tools' })).getByRole('button', { name: 'See all' }))
  expect(screen.getByRole('tab', { name: 'All models' }).getAttribute('aria-selected')).toBe('true')
  expect(screen.getByRole('button', { name: 'Tools' }).getAttribute('aria-pressed')).toBe('true')
  expect(names()).toEqual(['Gemma', 'Qwen3-Coder'])
})

it('features Jan\'s own models first, even when others are more popular', async () => {
  const withJan = [...catalog, row('Jan-v3-GGUF', 'Menlo', 1, 'jan-v3-Q4_K_M', '2 GB'), row('Jan-nano-GGUF', 'janhq', 2, 'jan-nano-Q4_K_M', '20 GB')]
  mount({ hardware: { memoryBytes: 3e9, backend: 'cpu', devices: [] } }, {}, async () => ({ ok: true, json: async () => withJan }))
  const featured = await screen.findByRole('region', { name: 'Featured' })
  const titles = []
  for (let i = 0; i < 4; i++) {
    titles.push(within(featured).getByRole('heading', { level: 2 }).textContent)
    fireEvent.click(within(featured).getByRole('button', { name: 'Next' }))
  }
  expect(titles).toEqual(['Jan-nano', 'Jan-v3', 'Qwen3-Coder', 'Llama'])
})

it('downloads from a tile\'s details and searches from Explore into the full list', async () => {
  const downloadRepoFile = vi.fn(async () => ({ ok: true }))
  mount({}, { downloadRepoFile })
  const shelf = await screen.findByRole('region', { name: 'Understands images' })
  fireEvent.click(within(shelf).getByRole('button', { name: /Llama/ }))
  const dialog = screen.getByRole('dialog', { name: 'Llama' })
  await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Download' })) })
  expect(downloadRepoFile).toHaveBeenCalledWith('Meta/Llama-GGUF', 'llama-Q4_K_M.gguf')
  fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
  search('gemma')
  expect(names()).toEqual(['Gemma'])
})

it('closes the model menu and opens the Hub from Get local models', async () => {
  const { optionRow, selectPanel, t } = mount()
  await screen.findByRole('heading', { name: 'Gemma' })
  cleanup()
  const dismiss = vi.fn()
  render(React.createElement(optionRow, { dismiss, t }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'Get local models' }))
  expect(dismiss).toHaveBeenCalledOnce()
  expect(selectPanel).toHaveBeenCalledWith('jan-model-hub')
})

// Opens the Hub from the model menu of chat s1, as a user does from that chat's composer.
function openFromChat(optionRow: ReturnType<typeof mount>['optionRow'], t: ReturnType<typeof mount>['t']) {
  render(React.createElement(optionRow, { dismiss: () => {}, sessionId: 's1', t }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'Get local models' }))
}

it('returns to the chat that opened the Hub when a model is used', async () => {
  const setDefaultModel = vi.fn(async () => ({ ok: true }))
  const b = mount({ phase: 'running', model: { id: 'gemma' } }, { setDefaultModel })
  openFromChat(b.optionRow, b.t)
  await act(async () => { await b.runAction('use', { id: 'gemma' }) })
  expect(setDefaultModel).toHaveBeenCalledWith('gemma')
  expect(b.openSession).toHaveBeenCalledWith('s1')
  expect(b.selectModel).toHaveBeenCalledWith({ sessionId: 's1', provider: 'local', model: 'gemma' })
  expect(b.startSession).not.toHaveBeenCalled()
})

it('stays in the Hub when the clicked model has not started', async () => {
  const b = mount({ phase: 'failed', error: 'out of memory', model: { id: 'gemma' } }, { setDefaultModel: vi.fn(async () => ({ ok: true })) })
  openFromChat(b.optionRow, b.t)
  await expect(b.runAction('use', { id: 'gemma' })).rejects.toThrow('out of memory')
  expect(b.openSession).not.toHaveBeenCalled()
  expect(b.selectModel).not.toHaveBeenCalled()
})

it('opens a new chat on Use when the Hub was opened from the sidebar', async () => {
  const b = mount({ phase: 'running', model: { id: 'gemma' } }, { setDefaultModel: vi.fn(async () => ({ ok: true })) })
  act(() => { b.selectPanel('jan-model-hub') })
  await act(async () => { await b.runAction('use', { id: 'gemma' }) })
  expect(b.startSession).toHaveBeenCalledOnce()
  expect(b.openSession).not.toHaveBeenCalled()
  expect(b.selectModel).toHaveBeenCalledWith({ sessionId: 's2', provider: 'local', model: 'gemma' })
})

it('switches the asking chat to a downloaded model once it is installed', async () => {
  const setDefaultModel = vi.fn(async () => ({ ok: true }))
  const downloadRepoFile = vi.fn(async () => ({ ok: true, value: 'llama' }))
  const b = mount({}, { setDefaultModel, downloadRepoFile })
  openFromChat(b.optionRow, b.t)
  await act(async () => { await b.runAction('download', { repo: 'Meta/Llama-GGUF', file: 'llama-Q4_K_M.gguf', name: 'llama-Q4_K_M' }) })
  expect(b.openSession).toHaveBeenCalledWith('s1')
  expect(b.selectPanel).toHaveBeenLastCalledWith(null)
  await b.update({ downloads: [{ id: 'llama', name: 'llama-Q4_K_M', repo: 'Meta/Llama-GGUF', progress: { receivedBytes: 1, totalBytes: 2 } }] })
  expect(setDefaultModel).not.toHaveBeenCalled()
  await b.update({ phase: 'running', model: { id: 'llama' }, downloads: [], models: [{ id: 'llama', name: 'llama-Q4_K_M', repo: 'Meta/Llama-GGUF' }] })
  await waitFor(() => expect(b.selectModel).toHaveBeenCalledWith({ sessionId: 's1', provider: 'local', model: 'llama' }))
  expect(setDefaultModel).toHaveBeenCalledWith('llama')
})

it('switches the asking chat when the download finishes before the feed reports it', async () => {
  const setDefaultModel = vi.fn(async () => ({ ok: true }))
  const downloadRepoFile = vi.fn(async () => ({ ok: true, value: 'llama' }))
  const b = mount({}, { setDefaultModel, downloadRepoFile })
  openFromChat(b.optionRow, b.t)
  await act(async () => { await b.runAction('download', { repo: 'Meta/Llama-GGUF', file: 'llama-Q4_K_M.gguf', name: 'llama-Q4_K_M' }) })
  await b.update({ phase: 'running', model: { id: 'llama' }, downloads: [], models: [{ id: 'llama', name: 'llama-Q4_K_M', repo: 'Meta/Llama-GGUF' }] })
  await waitFor(() => expect(b.selectModel).toHaveBeenCalledWith({ sessionId: 's1', provider: 'local', model: 'llama' }))
})
