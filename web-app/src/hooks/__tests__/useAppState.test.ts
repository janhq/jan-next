import { describe, it, expect, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useAppState, useIsThreadActive } from '../useAppState'

describe('useAppState', () => {
  beforeEach(() => {
    act(() => {
      useAppState.setState({
        loadingModel: false,
        serverStatus: 'stopped',
        loadingModels: {},
      })
    })
  })

  it('should initialize with default state', () => {
    const { result } = renderHook(() => useAppState())

    expect(result.current.loadingModel).toBe(false)
    expect(result.current.serverStatus).toBe('stopped')
    expect(result.current.loadingModels).toEqual({})
  })

  it('should update loading model state', () => {
    const { result } = renderHook(() => useAppState())

    act(() => {
      result.current.updateLoadingModel(true)
    })
    expect(result.current.loadingModel).toBe(true)

    act(() => {
      result.current.updateLoadingModel(false)
    })
    expect(result.current.loadingModel).toBe(false)
  })

  it('should update server status', () => {
    const { result } = renderHook(() => useAppState())

    act(() => {
      result.current.setServerStatus('running')
    })
    expect(result.current.serverStatus).toBe('running')

    act(() => {
      result.current.setServerStatus('pending')
    })
    expect(result.current.serverStatus).toBe('pending')
  })

  it('useIsThreadActive is true only while the thread is in loadingModels', () => {
    const { result } = renderHook(() => useIsThreadActive('t1'))
    expect(result.current).toBe(false)

    act(() => {
      useAppState.getState().updateThreadLoadingModel('t1', true)
    })
    expect(result.current).toBe(true)

    act(() => {
      useAppState.getState().updateThreadLoadingModel('t1', false)
    })
    expect(result.current).toBe(false)
  })

  it('useIsThreadActive is false for an undefined thread id', () => {
    act(() => {
      useAppState.getState().updateThreadLoadingModel('t1', true)
    })
    const { result } = renderHook(() => useIsThreadActive(undefined))
    expect(result.current).toBe(false)
  })
})
