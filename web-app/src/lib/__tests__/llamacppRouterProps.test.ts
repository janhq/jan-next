import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ServiceKeys, createServiceRegistry } from '@janhq/core'

const h = vi.hoisted(() => ({ services: undefined as unknown }))
vi.mock('@/lib/extensions/host', () => ({
  getExtensionHost: () => ({ services: h.services }),
}))

import {
  getLlamacppExtension,
  getLocalPropsExtension,
} from '../llamacppRouterProps'

const engine = () => ({
  getModelProps: vi.fn().mockResolvedValue({ nCtx: 1 }),
  unload: vi.fn().mockResolvedValue({ success: true }),
})

describe('local engine lookups', () => {
  beforeEach(() => {
    h.services = createServiceRegistry()
  })

  it('finds the llamacpp service in the host registry', () => {
    const registry = createServiceRegistry()
    h.services = registry
    const llama = { ...engine(), getDevices: vi.fn(), reconcileEngineDevices: vi.fn() }
    registry.provide(ServiceKeys.Llamacpp, llama)
    expect(getLlamacppExtension()).toBe(llama)
    expect(getLocalPropsExtension('llamacpp')).toBe(llama)
  })

  it('has nothing for an engine that is not running or a remote provider', () => {
    expect(getLlamacppExtension()).toBeUndefined()
    expect(getLocalPropsExtension('openai')).toBeUndefined()
    expect(getLocalPropsExtension(undefined)).toBeUndefined()
  })
})
