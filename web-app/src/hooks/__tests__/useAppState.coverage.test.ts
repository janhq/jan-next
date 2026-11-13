import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useAppState } from '../useAppState'

describe('useAppState - coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    act(() => {
      useAppState.setState({
        loadingModel: false,
        serverStatus: 'stopped',
        errorMessage: undefined,
        activeModels: [],
        loadingModels: {},
        modelLoadProgressByThread: {},
      })
    })
  })

  it('should set error message', () => {
    const { result } = renderHook(() => useAppState())

    act(() => {
      result.current.setErrorMessage({ subtitle: 'Something went wrong', title: 'Error', message: 'Details' })
    })
    expect(result.current.errorMessage?.subtitle).toBe('Something went wrong')

    act(() => {
      result.current.setErrorMessage(undefined)
    })
    expect(result.current.errorMessage).toBeUndefined()
  })

  it('should update model load progress globally and per-thread', () => {
    const { result } = renderHook(() => useAppState())
    const progress = { modelId: 'model-1', value: 0.42, stage: 'text_model' }

    act(() => {
      result.current.updateModelLoadProgress(progress)
      result.current.updateThreadModelLoadProgress('t1', progress)
    })
    expect(result.current.modelLoadProgress).toEqual(progress)
    expect(result.current.modelLoadProgressByThread['t1']).toEqual(progress)

    act(() => {
      result.current.updateModelLoadProgress(undefined)
      result.current.updateThreadModelLoadProgress('t1', undefined)
    })
    expect(result.current.modelLoadProgress).toBeUndefined()
    expect(result.current.modelLoadProgressByThread['t1']).toBeUndefined()
  })

  it('should clear modelLoadProgressByThread on clearThreadState', () => {
    const { result } = renderHook(() => useAppState())

    act(() => {
      result.current.updateThreadModelLoadProgress('t1', {
        modelId: 'model-1',
        value: 0.5,
      })
      result.current.clearThreadState('t1')
    })
    expect(result.current.modelLoadProgressByThread['t1']).toBeUndefined()
  })

  it('should set active models', () => {
    const { result } = renderHook(() => useAppState())

    act(() => {
      result.current.setActiveModels(['model-a', 'model-b'])
    })
    expect(result.current.activeModels).toEqual(['model-a', 'model-b'])
  })

  it('should remove a single active model', () => {
    const { result } = renderHook(() => useAppState())

    act(() => {
      result.current.setActiveModels(['model-a', 'model-b'])
      result.current.removeActiveModel('model-a')
    })
    expect(result.current.activeModels).toEqual(['model-b'])
  })

  it('should no-op removing a model that is not active', () => {
    const { result } = renderHook(() => useAppState())

    act(() => {
      result.current.setActiveModels(['model-a'])
      result.current.removeActiveModel('model-does-not-exist')
    })
    expect(result.current.activeModels).toEqual(['model-a'])
  })

})
