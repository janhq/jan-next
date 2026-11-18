// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { Coachmark, Toggletip } from '@janhq/jan-client-ui-primitives'

function toggle(element: HTMLElement, newState: 'open' | 'closed') {
  fireEvent(element, Object.assign(new Event('toggle'), { newState }))
}

function mockPopover() {
  const prototype = HTMLElement.prototype
  // JSDOM ships the UA [popover] display rule but does not implement the top layer.
  const show = vi.fn(function (this: HTMLElement, _options?: ShowPopoverOptions) { this.style.display = 'block' })
  const hide = vi.fn(function (this: HTMLElement) { this.style.display = 'none' })
  Object.defineProperties(prototype, {
    showPopover: { configurable: true, value: show },
    hidePopover: { configurable: true, value: hide },
  })
  return { show, hide }
}

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(HTMLElement.prototype, 'showPopover')
  Reflect.deleteProperty(HTMLElement.prototype, 'hidePopover')
})

it('connects a native interest and activation invoker and follows both native toggle states', () => {
  const { unmount } = render(<><Toggletip label="More about local models" side="left">Runs on your device.</Toggletip>
    <Toggletip label="More about cloud models">Runs on a provider.</Toggletip></>)
  const button = screen.getByRole('button', { name: 'More about local models' })
  const other = screen.getByRole('button', { name: 'More about cloud models' })
  const hint = screen.getByText('Runs on your device.')
  expect(button.getAttribute('popovertarget')).toBe(hint.id)
  expect(button.getAttribute('popovertargetaction')).toBe('show')
  expect(button.getAttribute('interestfor')).toBe(hint.id)
  expect(button.getAttribute('aria-describedby')).toBe(hint.id)
  expect(other.getAttribute('interestfor')).not.toBe(hint.id)
  expect(hint.getAttribute('role')).toBe('tooltip')
  expect(hint.getAttribute('popover')).toBe('hint')
  expect(hint.dataset.side).toBe('left')
  expect(screen.getByText('Runs on a provider.').dataset.side).toBe('top')
  button.focus()
  toggle(hint, 'open')
  expect(button.getAttribute('aria-expanded')).toBe('true')
  expect(other.getAttribute('aria-expanded')).toBe('false')
  expect(document.activeElement).toBe(button)
  toggle(hint, 'closed')
  expect(button.getAttribute('aria-expanded')).toBe('false')
  unmount()
  toggle(hint, 'open')
  expect(button.getAttribute('aria-expanded')).toBe('false')
})

it('highlights the native anchor without taking focus and dismisses through Escape or its button', () => {
  const { show, hide } = mockPopover()
  const anchor = createRef<HTMLButtonElement>()
  const dismiss = vi.fn()
  const next = vi.fn()
  const props = { anchor, title: 'Switch models', body: <p>Pick a model here.</p>, dismissLabel: 'Dismiss hint', onDismiss: dismiss }
  const scene = (open: boolean) => <><button ref={anchor}>Model selector</button><Coachmark {...props} open={open} side="right"
    step={{ index: 1, total: 3, label: '1 of 3' }} primary={{ label: 'Continue', onSelect: next }} /></>
  const { rerender, unmount } = render(scene(false))
  const trigger = screen.getByRole('button', { name: 'Model selector' })
  trigger.focus()
  expect(show).not.toHaveBeenCalled()
  rerender(scene(true))
  const card = screen.getByRole('dialog', { name: 'Switch models' })
  expect(card.getAttribute('popover')).toBe('manual')
  expect(card.dataset.side).toBe('right')
  expect(show).toHaveBeenCalledWith({ source: trigger })
  expect(trigger.className).not.toBe('')
  expect(document.activeElement).toBe(trigger)
  expect(screen.getByText('1 of 3')).toBeTruthy()
  expect(screen.getByRole('progressbar').getAttribute('aria-valuemax')).toBe('3')
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  expect(next).toHaveBeenCalledOnce()
  fireEvent.keyDown(trigger, { key: 'Enter' })
  expect(dismiss).not.toHaveBeenCalled()
  fireEvent.keyDown(trigger, { key: 'Escape' })
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss hint' }))
  expect(dismiss).toHaveBeenCalledTimes(2)
  rerender(scene(false))
  expect(hide).toHaveBeenCalledOnce()
  expect(trigger.className).toBe('')
  fireEvent.keyDown(trigger, { key: 'Escape' })
  expect(dismiss).toHaveBeenCalledTimes(2)
  rerender(scene(true))
  unmount()
  expect(hide).toHaveBeenCalledTimes(2)
})

it('focuses only on request and leaves Escape to a consumer that has already handled it', () => {
  mockPopover()
  const anchor = createRef<HTMLButtonElement>()
  const onDismiss = vi.fn()
  render(<><button ref={anchor} onKeyDown={event => event.preventDefault()}>Anchor</button>
    <Coachmark anchor={anchor} open focusOnOpen title="More context" body="Optional detail" dismissLabel="Dismiss" onDismiss={onDismiss} /></>)
  const button = screen.getByRole('button', { name: 'Dismiss' })
  expect(document.activeElement).toBe(button)
  expect(screen.getByRole('dialog').dataset.side).toBe('bottom')
  fireEvent.keyDown(screen.getByRole('button', { name: 'Anchor' }), { key: 'Escape' })
  expect(onDismiss).not.toHaveBeenCalled()
})

it('does not open or dismiss an unanchored card', () => {
  const { show } = mockPopover()
  const anchor = createRef<HTMLElement>()
  const onDismiss = vi.fn()
  render(<Coachmark anchor={anchor} open title="Unavailable target" body="Nothing to highlight" dismissLabel="Dismiss" onDismiss={onDismiss} />)
  fireEvent.keyDown(document.body, { key: 'Escape' })
  expect(show).not.toHaveBeenCalled()
  expect(onDismiss).not.toHaveBeenCalled()
})
