/** Motion uses reviewed exceptions; existing package colors retain their own snapshot. */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { MOTION_TOKEN_OWNER, motionFiles, motionLiterals, pluginStylesheets } from './motion-scan.ts'
import { packageStylesheets, parseRules } from './stylesheet-scan.ts'

function colorLiterals(css: string): string[] {
  return parseRules(css).flatMap(rule => rule.declarations
    .filter(([property, raw]) => {
      // A var() call, including its fallback, already reads a token.
      const value = raw.replace(/var\([^()]*(?:\([^()]*\)[^()]*)*\)/g, ' ')
      // Mask stops are alpha, not a visible color, so they stay opaque literals.
      return !/mask/.test(property) && /#[\da-f]{3,8}\b|\b(?:rgb|hsl)a?\(/i.test(value)
    })
    .map(([property, value]) => `${rule.selectors.join(', ')}: ${property}: ${value}`))
}

describe('feature style literals', () => {
  it('rejects unshared loop timing, local aliases and custom curves', () => {
    expect(motionLiterals(`
      .spin { animation: spin 1s linear infinite; }
      .a { --local-duration: 200ms; transition: opacity var(--local-duration); }
      .b { animation-timing-function: steps(48, end); }
      .c { transition: opacity var(--ds-transition-duration) ease; }
    `)).toHaveLength(4)
  })

  it('finds motion in static CSS within plugin templates and concatenated strings, ignoring JS comments', () => {
    const source = [
      '// const unused = `.unused { animation: spin 1s linear infinite; }`',
      'const css = `.menu { transition: opacity 180ms ease; color: ${color}; }`',
      "const extra = '.spin {' + 'animation: spin 1s linear infinite}'",
      'const label = "animation: 190ms"',
    ].join('\n')
    expect(pluginStylesheets(source).flatMap(css => motionLiterals(css))).toEqual([
      { selector: '.menu', declaration: 'transition: opacity 180ms ease' },
      { selector: '.spin', declaration: 'animation: spin 1s linear infinite' },
    ])
  })

  it('allows only scoped theme fallbacks and accepts zero-time overrides', () => {
    const css = '.tile { transition: opacity var(--ds-transition-duration-fast, 100ms) var(--ds-ease-in-out, ease); }'
    expect(motionLiterals(css)).toHaveLength(1)
    expect(motionLiterals(css, true)).toEqual([])
    expect(motionLiterals('.stamp { animation: none; transition-delay: 0s; }')).toEqual([])
    expect(motionLiterals('.stamp { animation: spin var(--duration, 1s) linear; }', true)).toHaveLength(1)
    expect(motionLiterals('.a { animation: pulse var(--ds-transition-duration-ambient) linear infinite; }')).toHaveLength(1)
    expect(motionLiterals('.a { animation: spin var(--ds-transition-duration-loop) linear infinite; }')).toEqual([])
  })

  it('rejects literal colors while accepting tokens, fallbacks and masks', () => {
    expect(colorLiterals('.a { color: #3d3d3d; } .b { background: rgba(0, 0, 0, 0.04); }')).toHaveLength(2)
    expect(colorLiterals([
      '.b { color: var(--dsw-alias-label-primary, #3d3d3d); border-color: transparent; }',
      '.fade { mask-image: linear-gradient(#000 24px, transparent); }',
    ].join(' '))).toEqual([])
  })

  it('keeps the existing feature color literals frozen per file', async () => {
    const literals = Object.fromEntries(packageStylesheets()
      .filter(file => /\/packages\/(?:client|experimental)\/[^/]+\/src\//.test(file))
      .filter(file => !file.includes('/packages/client/ui-theme/'))
      .map((file): [string, string[]] => [
        file.slice(file.indexOf('/packages/') + '/packages/'.length), colorLiterals(readFileSync(file, 'utf8')),
      ])
      .filter(([, found]) => found.length > 0)
      .sort(([a], [b]) => a.localeCompare(b)))
    await expect(`${JSON.stringify(literals, null, 2)}\n`).toMatchFileSnapshot('./expected/style-literals.expected.json')
  })

  it('matches only reviewed motion exceptions across package, plugin and app styles', () => {
    const known = new Set<string>()
    const keyOf = (file: string, selector: string, declaration: string) => `${file} | ${selector} | ${declaration}`
    const entries = JSON.parse(readFileSync(new URL('./expected/motion-exceptions.json', import.meta.url), 'utf8')) as
      { file: string; selector: string; declaration: string; reason: string }[]
    for (const { file, selector, declaration, reason } of entries) {
      const key = keyOf(file, selector, declaration)
      expect(reason.trim(), `Missing exception reason: ${key}`).not.toBe('')
      expect(known.has(key), `Duplicate exception: ${key}`).toBe(false)
      known.add(key)
    }
    const unlisted: string[] = []
    for (const { file, stylesheets } of motionFiles()) {
      for (const css of stylesheets) {
        for (const { selector, declaration } of motionLiterals(css, file.endsWith('.js'), file === MOTION_TOKEN_OWNER)) {
          const key = keyOf(file, selector, declaration)
          if (!known.delete(key)) unlisted.push(key)
        }
      }
    }
    expect(unlisted, 'Use a --ds motion token (docs/ui-motion.md). '
      + 'Only add an exception with a reason the reviewer can accept; never regenerate.').toEqual([])
    expect([...known], 'Remove stale motion exceptions from expected/motion-exceptions.json.').toEqual([])
  })
})
