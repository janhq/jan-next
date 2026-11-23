// @vitest-environment jsdom
/** Git readings under the composer: shown only inside a Git checkout, with the branch and the local line counts. */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@janhq/jan-client-store'
import { bindSnapshotSelector, makeTranslate } from '@janhq/jan-client-test-runtime'
import { GitStrip } from '../src/client/GitStrip.tsx'
import { en } from '../src/client/locales.ts'
import type { PanelSnapshot } from '../src/client/source.ts'
import type { ForgeChangedFile, ForgePanelState } from '../src/types.ts'
import { ready } from './client-fixtures.client.ts'

afterEach(cleanup)

const t = makeTranslate(en)

function strip(state: ForgePanelState | null, blank = false) {
  const panel = createSnapshotStore<PanelSnapshot>({ state, disconnected: false })
  const viewChanges = vi.fn<() => void>()
  const session = createSnapshotStore({ blank })
  const view = render(
    <GitStrip usePanel={bindSnapshotSelector(panel)} useSession={bindSnapshotSelector(session)} viewChanges={viewChanges} t={t} />,
  )
  const root = (): HTMLElement | null => view.container.querySelector<HTMLElement>('[data-forge-git-strip]')
  const publish = (next: ForgePanelState | null): void => { act(() => { panel.set({ state: next, disconnected: false }) }) }
  return { root, publish, viewChanges }
}

const file = (path: string, additions: number, deletions: number): ForgeChangedFile => ({ path, additions, deletions }) as never

describe('GitStrip', () => {
  it('stays hidden outside a Git checkout and until the first inspection', () => {
    const { root, publish } = strip(null)
    expect(root()).toBeNull()
    publish({ ...ready(), checkout: { state: 'pending' } })
    expect(root()).toBeNull()
    publish({ ...ready(), checkout: { state: 'none' } })
    expect(root()).toBeNull()
    publish({ ...ready(), checkout: { state: 'failed', message: 'git missing' } })
    expect(root()).toBeNull()
  })

  it('names the branch and hides the counts while nothing changed', () => {
    const { root } = strip(ready({}, { branch: 'main' }))
    expect(root()?.textContent).toBe('main')
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('names the commit on a detached HEAD', () => {
    const { root } = strip(ready({}, { branch: null, commit: 'abc1234' }))
    expect(root()?.textContent).toBe('abc1234')
  })

  it('sums every changed file and opens the local changes view', () => {
    const { viewChanges } = strip(ready({ local: { base: 'origin/main', files: [file('a.ts', 26000, 3), file('b.ts', 76, 2)] } }, { branch: 'main' }))
    const button = screen.getByRole('button', { name: en['changes.local.viewAria'].replace('{count}', '2').replace('{added}', '26076').replace('{deleted}', '5') })
    expect(button.textContent).toBe('+26,076−5')
    fireEvent.click(button)
    expect(viewChanges).toHaveBeenCalledOnce()
  })

  it('appears when the Session moves into a checkout', () => {
    const { root, publish } = strip({ ...ready(), checkout: { state: 'none' } })
    expect(root()).toBeNull()
    publish(ready({}, { branch: 'feature/x' }))
    expect(root()?.textContent).toBe('feature/x')
  })

  it('leaves the branch to the New Session options on a blank Session, but still shows its changes', () => {
    expect(strip(ready({}, { branch: 'main' }), true).root()).toBeNull()
    cleanup()
    const { root } = strip(ready({ local: { base: 'origin/main', files: [file('a.ts', 4, 1)] } }, { branch: 'main' }), true)
    expect(root()?.textContent).toBe('+4−1')
  })
})
