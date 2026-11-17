// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@janhq/jan-client-store'
import type { TranslateNS } from '@janhq/jan-client-ui-slots'
import type { ConfigForm, ConfigFormSnapshot } from '@janhq/jan-client-ui-settings/client'
import { FallbackCard, type FallbackCardProps } from '../src/client/FallbackCard.tsx'
import { ContextCard, type ContextCardProps } from '../src/client/ContextCard.tsx'
import { en } from '../src/client/locales.ts'

const t: TranslateNS<'settings.modelPolicy'> = key => (en as Record<string, string>)[key] ?? key
// The cards read only these props; the slot runtime props are never touched.
const fallbackProps = (form: FallbackCardProps['form']) => ({ form, loadCatalog, t }) as FallbackCardProps
const contextProps = (form: ContextCardProps['form']) => ({ form, loadCatalog, t }) as ContextCardProps
const catalog = {
  default: { provider: 'alpha', model: 'a' }, routableProviders: ['alpha', 'beta'], failures: [],
  groups: [
    { id: 'alpha', name: 'Provider A', models: [{ id: 'a', name: 'Model A' }, { id: 'b', name: 'Model B' }] },
    { id: 'beta', name: 'Provider B', models: [{ id: 'c', name: 'Model C' }] },
  ],
}
const loadCatalog = vi.fn(async () => ({ ok: true as const, value: catalog }))

type Fallback = { chain: { provider: string; model: string }[]; cooldownSeconds: number; switchBackBelowPercent: number }
type Compaction = { auto?: boolean; thresholdRatio?: number; summarizationProvider?: string; summarizationModel?: string }
function form<T>(value: T, writable = true) {
  const snapshot: ConfigFormSnapshot<T> = {
    status: 'ready', value, writable, base: undefined, user: undefined, revision: 0,
  }
  const store = createSnapshotStore(snapshot)
  const api = {
    getSnapshot: () => store.getSnapshot(), subscribe: (listener: () => void) => store.subscribe(listener),
    set: vi.fn(async (_field: string, _value: unknown) => true),
    unset: vi.fn(async (_field: string) => true),
    mutate: vi.fn(async () => true),
  } satisfies ConfigForm<T>
  return { api, store }
}

afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('Fallback models', () => {
  it('renders named ordered routes, then adds, reorders and removes the exact chain', async () => {
    const chain = [{ provider: 'alpha', model: 'a' }, { provider: 'beta', model: 'c' }]
    const { api, store } = form<Fallback>({ chain, cooldownSeconds: 300, switchBackBelowPercent: 30 })
    render(<FallbackCard {...fallbackProps(api)} />)
    await waitFor(() => { expect(screen.getByText('Model A')).toBeTruthy() })
    expect(screen.getByText('Model C')).toBeTruthy()
    expect(screen.getByText('Provider A')).toBeTruthy()
    expect(screen.getByText('Provider B')).toBeTruthy()
    expect(screen.getByRole('option', { name: 'Model B (Provider A)' })).toBeTruthy()
    expect(screen.queryByRole('option', { name: 'Model A (Provider A)' })).toBeNull()

    fireEvent.change(screen.getByLabelText(en.addFallback), { target: { value: JSON.stringify(['alpha', 'b']) } })
    expect(api.set).toHaveBeenLastCalledWith('chain', [...chain, { provider: 'alpha', model: 'b' }])

    act(() => { store.set({ ...store.getSnapshot(), value: { chain: [...chain, { provider: 'alpha', model: 'b' }], cooldownSeconds: 300, switchBackBelowPercent: 30 } }) })
    fireEvent.click(screen.getByRole('button', { name: `${en.moveUp} 3` }))
    expect(api.set).toHaveBeenLastCalledWith('chain', [chain[0], { provider: 'alpha', model: 'b' }, chain[1]])

    fireEvent.click(screen.getByRole('button', { name: `${en.moveDown} 1` }))
    expect(api.set).toHaveBeenLastCalledWith('chain', [chain[1], chain[0], { provider: 'alpha', model: 'b' }])

    fireEvent.click(screen.getByRole('button', { name: `${en.remove} 2` }))
    expect(api.set).toHaveBeenLastCalledWith('chain', [chain[0], { provider: 'alpha', model: 'b' }])
  })

  it('shows custom cooldown and disables every write when read-only', async () => {
    const { api } = form<Fallback>({ chain: [], cooldownSeconds: 42, switchBackBelowPercent: 30 }, false)
    render(<FallbackCard {...fallbackProps(api)} />)
    expect(screen.getByText(en.fallbackEmpty)).toBeTruthy()
    expect(screen.getByRole('status').textContent).toBe(en.readOnly)
    expect(screen.getByRole('option', { name: '42 s' })).toBeTruthy()
    expect(screen.getByLabelText(en.addFallback)).toHaveProperty('disabled', true)
    expect(screen.getByLabelText(en.cooldown)).toHaveProperty('disabled', true)
    expect(screen.getByLabelText(en.switchBack)).toHaveProperty('disabled', true)
  })

  it('offers catalog retry after a failed load', async () => {
    loadCatalog.mockRejectedValueOnce(new Error('offline'))
    const { api } = form<Fallback>({ chain: [], cooldownSeconds: 300, switchBackBelowPercent: 30 })
    render(<FallbackCard {...fallbackProps(api)} />)
    await waitFor(() => { expect(screen.getByText(en.catalogError)).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    await waitFor(() => { expect(screen.getByRole('option', { name: 'Model A (Provider A)' })).toBeTruthy() })
    expect(loadCatalog).toHaveBeenCalledTimes(2)
  })
})

describe('Context', () => {
  it('toggles auto-compaction and writes both summary fields in one atomic mutation', async () => {
    const { api } = form<Compaction>({ auto: true, thresholdRatio: 0.8, summarizationProvider: '', summarizationModel: '' })
    render(<ContextCard {...contextProps(api)} />)
    await waitFor(() => { expect(screen.getByRole('option', { name: 'Model C (Provider B)' })).toBeTruthy() })
    fireEvent.click(screen.getByRole('switch', { name: en.autoCompact }))
    expect(api.set).toHaveBeenCalledWith('auto', false)
    fireEvent.change(screen.getByLabelText(en.summaryModel), { target: { value: JSON.stringify(['beta', 'c']) } })
    expect(api.mutate).toHaveBeenCalledWith([
      { op: 'set', path: ['summarizationProvider'], value: 'beta' },
      { op: 'set', path: ['summarizationModel'], value: 'c' },
    ])
    fireEvent.change(screen.getByLabelText(en.summaryModel), { target: { value: '' } })
    expect(api.mutate).toHaveBeenLastCalledWith([
      { op: 'set', path: ['summarizationProvider'], value: '' },
      { op: 'set', path: ['summarizationModel'], value: '' },
    ])
  })

  it('shows the backend defaults before the user sets any preference', () => {
    const { api } = form<Compaction>({})
    render(<ContextCard {...contextProps(api)} />)
    expect(screen.getByRole('switch', { name: en.autoCompact }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByLabelText(en.threshold)).toHaveProperty('value', '0.8')
    expect(screen.getByLabelText(en.summaryModel)).toHaveProperty('value', '')
  })

  it('disables the threshold while auto is off and every control while read-only', () => {
    const { api } = form<Compaction>({ auto: false, thresholdRatio: 0.8, summarizationProvider: '', summarizationModel: '' }, false)
    render(<ContextCard {...contextProps(api)} />)
    expect(screen.getByRole('status').textContent).toBe(en.readOnly)
    expect(screen.getByRole('switch', { name: en.autoCompact })).toHaveProperty('disabled', true)
    expect(screen.getByLabelText(en.threshold)).toHaveProperty('disabled', true)
    expect(screen.getByLabelText(en.summaryModel)).toHaveProperty('disabled', true)
    expect(screen.getByText(en.contextLengthHint)).toBeTruthy()
  })
})
