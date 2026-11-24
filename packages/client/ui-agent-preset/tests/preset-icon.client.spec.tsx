// @vitest-environment jsdom
/**
 * A preset's declared icon: shipped presets name a product glyph, user presets
 * may set one emoji. A glyph name must reach the themed sprite (not print as
 * text), and an emoji must render whole even when it is several code points.
 */
import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { PresetIcon } from '../src/client/PresetIcon.tsx'

afterEach(cleanup)

it('renders a known glyph name through the shared icon sprite', () => {
  const { container } = render(<PresetIcon icon="code-outline" />)
  expect(container.querySelector('use')?.getAttribute('href')).toBe('#dsw-icon-code-outline-regular')
  expect(container.textContent).toBe('')
})

it('renders a user emoji as one whole character', () => {
  const { container } = render(<PresetIcon icon="👩‍💻 extra" />)
  expect(container.querySelector('svg')).toBeNull()
  expect(container.textContent).toBe('👩‍💻')
})

it('falls back to the generic preset glyph when none is declared', () => {
  const { container } = render(<PresetIcon />)
  expect(container.querySelector('use')?.getAttribute('href')).toBe('#dsw-icon-agent-preset-outline-regular')
})
