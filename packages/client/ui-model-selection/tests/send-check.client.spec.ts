/**
 * Context-window overflow estimate: the selected model's catalog window wins
 * over the last request's window, and an unknown window never warns.
 */
import { describe, expect, it } from 'vitest'
import type { ModelDirectoryState } from '../src/client/directory.ts'
import { overflowOf } from '../src/client/send-check.ts'

function directory(contextWindow: number | undefined): ModelDirectoryState {
  return {
    current: { provider: 'local', model: 'small' },
    groups: [{ id: 'local', name: 'Local', models: [{ id: 'small', name: 'Small', ...contextWindow === undefined ? {} : { contextWindow } }] }],
  } as unknown as ModelDirectoryState
}

const paste = 'x'.repeat(40_000)

describe('overflowOf', () => {
  it('flags a message larger than the selected model window', () => {
    expect(overflowOf(paste, { directory: directory(4096), pressure: undefined }))
      .toMatchObject({ contextWindow: 4096, model: 'Small' })
  })

  it('counts the conversation already in context', () => {
    const fit = { directory: directory(8192), pressure: { projectedTokens: 8000, contextWindow: 8192 } }
    expect(overflowOf('x'.repeat(2_000), fit)).toBeDefined()
  })

  it('uses the selected model window after a switch, not the last request window', () => {
    const fit = { directory: directory(128_000), pressure: { projectedTokens: 100, contextWindow: 4096 } }
    expect(overflowOf(paste, fit)).toBeUndefined()
  })

  it('falls back to the last request window when the catalog has none', () => {
    expect(overflowOf(paste, { directory: directory(undefined), pressure: { contextWindow: 4096 } })).toBeDefined()
  })

  it('never warns when no window is known', () => {
    expect(overflowOf(paste, { directory: directory(undefined), pressure: undefined })).toBeUndefined()
  })
})
