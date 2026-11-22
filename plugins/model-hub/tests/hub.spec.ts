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

function mount(local = {}, remote = {}) {
  type Source = { subscribe: (listener: () => void) => () => void; getSnapshot: () => unknown }
  type PanelProps = { t: typeof t; useLocal: () => unknown; runAction: (kind: string, target: object) => Promise<void> }
  let panel!: ReactAPI.ComponentType<PanelProps>
  let props!: { hooks: { local: Source }; runAction: PanelProps['runAction'] }
  let optionRow!: ReactAPI.ComponentType<{ dismiss: () => void; t: typeof t }>
  const selectPanel = vi.fn()
  let copy: Record<string, string>
  const t = (key: string, values: Record<string, unknown> = {}) => (copy[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => String(values[name]))
  const state = { models: [], downloads: [], catalog: [], provider: 'local', ...local }
  const scope = {
    layout: { selectPanel },
    locale: { register: (_: string, translations: { en: Record<string, string> }) => { copy = translations.en }, bind: () => t },
    effect: (run: () => void) => run(),
    remote: { llamaCpp: { async *follow() { yield state }, ...remote } },
    slots: {
      inject: (_: string, run: () => void) => run(),
      register: (options: { name: string; inject?: () => typeof props }, component: typeof panel) => {
        if (options.name === 'conversation.input.model.options') optionRow = component as unknown as typeof optionRow
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
    setTimeout: () => 0, document, sessionStorage, AbortController,
    fetch: async () => ({ ok: true, json: async () => catalog }),
  })
  const localSource = props.hooks.local
  render(React.createElement(panel, { t, runAction: props.runAction, useLocal: () => React.useSyncExternalStore(localSource.subscribe, localSource.getSnapshot) }))
  return { optionRow, selectPanel, t }
}

const names = () => screen.getAllByRole('heading', { level: 2 }).map(element => element.textContent)
const search = (value: string) => { fireEvent.change(screen.getByRole('searchbox'), { target: { value } }) }
const allModels = () => { fireEvent.click(screen.getByRole('tab', { name: 'All models' })) }

afterEach(() => {
  cleanup()
  document.querySelector('style[data-plugin="@janhq/jan-model-hub"]')?.remove()
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
  mount({ models: [{ id: 'qwen', name: 'qwen3-coder-IQ2_XXS', active: false }] })
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
  mount({ downloads: [{ id: 'qwen', name: 'qwen3-coder-IQ2_XXS', progress: { receivedBytes: 500e6, totalBytes: 1e9, bytesPerSecond: 42e6 } }] }, { pauseDownload, cancelDownload })
  allModels()
  const card = (await screen.findByRole('heading', { name: 'Qwen3-Coder' })).closest('li')!
  expect(within(card).getByRole('progressbar').getAttribute('value')).toBe('50')
  expect(within(card).getByText('42 MB/s')).toBeTruthy()
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
