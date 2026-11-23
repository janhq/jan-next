import { afterEach, expect, it, vi } from 'vitest'
import { createMainSelection } from '../src/client/window-selection.ts'
import { SessionId } from '@janhq/jan-session/types'

const a = SessionId('primary-chat')
const b = SessionId('secondary-chat')
const c = SessionId('replacement-chat')

afterEach(() => { vi.unstubAllGlobals() })

it('restores navigation independently in each desktop window, with the launch chat only as a seed', () => {
  const values = new Map([['jan.sessions.current', JSON.stringify({ sessionId: a })]])
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
  })
  const secondary = { id: 'second', sessionId: b }
  expect(createMainSelection().getSnapshot()).toEqual({ sessionId: a })
  // The main window's bridge has no id and keeps the unscoped selection.
  expect(createMainSelection({}).getSnapshot()).toEqual({ sessionId: a })
  const opened = createMainSelection(secondary)
  expect(opened.getSnapshot()).toEqual({ sessionId: b })
  opened.set({ sessionId: c })
  expect(createMainSelection(secondary).getSnapshot()).toEqual({ sessionId: c })
  opened.set({})
  expect(createMainSelection(secondary).getSnapshot()).toEqual({})
  expect(createMainSelection().getSnapshot()).toEqual({ sessionId: a })
})
