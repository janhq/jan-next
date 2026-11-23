// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { makeTranslate } from '@janhq/jan-client-test-runtime'
import { en as commonEn } from '@janhq/jan-client-locale/src/locales/en.ts'
import { TurnUsagePanel } from '../src/client/chat/TurnUsagePanel.tsx'
import type { TurnTokenUsage } from '../src/client/contract/chat-nodes.ts'
import { en } from '../src/client/locale.ts'

const t = makeTranslate(en, commonEn)

afterEach(cleanup)

/** Each pill figure's text and the hint its hover shows. */
function figures(trigger: HTMLElement, view: ReturnType<typeof render>): [string, string][] {
  return [...trigger.querySelectorAll<HTMLElement>('[data-turn-usage-stat]')].map((stat) => {
    fireEvent.pointerEnter(stat)
    const hint = view.getByRole('tooltip').textContent ?? ''
    fireEvent.pointerLeave(stat)
    return [stat.textContent ?? '', hint]
  })
}

describe('TurnUsagePanel', () => {
  it('shows input, output, cache, first-token time and speed, and opens the usage dialog on click', () => {
    const usage: TurnTokenUsage = {
      uncachedInputTokens: 5_060,
      cacheReadTokens: 4_940,
      cacheWriteTokens: 0,
      outputTokens: 5_800,
      reasoningTokens: 42,
      totalTokens: 15_800,
      routes: [{ provider: 'deepseek', model: 'deepseek-chat' }],
    }
    const view = render(<TurnUsagePanel usage={usage} timing={{ ttftMs: 2_340, tokensPerSecond: 89.8 }} t={t} />)

    const trigger = view.getByRole('button', { name: 'Turn usage' })
    expect(figures(trigger, view)).toEqual([
      ['5.1K', 'Uncached input · 5,060 tok'],
      ['5.8K', 'Output · 5,800 tok'],
      ['4.9K', 'Cached input · 4,940 tok'],
      ['2.3s', 'Time to first token · 2.3s'],
      ['90 tok/s', 'Output speed · 90 tok/s'],
    ])
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(view.queryByRole('dialog')).toBeNull()

    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    const dialog = view.getByRole('dialog')
    expect(dialog.getAttribute('aria-label')).toBe('Turn usage')
    // Portaled out of the trigger's row, with a heading row carrying the total.
    expect(dialog.parentElement).toBe(document.body)
    expect(dialog.firstChild?.textContent).toBe('Turn usage15,800 tok')
    const details = dialog.querySelector('[data-turn-usage-details]') as HTMLElement
    expect(details).toBeTruthy()
    expect(details.textContent).toContain('Provider / modeldeepseek/deepseek-chat')
    expect(details.textContent).toContain('Cache hit49.4%')
    expect(details.textContent).toContain('Uncached input5,060 tok')
    expect(details.textContent).toContain('Cached input4,940 tok')
    expect(details.textContent).toContain('Cache write0 tok')
    expect(details.textContent).toContain('Output5,800 tok (42 tok reasoning)')
    expect(details.textContent).toContain('Time to first token2.3s')
    expect(details.textContent).toContain('Output speed90 tok/s')
    expect(details.textContent).not.toContain('Total')
  })

  it('names a route once when its model id already carries the provider', () => {
    const usage: TurnTokenUsage = {
      uncachedInputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      routes: [{ provider: 'tokamak', model: 'tokamak/auto' }, { provider: 'deepseek', model: 'deepseek-chat' }],
    }
    const view = render(<TurnUsagePanel usage={usage} t={t} />)
    fireEvent.click(view.getByRole('button', { name: 'Turn usage' }))
    expect(view.getByRole('dialog').querySelector('[data-turn-usage-details]')?.textContent)
      .toContain('Provider / modeltokamak/auto, deepseek/deepseek-chat')
  })

  it('omits unavailable optional facts instead of inventing values', () => {
    const usage: TurnTokenUsage = {
      uncachedInputTokens: 120,
      outputTokens: 30,
      totalTokens: 150,
    }
    const view = render(<TurnUsagePanel usage={usage} t={t} />)

    const trigger = view.getByRole('button')
    expect(figures(trigger, view).map(([, hint]) => hint))
      .toEqual(['Uncached input · 120 tok', 'Output · 30 tok'])
    fireEvent.click(trigger)
    expect(view.queryByText('Provider / model')).toBeNull()
    expect(view.queryByText('Cache hit')).toBeNull()
    expect(view.queryByText('Cached input')).toBeNull()
    expect(view.queryByText('Cache write')).toBeNull()
    expect(view.queryByText(/reasoning/)).toBeNull()
    expect(view.queryByText('Time to first token')).toBeNull()
    expect(view.queryByText('Output speed')).toBeNull()
  })

  it('keeps a partial cache hit below 100 in the dialog and closes on Escape or outside pointerdown', () => {
    const usage: TurnTokenUsage = {
      uncachedInputTokens: 1,
      cacheReadTokens: 999,
      outputTokens: 100,
      totalTokens: 1_100,
    }
    const view = render(<TurnUsagePanel usage={usage} t={t} />)
    const trigger = view.getByRole('button')

    fireEvent.click(trigger)
    const dialog = view.getByRole('dialog')
    expect(dialog.textContent).toContain('Cache hit99.9%')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(view.queryByRole('dialog')).toBeNull()
    expect(trigger.getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(trigger)
    // A pointerdown inside the panel keeps it open; one outside closes it.
    fireEvent.pointerDown(view.getByRole('dialog'))
    expect(view.queryByRole('dialog')).toBeTruthy()
    fireEvent.pointerDown(document.body)
    expect(view.queryByRole('dialog')).toBeNull()
  })

  it('closes on an outside click without pointerdown, as keyboard activation elsewhere fires', () => {
    const view = render(<TurnUsagePanel usage={{ uncachedInputTokens: 1, outputTokens: 1, totalTokens: 2 }} t={t} />)
    fireEvent.click(view.getByRole('button'))
    fireEvent.click(view.getByRole('dialog'))
    expect(view.queryByRole('dialog')).toBeTruthy()
    fireEvent.click(document.body)
    expect(view.queryByRole('dialog')).toBeNull()
  })
})
