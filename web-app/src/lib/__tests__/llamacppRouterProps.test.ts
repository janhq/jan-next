import { describe, it, expect, vi } from 'vitest'

const h = vi.hoisted(() => ({ engine: { getModelProps: vi.fn() } }))
vi.mock('../../../../dsh/llamacpp/src', () => ({
  getLlamacppEngine: () => h.engine,
}))

import {
  getLlamacppExtension,
  getLocalPropsExtension,
} from '../llamacppRouterProps'

describe('local engine lookups', () => {
  it('serves llamacpp from the in-process engine', () => {
    expect(getLlamacppExtension()).toBe(h.engine)
    expect(getLocalPropsExtension('llamacpp')).toBe(h.engine)
  })

  it('has nothing for a remote provider', () => {
    expect(getLocalPropsExtension('openai')).toBeUndefined()
    expect(getLocalPropsExtension(undefined)).toBeUndefined()
  })
})
