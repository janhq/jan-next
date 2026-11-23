// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { revealStep, useSmoothText } from '../src/client/chat/smooth-stream.ts'

describe('revealStep', () => {
  it('releases whole words and never more than was received', () => {
    const text = 'The quick brown fox jumps'
    const next = revealStep(0, text, 16, false)
    expect(next).toBeGreaterThan(0)
    expect([' ', undefined]).toContain(text[next])
    expect(revealStep(20, text, 10_000, false)).toBe(text.length)
  })

  it('types out a remainder that lands with the finished message instead of showing it at once', () => {
    const text = 'word '.repeat(400)
    const frame = revealStep(0, text, 16, true)
    expect(frame).toBeGreaterThan(0)
    expect(frame).toBeLessThan(text.length / 10)
  })

  it('keeps an astral character whole when a long run is cut', () => {
    const text = 'x'.repeat(17) + '😀'.repeat(40)
    for (let shown = 0; shown < text.length;) {
      shown = revealStep(shown, text, 16, false)
      const code = text.charCodeAt(shown - 1)
      expect(code >= 0xd800 && code <= 0xdbff).toBe(false)
    }
  })
})

describe('useSmoothText', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] }) })
  afterEach(() => { vi.useRealTimers() })

  it('types a live reply out from its start and settles once the finished stream catches up', () => {
    const { result, rerender } = renderHook(({ text, streaming }) => useSmoothText(text, streaming), {
      initialProps: { text: 'Hello', streaming: true },
    })
    expect(result.current).toEqual({ text: '', settled: false })
    act(() => { vi.advanceTimersByTime(48) })
    expect(result.current.text).toBe('Hello')
    const appended = `Hello ${'there '.repeat(60)}`
    rerender({ text: appended, streaming: true })
    expect(result.current.text).toBe('Hello')
    act(() => { vi.advanceTimersByTime(48) })
    expect(result.current.text.length).toBeGreaterThan(5)
    expect(result.current.text.length).toBeLessThan(appended.length)
    expect(appended.startsWith(result.current.text)).toBe(true)
    rerender({ text: appended, streaming: false })
    expect(result.current.settled).toBe(false)
    act(() => { vi.advanceTimersByTime(2_000) })
    expect(result.current).toEqual({ text: appended, settled: true })
  })

  it('shows settled history at once', () => {
    const { result } = renderHook(() => useSmoothText('An earlier answer.', false))
    expect(result.current).toEqual({ text: 'An earlier answer.', settled: true })
  })

  it('continues from the shown position when the settled message replaces the live one', () => {
    const reply = `Carried reply ${'word '.repeat(200)}`
    const live = renderHook(() => useSmoothText(reply.slice(0, 32), true, 'session:1:1:0'))
    act(() => { vi.advanceTimersByTime(32) })
    const shown = live.result.current.text.length
    expect(shown).toBeGreaterThan(0)
    expect(shown).toBeLessThanOrEqual(32)
    live.unmount()
    const settled = renderHook(() => useSmoothText(reply, false, 'session:1:1:0'))
    expect(settled.result.current.text.length).toBe(shown)
    act(() => { vi.advanceTimersByTime(2_000) })
    expect(settled.result.current).toEqual({ text: reply, settled: true })
  })

  it.each(['another-session:1:1:0', 'session:2:1:0', 'session:1:1:1'])('does not pace historical block %s from a live block with identical prose', (identity) => {
    const text = 'A shared opening. ' + 'word '.repeat(200)
    const live = renderHook(() => useSmoothText(text, true, 'session:1:1:0'))
    act(() => { vi.advanceTimersByTime(32) })
    expect(live.result.current.text.length).toBeLessThan(text.length)
    const history = renderHook(() => useSmoothText(text, false, identity))
    expect(history.result.current).toEqual({ text, settled: true })
  })

  it('shows the whole reply when the window is hidden mid-reveal, since hidden pages get no frames', () => {
    const reply = `Hidden reply ${'word '.repeat(200)}`
    const { result } = renderHook(() => useSmoothText(reply, true))
    expect(result.current.text).toBe('')
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    try {
      act(() => { document.dispatchEvent(new Event('visibilitychange')) })
      expect(result.current.text).toBe(reply)
    } finally {
      visibility.mockRestore()
    }
  })

  it('keeps typing when text lands right after the reveal caught up', () => {
    const { result, rerender } = renderHook(({ text }) => useSmoothText(text, true), { initialProps: { text: 'Short' } })
    act(() => { vi.advanceTimersByTime(16) })
    expect(result.current.text).toBe('Short')
    // Each append lands one frame after the reveal stopped, many times over.
    let text = 'Short'
    for (let index = 0; index < 20; index++) {
      text += ` next${index}`
      rerender({ text })
      act(() => { vi.advanceTimersByTime(16) })
    }
    act(() => { vi.advanceTimersByTime(1_000) })
    expect(result.current.text).toBe(text)
  })

  it('shows a replacement at once', () => {
    const { result, rerender } = renderHook(({ text }) => useSmoothText(text, true), { initialProps: { text: 'first draft' } })
    act(() => { vi.advanceTimersByTime(100) })
    rerender({ text: 'second' })
    expect(result.current.text).toBe('second')
  })
})
