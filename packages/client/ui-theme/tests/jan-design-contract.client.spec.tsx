// @vitest-environment jsdom
/**
 * Jan's look follows Mimi's "Jan - Desktop v04" Figma file. mimi-tokens.json is
 * the snapshot extract-figma.mjs pulls from it; these checks hold the Jan
 * theme to that snapshot so a drifting value fails here instead of in review.
 */
import { fireEvent, screen, within } from '@testing-library/react'
import { Context } from '@janhq/cordis'
import { stubConfigForm } from '@janhq/jan-client-test-runtime'
import { describe, expect, it } from 'vitest'
import { ThemeRuntime, type ThemeSettings } from '../src/client/index.ts'
import mimi from '../../../../plugins/jan-theme/design/mimi-tokens.json' with { type: 'json' }
import { janThemeClient, mountAppearance } from './jan-theme-client.tsx'

/** Shell token each Mimi color role sets. Roles absent here have no shell token yet (see DESIGN.md). */
const ROLE_TOKENS: Partial<Record<keyof typeof mimi.colors, string[]>> = {
  'bg-base': ['--dsw-alias-bg-base'],
  'bg-layer-1': ['--dsw-alias-bg-layer-1', '--dsw-alias-bg-overlay', '--dsw-specific-input-major'],
  'bg-layer-2': ['--dsw-alias-bg-layer-2'],
  'label-primary': ['--dsw-alias-label-primary'],
  'label-secondary': ['--dsw-alias-label-secondary'],
  'label-tertiary': ['--dsw-alias-label-tertiary'],
  'border-l1': ['--dsw-alias-border-l1'],
  'border-l2': ['--dsw-alias-border-l2'],
  'interactive-bg-hover': ['--dsw-alias-interactive-bg-hover'],
  'sidebar-item-selected': ['--dsw-specific-sidebar-nav-item-active'],
}

/**
 * Write a Figma paint the way the theme spells it.
 * @param figma - `#RRGGBB` or `#RRGGBB/alpha-percent`.
 * @returns The same hex when opaque, else `rgb(r g b / a%)`.
 */
function css(figma: string): string {
  const [hex = '', alpha] = figma.split('/')
  if (alpha === undefined) return hex
  const channels = [1, 3, 5].map(start => Number.parseInt(hex.slice(start, start + 2), 16))
  return `rgb(${channels.join(' ')} / ${alpha}%)`
}

describe('Jan theme against Mimi Desktop v04', () => {
  it('publishes every drawn color role in both palettes', () => {
    const theme = new ThemeRuntime(new Context(), stubConfigForm<ThemeSettings>().scope)
    const dispose = mountAppearance(theme)
    try {
      const drift = (['light', 'dark'] as const).flatMap((scheme) => {
        theme.setTheme(scheme)
        const tokens = theme.getTheme().active.tokens
        return Object.entries(ROLE_TOKENS).flatMap(([role, names]) => {
          const drawn = mimi.colors[role as keyof typeof mimi.colors][scheme]
          if (drawn === null) return []
          return names.filter(name => tokens[name] !== css(drawn.value)).map(name => `${scheme} ${role} ${name}: ${tokens[name]} != ${css(drawn.value)}`)
        })
      })
      expect(drift).toEqual([])
    } finally {
      dispose()
    }
  })

  it('tints the sidebar with Mimi\'s stop for every accent', async () => {
    const theme = new ThemeRuntime(new Context(), stubConfigForm<ThemeSettings>().scope)
    const dispose = mountAppearance(theme)
    try {
      const swatches = within(screen.getByRole('group', { name: 'Accent color' }))
      const drift: string[] = []
      for (const [name, stops] of Object.entries(mimi.accents)) {
        const label = name[0]!.toUpperCase() + name.slice(1)
        fireEvent.click(swatches.getByRole('button', { name: label }))
        await swatches.findByRole('button', { name: label, pressed: true })
        const root = document.documentElement.style
        for (const [property, expected] of [['--jt-sidebar-light', stops.sidebarLight], ['--jt-sidebar-dark', stops.sidebarDark]] as const) {
          const actual = root.getPropertyValue(property).toUpperCase()
          if (actual !== expected) drift.push(`${name} ${property}: ${actual} != ${expected}`)
        }
      }
      expect(drift).toEqual([])
    } finally {
      dispose()
    }
  })

  it('keeps Jan theme text sizes and corner radii on Mimi\'s scales', () => {
    const sizes = new Set(Object.values(mimi.typography).map(style => style.size))
    // Full-round pills and circles are shapes, not scale steps.
    const radii = new Set([...mimi.scales.radius, 999])
    const sheet = janThemeClient.replace(/\/\*[\s\S]*?\*\//g, '')
    const offScale = [
      ...[...sheet.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].filter(([, size]) => !sizes.has(Number(size))).map(([match]) => match),
      ...[...sheet.matchAll(/border-radius:\s*(\d+(?:\.\d+)?)px/g)].filter(([, size]) => !radii.has(Number(size))).map(([match]) => match),
    ]
    expect(offScale).toEqual([])
  })

  it('rounds the sidebar card and enclosing panels on Mimi\'s radii', () => {
    const theme = new ThemeRuntime(new Context(), stubConfigForm<ThemeSettings>().scope)
    const dispose = mountAppearance(theme)
    try {
      const tokens = theme.getTheme().active.tokens
      expect([tokens['--jt-sidebar-radius'], tokens['--dsw-radius-panel']]).toEqual([`${mimi.radii['sidebar-card']}px`, `${mimi.radii.composer}px`])
    } finally {
      dispose()
    }
  })
})
