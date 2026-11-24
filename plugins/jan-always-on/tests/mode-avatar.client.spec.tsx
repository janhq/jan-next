// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import type * as ReactTypes from 'react'
import { afterEach, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const React: typeof ReactTypes = createRequire(require.resolve('@testing-library/react'))('react')
const h = React.createElement

type Bot = { id: string; name: string; createdAt: number; latest?: { at: number }; avatar?: { shape: number; color: string } }
type Appearance = { shape: number; color: string }
type AvatarOptions = { definition: { id: string }; color: string; reducedMotion: boolean; followPointer: boolean; mood: string; label: string }

function loadAvatars() {
  const chunks = new Map<string, object>()
  for (const chunk of ['client.open-bot-avatar.js', 'client.avatar.js']) {
    const source = readFileSync(join(import.meta.dirname, '..', chunk), 'utf8')
    runInNewContext(source, {
      window: { matchMedia: window.matchMedia, __ModuleLoader__: {
        load: ({ factory }: { factory: (require: () => typeof React) => object }) => { chunks.set(chunk, factory(() => React)) },
      } },
    }, { filename: chunk })
  }
  return chunks.get('client.avatar.js') as {
    appearanceFor(name: string): Appearance
    ModeSquad: ReactTypes.ComponentType<{ rows: Bot[] | null; mountBotAvatar: typeof mountBotAvatar }>
  }
}

// The avatar renderer has its own DOM tests. Capture the appearance and motion inputs sent by this row.
const update = vi.fn()
const destroy = vi.fn()
const mountBotAvatar = vi.fn((_host: Element, _options: AvatarOptions) => ({ update, destroy }))
const mounted = () => mountBotAvatar.mock.calls.map(([, options]) => options)

function mockMotion(reduced = false) {
  const preference = Object.assign(new EventTarget(), { matches: reduced })
  const hover = Object.assign(new EventTarget(), { matches: true })
  vi.stubGlobal('matchMedia', (query: string) => query === '(prefers-reduced-motion: reduce)' ? preference : hover)
  return preference
}

afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals() })

it('shows the four most recent bots, using saved or name-derived appearances', () => {
  mockMotion()
  const { ModeSquad, appearanceFor } = loadAvatars()
  expect(ModeSquad).toBeTypeOf('function')
  const rows = [
    { id: 'quiet', name: 'Quiet', createdAt: 10 },
    { id: 'reader', name: 'Reader', createdAt: 1, latest: { at: 300 }, avatar: { shape: 1, color: '#334455' } },
    { id: 'scribe', name: 'Scribe', createdAt: 30 },
    { id: 'watcher', name: 'Watcher', createdAt: 15, latest: { at: 70 } },
    { id: 'helper', name: 'Helper', createdAt: 45 },
  ]
  render(h('button', { role: 'menuitem', type: 'button' }, h(ModeSquad, { rows, mountBotAvatar })))
  expect(mounted().map(({ color }) => color)).toEqual([
    '#334455', appearanceFor('Watcher').color, appearanceFor('Helper').color, appearanceFor('Scribe').color,
  ])
  expect(mounted()[0]?.definition.id).toBe('round')
})

it.each([[null], [[]]] as const)('shows the four fallback silhouettes before or without bots: %j', (rows) => {
  mockMotion()
  const { ModeSquad } = loadAvatars()
  const { container } = render(h('button', { role: 'menuitem', type: 'button' }, h(ModeSquad, { rows, mountBotAvatar })))
  expect(mounted().map(({ definition }) => definition.id)).toEqual(['round', 'chat', 'square', 'capsule'])
  expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull()
})

it('stops pointer tracking for reduced motion and disposes its renderer on menu close', () => {
  const preference = mockMotion(true)
  const { ModeSquad } = loadAvatars()
  const { container, unmount } = render(h('button', { role: 'menuitem', type: 'button' }, h(ModeSquad, { rows: [], mountBotAvatar })))
  const squad = container.querySelector('.jao-mode-squad')
  expect(squad?.classList.contains('jao-mode-squad-reduced-motion')).toBe(true)
  expect(mounted().every(({ reducedMotion, followPointer, label }) => reducedMotion && !followPointer && label === '')).toBe(true)
  act(() => { preference.matches = false; preference.dispatchEvent(new Event('change')) })
  expect(squad?.classList.contains('jao-mode-squad-reduced-motion')).toBe(false)
  expect(update.mock.lastCall?.[0]).toMatchObject({ reducedMotion: false, followPointer: true })
  unmount()
  expect(destroy).toHaveBeenCalledTimes(4)
})
