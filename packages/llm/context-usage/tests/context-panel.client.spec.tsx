// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, within } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { makeTranslate } from '@janhq/jan-client-test-runtime'
import { en as commonEn } from '@janhq/jan-client-locale/src/locales/index.ts'
import { ContextPanel, type ContextPanelProps } from '../src/client/ContextPanel.tsx'
import { dictionaries } from '../src/client/locales.ts'
import { ContextPanelState } from '../src/client/state.ts'
import type { ContextUsage } from '../src/types.ts'

afterEach(cleanup)

const t = makeTranslate(dictionaries.en, commonEn) as ContextPanelProps['t']
const usage = {
  model: { provider: 'example', model: 'example-model' },
  contextWindow: 400_000,
  autoCompactTokens: 340_000,
  usedTokens: 144_000,
  usedSource: 'provider',
  categories: [
    { id: 'systemPrompt', tokens: 8_500, entries: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']
      .map((label, index) => ({ label: `Section ${label}`, tokens: 85 + index * 170 })) },
    { id: 'janTools', tokens: 21_500, entries: [] },
    { id: 'userMessages', tokens: 114_000, entries: [] },
  ],
} satisfies ContextUsage

function dock(fetchBreakdown: (signal: AbortSignal) => Promise<ContextUsage>) {
  const state = new ContextPanelState(fetchBreakdown)
  const subscribe = (listener: () => void) => state.snapshot.subscribe(listener)
  function Panel() {
    return <ContextPanel
      useBreakdown={selector => useSyncExternalStore(subscribe, () => selector(state.snapshot.getSnapshot()))}
      refresh={state.refresh}
      dismiss={state.dismiss}
      t={t}
    />
  }
  const view = render(<div data-conversation-session="session"><button onClick={state.refresh}>Open context</button><Panel /></div>)
  const opener = view.getByRole('button', { name: 'Open context' })
  opener.focus()
  fireEvent.click(opener)
  return { ...view, opener }
}

function cellCount(grid: HTMLElement, category: string) {
  return grid.querySelectorAll(`[data-context-cell="${category}"]`).length
}

