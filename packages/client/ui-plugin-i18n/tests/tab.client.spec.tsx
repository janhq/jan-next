// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@janhq/jan-client-test-runtime'
import { PluginTranslationsTab, type PluginTranslationsTabProps } from '../src/client/PluginTranslationsTab.tsx'
import type { PluginI18nState } from '../src/client/service.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t = makeTranslate(en, {})
const STORED = { locale: 'ja', sourceLocale: 'en', model: 'p/m', generatedAt: 1, namespaces: ['n'], entries: 4, kept: 1 }

function state(patch: Partial<PluginI18nState> = {}): PluginI18nState {
  return { ready: true, consent: { global: false, packages: [] }, route: { provider: 'p', model: 'm' }, statuses: {}, ...patch }
}

function mount(current: PluginI18nState, overrides: Record<string, unknown> = {}) {
  const face = {
    listPackages: vi.fn(() => Promise.resolve([{ name: 'dsh-cad', title: 'CAD' }, { name: 'other', title: 'Other' }])),
    translate: vi.fn(() => Promise.resolve({ pkg: 'dsh-cad', locale: 'ja', state: 'done' as const, done: 1, total: 1 })),
    clear: vi.fn(() => Promise.resolve()),
    setGlobal: vi.fn(() => Promise.resolve()),
    languageName: () => '日本語',
    ...overrides,
  }
  const props = {
    t,
    useTranslations: (select: (value: PluginI18nState) => unknown) => select(current),
    useLocale: (select: (value: { active: string }) => unknown) => select({ active: 'ja' }),
    ...face,
  } as unknown as PluginTranslationsTabProps
  return { face, ...render(<PluginTranslationsTab {...props} />) }
}

describe('PluginTranslationsTab', () => {
  it('lists plugins with their stored state and offers Translate, Run again, and Clear', async () => {
    const { face } = mount(state({
      consent: { global: false, packages: ['dsh-cad'] },
      statuses: { 'dsh-cad': { pkg: 'dsh-cad', locales: [STORED], job: null, consented: true } },
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
    const running = mount(state({ statuses: { 'dsh-cad': { pkg: 'dsh-cad', locales: [], job, consented: false } } }), {
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
})
