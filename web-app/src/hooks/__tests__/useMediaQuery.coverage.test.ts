import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useTouchDevice } from '../useMediaQuery'

const mockMatchMedia = vi.fn()

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: mockMatchMedia,
  })
  vi.clearAllMocks()
})

describe('useMediaQuery screen size hooks', () => {
  const setup = () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })

  it('useTouchDevice should query hover: none', () => {
    mockMatchMedia.mockReturnValue(setup())
    const { result } = renderHook(() => useTouchDevice())
    expect(result.current).toBe(true)
    expect(mockMatchMedia).toHaveBeenCalledWith('(hover: none)')
  })
})
