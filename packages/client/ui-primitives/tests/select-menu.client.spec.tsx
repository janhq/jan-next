// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SelectMenu } from '../src/SelectMenu.tsx'

afterEach(cleanup)

const options = [{ id: 'stable', label: 'Stable' }, { id: 'nightly', label: 'Nightly' }] as const

describe('SelectMenu', () => {
  it('shows the current label and reports a different pick, then closes', () => {
    const onChange = vi.fn()
    render(<SelectMenu value="stable" options={options} onChange={onChange} label="Channel" />)
    const button = screen.getByRole('button', { name: 'Channel' })
    expect(button.textContent).toBe('Stable')
    fireEvent.click(button)
    expect(button.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Nightly' }))
    expect(onChange).toHaveBeenCalledWith('nightly')
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('does not report picking the current option, and stays shut while busy', () => {
    const onChange = vi.fn()
    const { rerender } = render(<SelectMenu value="stable" options={options} onChange={onChange} label="Channel" />)
    fireEvent.click(screen.getByRole('button', { name: 'Channel' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Stable' }))
    expect(onChange).not.toHaveBeenCalled()
    rerender(<SelectMenu value={undefined} options={options} onChange={onChange} label="Channel" placeholder="Unavailable" busy />)
    const button = screen.getByRole('button', { name: 'Channel' })
    expect(button.textContent).toBe('Unavailable')
    fireEvent.click(button)
    expect(screen.queryByRole('menu')).toBeNull()
  })
})
