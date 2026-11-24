// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@janhq/jan-client-test-runtime'
import type { PluginI18nRouteChoices, PluginI18nRouteRef } from '@janhq/jan-host-plugin-i18n/types'
import { PluginTranslationsTab, type PluginTranslationsTabProps } from '../src/client/PluginTranslationsTab.tsx'
import type { PluginI18nState } from '../src/client/service.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t = makeTranslate(en, {})
const STORED = { locale: 'ja', sourceLocale: 'en', model: 'p/m', generatedAt: 1, namespaces: ['n'], entries: 4, kept: 1 }

/** What the Host answers to the model picker: a usable default, one remote and two local models. */
const CHOICES: PluginI18nRouteChoices = {
  route: { provider: 'p', model: 'm', source: 'default' },
  saved: null,
  default: { provider: 'p', model: 'm', usable: true },
  models: [
    { provider: 'local', model: 'qwen', name: 'Qwen', local: true, loaded: true },
    { provider: 'local', model: 'llama', name: 'Llama', local: true, loaded: false },
    { provider: 'p', model: 'm', name: 'M', local: false, loaded: false },
  ],
}

function state(patch: Partial<PluginI18nState> = {}): PluginI18nState {
  return {
    ready: true, consent: { global: false, packages: [] }, route: { provider: 'p', model: 'm', source: 'default' },
    statuses: {}, screen: {}, failures: {}, ...patch,
  }
}

function mount(current: PluginI18nState, overrides: Record<string, unknown> = {}) {
  const face = {
    listPackages: vi.fn(() => Promise.resolve([{ name: 'dsh-cad', title: 'CAD' }, { name: 'other', title: 'Other' }])),
    translate: vi.fn(() => Promise.resolve({ pkg: 'dsh-cad', locale: 'ja', state: 'done' as const, done: 1, total: 1 })),
    clear: vi.fn(() => Promise.resolve()),
    setGlobal: vi.fn(() => Promise.resolve()),
    routes: vi.fn(() => Promise.resolve(CHOICES)),
    setRoute: vi.fn((route: PluginI18nRouteRef | null) => Promise.resolve({ ...CHOICES, saved: route })),
    languageName: () => '日本語',
    ...overrides,
  }
  const props: PluginTranslationsTabProps = {
    t,
    useTranslations: (select: (value: PluginI18nState) => unknown) => select(current),
    useLocale: (select: (value: { active: string }) => unknown) => select({ active: 'ja' }),
    ...face,
  } as never
  return { face, ...render(<PluginTranslationsTab {...props} />) }
}

