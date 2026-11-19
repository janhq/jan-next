// @vitest-environment jsdom
import { act, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@janhq/jan-client-test-runtime'
import { en } from '@janhq/jan-client-ui-conversation/src/client/locales.ts'
import { en as commonEn } from '@janhq/jan-client-locale/src/locales/en.ts'
import { ToolDetails } from '../src/client/tool/components/ToolDetails.tsx'
import { SOURCE_TITLES, TitleBridge, type ToolTitles } from '../src/client/tool/title-source.ts'

const t = makeTranslate(en, commonEn)

const model = { items: [{ title: '工程图 body1', fields: [], groups: [{ label: 'More', items: [{ title: '装配', fields: [] }] }] }] }

describe('ToolDetails titles', () => {
  it('shows titles as written and asks for nothing without a translation service', () => {
    const view = render(<ToolDetails model={model} t={t} />)
    expect(view.getByText('工程图 body1')).toBeTruthy()
  })

  it('shows the translation, requests each title once, and keeps the source while none arrived', () => {
    const request = vi.fn()
    const titles: ToolTitles = { display: text => text === '工程图 body1' ? 'Drawing body1' : text, request }
    const view = render(<ToolDetails model={model} t={t} titles={titles} />)
    expect(view.getByText('Drawing body1')).toBeTruthy()
    // Every title on screen, nested groups included, is asked for exactly once.
    expect(request.mock.calls.map(call => String(call[0])).toSorted()).toEqual(['工程图 body1', '装配'])
  })

  it('translates the description of a provider record and leaves every other description as written', () => {
    const request = vi.fn()
    const titles: ToolTitles = { display: text => text === '导出零件' ? 'Export a part' : text, request }
    const items = [
      { title: 'cad_export', description: '导出零件', provider: true, fields: [] },
      { title: 'Goal', description: '导出零件 prompt', fields: [] },
    ]
    const view = render(<ToolDetails model={{ items }} t={t} titles={titles} />)
    expect(view.getByText('Export a part')).toBeTruthy()
    expect(view.getByText('导出零件 prompt')).toBeTruthy()
    // A description is never asked for unless a plugin or provider wrote it.
    expect(request.mock.calls.map(call => String(call[0])).toSorted()).toEqual(['Goal', 'cad_export', '导出零件'])
  })
})

describe('TitleBridge', () => {
  it('shows titles as written until a service attaches and returns to them when it leaves', () => {
    const bridge = new TitleBridge()
    const listener = vi.fn()
    bridge.subscribe(listener)
    expect(bridge.getSnapshot()).toBe(SOURCE_TITLES)
    let current: ToolTitles = { display: () => 'one', request: () => {} }
    const listeners = new Set<() => void>()
    const source = {
      getSnapshot: () => current,
      subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } },
    }
    const detach = bridge.attach(source)
    expect(bridge.getSnapshot().display('x')).toBe('one')
    current = { display: () => 'two', request: () => {} }
    act(() => { for (const fn of listeners) fn() })
    expect(bridge.getSnapshot().display('x')).toBe('two')
    detach()
    expect(bridge.getSnapshot()).toBe(SOURCE_TITLES)
    expect(listeners.size).toBe(0)
    expect(listener).toHaveBeenCalledTimes(3)
    expect(SOURCE_TITLES.display('a')).toBe('a')
    SOURCE_TITLES.request('a')
  })
})
