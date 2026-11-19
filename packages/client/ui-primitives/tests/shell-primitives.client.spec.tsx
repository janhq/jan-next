// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ColorSwatchGroup, NavRow, Pager, ProjectCard, WindowControls } from '@janhq/jan-client-ui-primitives'

afterEach(cleanup)

it('runs a NavRow quick action without activating the row, and drops it on the rail', () => {
  const open = vi.fn()
  const create = vi.fn()
  const { rerender } = render(<NavRow icon={null} label="Projects" current onClick={open} quick={{ label: 'New project', onClick: create }} />)
  fireEvent.click(screen.getByRole('button', { name: 'New project' }))
  expect(create).toHaveBeenCalledOnce()
  expect(open).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'Projects' }).getAttribute('aria-current')).toBe('page')

  rerender(<NavRow icon={null} label="Projects" rail onClick={open} quick={{ label: 'New project', onClick: create }} />)
  expect(screen.queryByRole('button', { name: 'New project' })).toBeNull()
  expect(screen.queryByText('Projects')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Projects' }))
  expect(open).toHaveBeenCalledOnce()
})

it('presses only the selected swatch and reports the picked id', () => {
  const change = vi.fn()
  render(<ColorSwatchGroup label="Accent color" value="blue" onChange={change} swatches={[
    { id: 'blue', label: 'Blue', color: '#456BDE' }, { id: 'red', label: 'Red', color: '#F0614B' },
  ]} />)
  expect(screen.getByRole('button', { name: 'Blue' }).getAttribute('aria-pressed')).toBe('true')
  expect(screen.getByRole('button', { name: 'Red' }).getAttribute('aria-pressed')).toBe('false')
  fireEvent.click(screen.getByRole('button', { name: 'Red' }))
  expect(change).toHaveBeenCalledWith('red')
})

it('disables each Pager direction on its own and announces the position', () => {
  const next = vi.fn()
  render(<Pager label="Page 1 of 3" previousLabel="Previous page" nextLabel="Next page" previousDisabled onPrevious={vi.fn()} onNext={next} />)
  expect(screen.getByRole('button', { name: 'Previous page' }).hasAttribute('disabled')).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
  expect(next).toHaveBeenCalledOnce()
  expect(screen.getByRole('status').textContent).toBe('Page 1 of 3')
})

it('names the middle caption button by the window state', () => {
  const props = {
    labels: { minimize: 'Minimize', maximize: 'Maximize', restore: 'Restore', close: 'Close' },
    onMinimize: vi.fn(), onToggleMaximize: vi.fn(), onClose: vi.fn(),
  }
  const { rerender } = render(<WindowControls maximized={false} {...props} />)
  expect(screen.getByRole('button', { name: 'Maximize' })).toBeTruthy()
  rerender(<WindowControls maximized {...props} />)
  expect(screen.getByRole('button', { name: 'Restore' })).toBeTruthy()
})

it('shows the full project path on hover and omits an absent meta line', () => {
  const onClick = vi.fn()
  render(<ProjectCard title="jan" path="/Users/me/code/jan" onClick={onClick} />)
  const card = screen.getByRole('button')
  expect(card.getAttribute('title')).toBe('/Users/me/code/jan')
  expect(card.children).toHaveLength(2)
  fireEvent.click(card)
  expect(onClick).toHaveBeenCalledOnce()
})
