import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  clearActiveWork,
  hasActiveLlamacppRequest,
  isEngineWorkInFlight,
} from './llamacppRouterError'
import { useAppState } from '@/hooks/useAppState'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useChatSessions } from '@/stores/chat-session-store'

const streaming = (stop = vi.fn()) =>
  ({ isStreaming: true, chat: { stop } }) as any

beforeEach(() => {
  useAppState.setState({
    loadingModel: false,
    loadingModels: {},
    modelLoadProgressByThread: {},
  })
  useChatSessions.setState({ sessions: {} })
  useModelProvider.setState({ selectedProvider: 'llamacpp' })
})

describe('hasActiveLlamacppRequest', () => {
  it('is true while a chat session is streaming', () => {
    useChatSessions.setState({ sessions: { t1: streaming() } })
    expect(hasActiveLlamacppRequest()).toBe(true)
  })

  it('is false when idle (no active work)', () => {
    expect(hasActiveLlamacppRequest()).toBe(false)
  })

  it('ignores sessions that are not streaming', () => {
    useChatSessions.setState({
      sessions: { t1: { isStreaming: false, chat: { stop: vi.fn() } } as any },
    })
    expect(hasActiveLlamacppRequest()).toBe(false)
  })

  // Separation: a router crash must not decorate chats on other providers.
  it('is false when the selected provider is not llamacpp, even mid-stream', () => {
    useModelProvider.setState({ selectedProvider: 'openai' })
    useChatSessions.setState({ sessions: { t1: streaming() } })
    expect(hasActiveLlamacppRequest()).toBe(false)
  })

  it('is true while a model is loading', () => {
    useAppState.setState({ loadingModels: { t1: true } })
    expect(hasActiveLlamacppRequest()).toBe(true)
  })
})

// The hardware check reuses the predicate but not the provider gate: it runs
// from the llama.cpp settings page, which already knows which engine it is.
describe('isEngineWorkInFlight', () => {
  it('reports streaming work regardless of which provider is selected', () => {
    useModelProvider.setState({ selectedProvider: 'openai' })
    const sessions = { t1: streaming() }
    expect(isEngineWorkInFlight({}, sessions)).toBe(true)
    useChatSessions.setState({ sessions })
    expect(hasActiveLlamacppRequest()).toBe(false)
  })

  it('is false when nothing is loading or streaming', () => {
    expect(isEngineWorkInFlight({}, {})).toBe(false)
  })

  it('counts a model that is still loading as work', () => {
    expect(isEngineWorkInFlight({ qwen3: true }, {})).toBe(true)
  })
})

describe('clearActiveWork', () => {
  it('stops streaming sessions and clears model-load state', () => {
    const stopA = vi.fn()
    const stopIdle = vi.fn()
    useChatSessions.setState({
      sessions: {
        a: streaming(stopA),
        b: { isStreaming: false, chat: { stop: stopIdle } } as any,
      },
    })
    useAppState.setState({
      loadingModel: true,
      loadingModels: { a: true },
      modelLoadProgressByThread: { a: { modelId: 'm', value: 0.5 } },
    })

    clearActiveWork()

    expect(stopA).toHaveBeenCalledTimes(1)
    expect(stopIdle).not.toHaveBeenCalled()
    expect(useAppState.getState().loadingModels).toEqual({})
    expect(useAppState.getState().modelLoadProgressByThread).toEqual({})
    expect(useAppState.getState().loadingModel).toBe(false)
  })

  it('keeps clearing when a chat stop throws', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    useChatSessions.setState({
      sessions: {
        a: streaming(() => {
          throw new Error('boom')
        }),
      },
    })
    useAppState.setState({ loadingModel: true })

    expect(() => clearActiveWork()).not.toThrow()
    expect(useAppState.getState().loadingModel).toBe(false)
    warn.mockRestore()
  })
})
