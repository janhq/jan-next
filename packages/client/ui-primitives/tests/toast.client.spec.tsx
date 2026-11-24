// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { Toast } from '../src/Toast.tsx'
import { captureFailure } from '../src/failure-details.ts'

afterEach(cleanup)

describe('Toast', () => {
  it('closes at once from its button, named in the document language, and reports done only once', () => {
    vi.useFakeTimers()
    const language = document.documentElement.lang
    try {
      document.documentElement.lang = 'de-DE'
      const onDone = vi.fn()
      const view = render(<Toast text="Neue Sitzung fehlgeschlagen" onDone={onDone} />)
      fireEvent.click(view.getByRole('button', { name: 'Schließen' }))
      expect(onDone).toHaveBeenCalledTimes(1)
      vi.advanceTimersByTime(10_000)
      expect(onDone).toHaveBeenCalledTimes(1)
    } finally {
      document.documentElement.lang = language
      vi.useRealTimers()
    }
  })

  it('announces its text and reports done after the hold-and-fade lifetime', () => {
    vi.useFakeTimers()
    try {
      const onDone = vi.fn()
      const view = render(<Toast text="最多添加 50 张图片" icon={<svg data-testid="icon" />} onDone={onDone} />)
      const banner = view.getByRole('alert')
      expect(banner.textContent).toContain('最多添加 50 张图片')
      expect(view.getByTestId('icon')).toBeTruthy()
      vi.advanceTimersByTime(3999)
      expect(onDone).not.toHaveBeenCalled()
      vi.advanceTimersByTime(1)
      expect(onDone).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('holds for the owner\'s window and hands the stylesheet the same value', () => {
    vi.useFakeTimers()
    try {
      const onDone = vi.fn()
      const view = render(<Toast text="切换失败" holdMs={6000} onDone={onDone} />)
      // One value drives both, so a banner can never unmount mid-fade: the
      // timer waits the hold plus the fade, and the stylesheet delays the
      // fade by the same hold.
      expect(view.getByRole('alert').style.getPropertyValue('--jan-toast-hold')).toBe('6000ms')
      vi.advanceTimersByTime(6999)
      expect(onDone).not.toHaveBeenCalled()
      vi.advanceTimersByTime(1)
      expect(onDone).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps its original expiry across rerenders and calls the latest completion handler', () => {
    vi.useFakeTimers()
    try {
      const first = vi.fn()
      const latest = vi.fn()
      const view = render(<Toast text="archived" onDone={first} />)
      vi.advanceTimersByTime(1000)
      view.rerender(<Toast text="archived" onDone={latest} />)
      vi.advanceTimersByTime(2999)
      expect(first).not.toHaveBeenCalled()
      expect(latest).not.toHaveBeenCalled()
      vi.advanceTimersByTime(1)
      expect(first).not.toHaveBeenCalled()
      expect(latest).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('stacks concurrent notices in one shared layer, newest last, and drops the layer slot on unmount', () => {
    const first = render(<Toast text="first" onDone={vi.fn()} />)
    const second = render(<Toast text="second" onDone={vi.fn()} />)
    const layers = document.querySelectorAll('[data-jan-notifications]')
    expect(layers).toHaveLength(1)
    expect([...layers[0]!.children].map(item => item.textContent)).toEqual(['first', 'second'])
    first.unmount()
    expect([...layers[0]!.children].map(item => item.textContent)).toEqual(['second'])
    second.unmount()
  })

  it('flows prefixed actions inline as one sentence and hands each press to the owner', () => {
    vi.useFakeTimers()
    try {
      const undo = vi.fn()
      const filter = vi.fn()
      const view = render(
        <Toast
          text="会话已归档，可"
          tone="success"
          actions={[
            { label: '撤销', onClick: undo },
            { prefix: '或', label: '筛选已归档会话', onClick: filter },
          ]}
          onDone={vi.fn()}
        />,
      )
      // The success tone brings the circled green check itself; no icon prop.
      const glyph = view.getByRole('alert').querySelector('[aria-hidden]')
      expect(glyph?.className).toContain('success')
      expect(glyph?.querySelector('svg')).toBeTruthy()
      expect(view.getByRole('alert').textContent).toBe('会话已归档，可撤销或筛选已归档会话')
      fireEvent.click(view.getByRole('button', { name: '撤销' }))
      expect(undo).toHaveBeenCalledTimes(1)
      fireEvent.click(view.getByRole('button', { name: '筛选已归档会话' }))
      expect(filter).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('renders without an icon and cancels its timer on unmount', () => {
    vi.useFakeTimers()
    try {
      const onDone = vi.fn()
      const view = render(<Toast text="plain" onDone={onDone} />)
      expect(view.getByRole('alert').querySelector(':scope > [aria-hidden]')).toBeNull()
      view.unmount()
      vi.advanceTimersByTime(10_000)
      expect(onDone).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
  it('only offers diagnostic actions for a failure and pauses while hovered or focused', () => {
    vi.useFakeTimers()
    document.documentElement.lang = 'en'
    try {
      const onDone = vi.fn()
      const failure = captureFailure('session.pin', new Error('request failed'))
      const view = render(<>
        <Toast text="info" onDone={vi.fn()} />
        <Toast text="success" tone="success" onDone={vi.fn()} />
        <Toast text="failure" failure={failure} onDone={onDone} />
      </>)
      const alerts = view.getAllByRole('alert')
      const containers = alerts.map(alert => alert.closest('[data-jan-notification]')!)
      expect(containers.map(container => container.querySelectorAll('button').length)).toEqual([1, 1, 3])
      const failureToast = containers[2]!.firstElementChild!
      fireEvent.pointerEnter(failureToast)
      vi.advanceTimersByTime(30_000)
      expect(onDone).not.toHaveBeenCalled()
      const action = failureToast.querySelector<HTMLButtonElement>('button')!
      fireEvent.focusIn(action)
      fireEvent.pointerLeave(failureToast)
      vi.advanceTimersByTime(30_000)
      expect(onDone).not.toHaveBeenCalled()
      fireEvent.focusOut(action)
      vi.advanceTimersByTime(30_000)
      expect(onDone).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
