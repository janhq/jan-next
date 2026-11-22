// @vitest-environment jsdom
/** A pinned header (search field) keeps its own typing and hands arrows to the rows. */
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Menu, type MenuEntry } from '../src/Menu.tsx'

afterEach(() => { cleanup() })

const entries: MenuEntry[] = [
  { id: 'a', label: 'Alpha' },
  { id: 'b', label: 'Beta' },
]

function Fixture({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('')
  return (
    <Menu open anchor={<button type="button">Open</button>} onClose={onClose}
      header={<input aria-label="Search" value={query} onChange={(event) => { setQuery(event.target.value) }} />}
      items={entries.filter(entry => !('type' in entry) && String(entry.label).toLowerCase().includes(query))} />
  )
}

describe('Menu header', () => {
  it('keeps typed text in the header and enters the rows with ArrowDown', () => {
    const close = vi.fn()
    render(<Fixture onClose={close} />)
    const search = screen.getByRole('textbox', { name: 'Search' })
    search.focus()
    fireEvent.change(search, { target: { value: 'be' } })
    fireEvent.keyDown(search, { key: 'Home' })
    expect(close).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(search)
    expect(screen.getAllByRole('menuitem').map(row => row.textContent)).toEqual(['Beta'])
    fireEvent.keyDown(search, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Beta' }))
  })

  it('closes on Escape from the header', () => {
    const close = vi.fn()
    render(<Fixture onClose={close} />)
    const search = screen.getByRole('textbox', { name: 'Search' })
    search.focus()
    fireEvent.keyDown(search, { key: 'Escape' })
    expect(close).toHaveBeenCalledTimes(1)
  })
})
