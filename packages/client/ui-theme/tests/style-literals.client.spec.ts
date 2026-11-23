/**
 * Feature stylesheets take interaction motion and color from theme tokens
 * (plugins/jan-theme/design/DESIGN.md). Literals already in the tree are
 * frozen per file, so a new feature cannot add one without the diff showing it.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { packageStylesheets, parseRules } from './stylesheet-scan.ts'

const MOTION_PROPERTY = /^(?:transition|animation)(?:-duration|-timing-function|-delay)?$/
// Loops of half a second or longer (spinners, shimmer, pulses) are drawings, not interaction feedback.
const LOOP_MS = 500

/**
 * Find motion durations and curves, and colors, written as literals instead of theme tokens.
 * @param css - Component stylesheet text.
 * @returns Selector and declaration pairs that need a token.
 */
function styleLiterals(css: string): string[] {
  return parseRules(css).flatMap(rule => rule.declarations
    .filter(([property, raw]) => {
      // A var() call, including its fallback, already reads a token.
      const value = raw.replace(/var\([^()]*(?:\([^()]*\)[^()]*)*\)/g, ' ')
      // Mask stops are alpha, not a visible color, so they stay opaque literals.
      if (!/mask/.test(property) && /#[\da-f]{3,8}\b|\b(?:rgb|hsl)a?\(/i.test(value)) return true
      if (!MOTION_PROPERTY.test(property)) return false
      const durations = [...value.matchAll(/(?<![\w.-])(\d*\.?\d+)(ms|s)\b/g)]
        .map(([, number = '', unit]) => Number(number) * (unit === 's' ? 1000 : 1)).filter(ms => ms > 0)
      if (durations.some(ms => ms < LOOP_MS)) return true
      return durations.length === 0 && /\bcubic-bezier\(|\bease(?:-in|-out|-in-out)?\b/.test(value)
    })
    .map(([property, value]) => `${rule.selectors.join(', ')}: ${property}: ${value}`))
}

describe('feature style literals', () => {
  it('rejects literal motion and color while accepting tokens, fallbacks, masks and long loops', () => {
    expect(styleLiterals('.a { transition: opacity 120ms ease; }')).toHaveLength(1)
    expect(styleLiterals('.a { transition: transform var(--ds-transition-duration) cubic-bezier(0.2, 0, 0, 1); }')).toHaveLength(1)
    expect(styleLiterals('.a { animation-duration: .2s; }')).toHaveLength(1)
    expect(styleLiterals('.a { color: #3d3d3d; } .b { background: rgba(0, 0, 0, 0.04); }')).toHaveLength(2)
    expect(styleLiterals([
      '.a { transition: opacity var(--ds-transition-duration-fast) var(--ds-ease-out); }',
      '.b { color: var(--dsw-alias-label-primary, #3d3d3d); border-color: transparent; }',
      '.spin { animation: spin 1s linear infinite; } .pulse { animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite; }',
      '.c { transition: none; } .d { transition-delay: 0s; } .fade { mask-image: linear-gradient(#000 24px, transparent); }',
    ].join(' '))).toEqual([])
  })

  it('keeps feature stylesheets on theme motion and color, with existing literals frozen per file', async () => {
    const literals = Object.fromEntries(packageStylesheets()
      .filter(file => /\/packages\/(?:client|experimental)\/[^/]+\/src\//.test(file))
      .filter(file => !file.includes('/packages/client/ui-theme/'))
      .map((file): [string, string[]] => [file.slice(file.indexOf('/packages/') + '/packages/'.length), styleLiterals(readFileSync(file, 'utf8'))])
      .filter(([, found]) => found.length > 0)
      .sort(([a], [b]) => a.localeCompare(b)))
    // A new entry here is a literal to replace with a token; regenerate with `vitest -u` only for a deliberate exception.
    await expect(`${JSON.stringify(literals, null, 2)}\n`).toMatchFileSnapshot('./expected/style-literals.expected.json')
  })
})