describe('ContextPanel', () => {
  it('maps used categories, free space, and the compaction reserve to 200 cells', async () => {
    const view = dock(() => Promise.resolve(usage))
    expect((await view.findByRole('heading', { name: 'Context · example-model' })).textContent).toBe('Context · example-model')
    expect(view.getByText('Used 144K of 400K tokens · 36%')).toBeDefined()
    expect(view.getByText('196K left before auto-compaction at 85%')).toBeDefined()
    const grid = view.getByRole('img', { name: 'Context window usage (0.5% per cell)' })
    expect(grid.querySelectorAll('[data-context-cell]')).toHaveLength(200)
    expect(cellCount(grid, 'systemPrompt')).toBe(4)
    expect(cellCount(grid, 'janTools')).toBe(11)
    expect(cellCount(grid, 'userMessages')).toBe(57)
    expect(cellCount(grid, 'freeSpace')).toBe(98)
    expect(cellCount(grid, 'autoCompactBuffer')).toBe(30)
    const cells = grid.querySelectorAll<HTMLElement>('[data-context-cell]')
    expect(cells[169]?.dataset.contextCell).toBe('freeSpace')
    expect(cells[170]?.dataset.contextCell).toBe('autoCompactBuffer')
  })

  it('highlights the related row and shows its tokens when hovering a cell', async () => {
    const view = dock(() => Promise.resolve(usage))
    const grid = await view.findByRole('img')
    const cell = grid.querySelector('[data-context-cell="systemPrompt"]')
    if (cell === null) throw new Error('System prompt cell not rendered')
    const system = view.getByRole('button', { name: /^System prompt\b/ })
    fireEvent.pointerEnter(cell)
    expect(view.getByRole('tooltip').textContent).toBe('System prompt: 8.5K tokens')
    expect(system.hasAttribute('data-highlighted')).toBe(true)
    fireEvent.pointerLeave(cell)
    expect(view.queryByRole('tooltip')).toBeNull()
    expect(system.hasAttribute('data-highlighted')).toBe(false)
  })

  it('shows the largest eight entries first, allows showing the rest, and supports arrow navigation', async () => {
    const view = dock(() => Promise.resolve(usage))
    const system = await view.findByRole('button', { name: /^System prompt\b/ })
    const files = view.getByRole('button', { name: /^Instruction files\b/ })
    expect(system.getAttribute('aria-expanded')).toBe('false')
    expect(view.queryByText('Section J')).toBeNull()
    system.focus()
    fireEvent.keyDown(system, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(files)
    fireEvent.keyDown(files, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(system)
    fireEvent.keyDown(system, { key: 'ArrowRight' })
    const disclosure = document.getElementById(system.getAttribute('aria-controls') ?? '')
    expect(disclosure).not.toBeNull()
    expect(within(disclosure!).getAllByText(/^Section /).map(node => node.textContent)).toEqual([
      'Section J', 'Section I', 'Section H', 'Section G', 'Section F', 'Section E', 'Section D', 'Section C',
    ])
    fireEvent.click(view.getByRole('button', { name: '+2 more' }))
    expect(view.getByText('Section B')).toBeDefined()
    expect(view.getByText('Section A')).toBeDefined()
    fireEvent.keyDown(system, { key: 'ArrowLeft' })
    expect(system.getAttribute('aria-expanded')).toBe('false')
    expect(view.queryByText('Section J')).toBeNull()
  })

  it('shows only used tokens when capacity is unavailable, and distinguishes estimates', async () => {
    const { contextWindow: _window, autoCompactTokens: _threshold, ...unknownWindow } = usage
    const view = dock(() => Promise.resolve({ ...unknownWindow, usedSource: 'estimate' }))
    expect(await view.findByText('Used 144K tokens')).toBeDefined()
    expect(view.getByText('(estimated)')).toBeDefined()
    expect(view.queryByRole('img')).toBeNull()
    expect(view.queryByText(/left before auto-compaction/)).toBeNull()
    expect(view.queryByText('Auto-compact buffer')).toBeNull()
  })

  it('uses all remaining capacity as free space while auto-compaction is off', async () => {
    const { autoCompactTokens: _threshold, ...withoutThreshold } = usage
    const view = dock(() => Promise.resolve(withoutThreshold))
    const grid = await view.findByRole('img')
    expect(cellCount(grid, 'freeSpace')).toBe(128)
    expect(cellCount(grid, 'autoCompactBuffer')).toBe(0)
    expect(view.queryByText(/left before auto-compaction/)).toBeNull()
  })

  it('shows an error on a rejected fetch and recovers when retried', async () => {
    const response = Promise.withResolvers<ContextUsage>()
    const fetchBreakdown = vi.fn<(signal: AbortSignal) => Promise<ContextUsage>>()
      .mockReturnValueOnce(response.promise)
      .mockResolvedValueOnce(usage)
    const view = dock(fetchBreakdown)
    expect(view.getByRole('status').textContent).toBe('Loading context usage…')
    await act(async () => { response.reject(new Error('network failure')) })
    expect(view.getByRole('alert').textContent).toBe('Could not load context usage.')
    fireEvent.click(view.getByRole('button', { name: 'Retry' }))
    expect(await view.findByText('Used 144K of 400K tokens · 36%')).toBeDefined()
    expect(view.queryByRole('alert')).toBeNull()
    expect(fetchBreakdown).toHaveBeenCalledTimes(2)
  })

  it('refreshes on demand and cancels an in-flight refresh when Escape dismisses the panel', async () => {
    const refresh = Promise.withResolvers<ContextUsage>()
    const fetchBreakdown = vi.fn<(signal: AbortSignal) => Promise<ContextUsage>>()
      .mockResolvedValueOnce(usage)
      .mockReturnValueOnce(refresh.promise)
    const view = dock(fetchBreakdown)
    const button = view.getByRole('button', { name: 'Refresh context usage' })
    await view.findByText('Used 144K of 400K tokens · 36%')
    button.focus()
    fireEvent.click(button)
    expect(view.getByRole('status').textContent).toBe('Refreshing context usage…')
    fireEvent.keyDown(button, { key: 'Escape' })
    expect(view.queryByRole('region', { name: 'Context' })).toBeNull()
    expect(document.activeElement).toBe(view.opener)
    expect(fetchBreakdown.mock.calls[1]?.[0].aborted).toBe(true)
    await act(async () => { refresh.resolve(usage) })
    expect(view.queryByRole('region', { name: 'Context' })).toBeNull()
  })
})