describe('PluginTranslationsTab', () => {
  it('lists plugins with their stored state and offers Translate, Run again, and Clear', async () => {
    const { face } = mount(state({
      consent: { global: false, packages: ['dsh-cad'] },
      statuses: { 'dsh-cad': { pkg: 'dsh-cad', locales: [STORED], runtime: [], job: null, consented: true } },
    }))
    await screen.findByText('CAD')
    expect(screen.getByText('Translated into 日本語 by p/m - 4 strings, 1 kept in the original')).toBeTruthy()
    expect(screen.getByText('Not translated into 日本語')).toBeTruthy()
    expect(screen.getAllByText(en.machineTag)).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: en.actionRerun }))
    expect(face.translate).toHaveBeenCalledWith('dsh-cad', true)
    await waitFor(() => { expect(screen.getByRole('button', { name: en.actionClear })).toHaveProperty('disabled', false) })
    fireEvent.click(screen.getByRole('button', { name: en.actionTranslate }))
    expect(face.translate).toHaveBeenCalledWith('other', false)
    fireEvent.click(screen.getByRole('button', { name: en.actionClear }))
    await waitFor(() => { expect(face.clear).toHaveBeenCalledWith('dsh-cad') })
  })

  it('shows progress and failures, and switches the global consent', async () => {
    const job = { pkg: 'dsh-cad', locale: 'ja', state: 'running' as const, done: 2, total: 5 }
    const running = mount(state({ statuses: { 'dsh-cad': { pkg: 'dsh-cad', locales: [], runtime: [], job, consented: false } } }), {
      translate: vi.fn(() => Promise.reject(new Error('offline'))),
    })
    await screen.findByText('Translating... 2 of 5')
    expect(screen.getAllByRole('button', { name: en.actionTranslate })[0]).toHaveProperty('disabled', true)
    fireEvent.click(screen.getAllByRole('button', { name: en.actionTranslate })[1]!)
    await screen.findByText('Translation failed: offline')
    fireEvent.click(screen.getByRole('switch', { name: en.globalLabel }))
    expect(running.face.setGlobal).toHaveBeenCalledWith(true)
  })

  it('reports an unreadable plugin list and retries it', async () => {
    const listPackages = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValue([])
    mount(state(), { listPackages })
    await screen.findByText(en.error)
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    await screen.findByText(en.empty)
  })

  describe('model picker', () => {
    it('preselects the default model, names it, and lists the models with the loaded one marked', async () => {
      mount(state())
      const picker = await screen.findByRole('combobox', { name: en.modelLabel })
      expect(picker).toHaveProperty('value', 'default')
      expect(screen.getByRole('option', { name: 'Default model (p/m)' })).toBeTruthy()
      expect(screen.getByRole('option', { name: 'Qwen (local) - loaded' })).toBeTruthy()
      expect(screen.getByRole('option', { name: 'Llama (local)' })).toBeTruthy()
      expect(screen.queryByText(/cannot be used/)).toBeNull()
    })

    it('saves a picked model and follows the default model again when the default is picked back', async () => {
      const { face } = mount(state())
      const picker = await screen.findByRole('combobox', { name: en.modelLabel })
      fireEvent.change(picker, { target: { value: '1' } })
      await waitFor(() => { expect(face.setRoute).toHaveBeenCalledWith({ provider: 'local', model: 'llama' }) })
      await waitFor(() => { expect(screen.getByRole('combobox', { name: en.modelLabel })).toHaveProperty('value', '1') })
      fireEvent.change(screen.getByRole('combobox', { name: en.modelLabel }), { target: { value: 'default' } })
      await waitFor(() => { expect(face.setRoute).toHaveBeenLastCalledWith(null) })
    })

    it('says which model translations run on when the default cannot be used', async () => {
      mount(state(), {
        routes: vi.fn(() => Promise.resolve({
          ...CHOICES, route: { provider: 'local', model: 'qwen', source: 'loaded-local' }, default: { provider: 'p', model: 'm', usable: false },
        })),
      })
      await screen.findByText('The default model cannot be used, so translations run on local/qwen.')
    })

    it('says so when a saved model is no longer available, and keeps it selectable', async () => {
      mount(state(), {
        routes: vi.fn(() => Promise.resolve({
          ...CHOICES, saved: { provider: 'gone', model: 'x' }, route: { provider: 'p', model: 'm', source: 'default' },
        })),
      })
      await screen.findByText('Your chosen model cannot be used, so translations run on p/m.')
      expect(screen.getByRole('combobox', { name: en.modelLabel })).toHaveProperty('value', 'saved')
      expect(screen.getByRole('option', { name: 'gone/x' })).toBeTruthy()
    })

    it('reports models that cannot be read', async () => {
      mount(state(), { routes: vi.fn(() => Promise.reject(new Error('x'))) })
      await screen.findByText(en.modelError)
    })
  })

  describe('on-screen text', () => {
    it('counts the plugin\u2019s on-screen strings and lists them with their translations', async () => {
      mount(state({
        consent: { global: false, packages: ['dsh-cad'] },
        statuses: { 'dsh-cad': { pkg: 'dsh-cad', locales: [{ ...STORED, entries: 0, kept: 0 }], runtime: [{ locale: 'ja', strings: 2 }], job: null, consented: true } },
        screen: { 'dsh-cad': [{ source: '导出', text: 'エクスポート' }, { source: '搜索', text: '検索' }] },
      }))
      await screen.findByText('Translated into 日本語 by p/m - 2 on-screen strings')
      expect(screen.queryByText(/- 0 strings/)).toBeNull()
      expect(screen.getByText('Show on-screen strings (2)')).toBeTruthy()
      expect(screen.getByText('エクスポート')).toBeTruthy()
      expect(screen.getByText('导出')).toBeTruthy()
    })

    it('says on-screen text is translated as it appears before any has been seen, and shows a failure', async () => {
      mount(state({
        consent: { global: false, packages: ['dsh-cad'] },
        statuses: { 'dsh-cad': { pkg: 'dsh-cad', locales: [{ ...STORED, entries: 0, kept: 0 }], runtime: [], job: null, consented: true } },
        failures: { 'dsh-cad': 'model offline' },
      }))
      await screen.findByText(/text the plugin draws on screen is translated as it appears/)
      expect(screen.getByText('On-screen translation failed: model offline')).toBeTruthy()
    })

    it('adds the on-screen count under a translated namespace line', async () => {
      mount(state({
        consent: { global: false, packages: ['dsh-cad'] },
        statuses: { 'dsh-cad': { pkg: 'dsh-cad', locales: [STORED], runtime: [{ locale: 'ja', strings: 7 }], job: null, consented: true } },
      }))
      await screen.findByText('7 on-screen strings translated')
    })
  })
})
