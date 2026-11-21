/**
 * Row above the composer while the Session works in a Git checkout: the
 * checked-out branch (or abbreviated commit on a detached HEAD) and, when the
 * `branch` scope changes files, its added and deleted lines, which open the
 * local changes view. Outside a checkout nothing renders; on a blank Session
 * without changes it also stays hidden, since the New Session row already
 * names the branch beside New worktree.
 */

import type { ReactNode } from 'react'
import { IconBranchOutlineRegular } from '@janhq/jan-client-ui-primitives'
import type { HostObservable, InjectFace, PropsLocale } from '@janhq/jan-client-ui-slots'
import type { InputZone } from '@janhq/jan-client-ui-conversation/client'
import type { ForgePanelState } from '../types.ts'
import { Counts } from './DiffFile.tsx'
import type { NS } from './locales.ts'
import type { PanelSnapshot } from './source.ts'
import css from './GitStrip.module.css'

/** Business face of the row. */
export interface GitStripInjected {
  /** Panel snapshot of the Session; the renderer binds it as `usePanel`. */
  readonly hooks: { readonly panel: HostObservable<PanelSnapshot> }
  /** Open the local changes view. */
  readonly viewChanges: () => void
}

/** Full props of the row. */
export type GitStripProps = InjectFace<GitStripInjected> & PropsLocale<typeof NS> & Partial<InputZone>

interface StripFacts {
  readonly name: string
  readonly detached: boolean
  readonly additions: number
  readonly deletions: number
  readonly files: number
}

/**
 * Fold the panel state into what the row shows.
 * @param state - the Session's panel state, or null before the first frame.
 * @returns the facts, or null outside a ready checkout.
 */
export function stripFacts(state: ForgePanelState | null): StripFacts | null {
  if (state?.checkout.state !== 'ready') return null
  const { branch, commit } = state.checkout.checkout
  const name = branch ?? commit
  if (name === null) return null
  let additions = 0
  let deletions = 0
  for (const file of state.local?.files ?? []) {
    additions += file.additions
    deletions += file.deletions
  }
  return { name, detached: branch === null, additions, deletions, files: state.local?.files.length ?? 0 }
}

const sameFacts = (a: StripFacts | null, b: StripFacts | null): boolean => a === b || (a !== null && b !== null
  && a.name === b.name && a.detached === b.detached && a.additions === b.additions && a.deletions === b.deletions && a.files === b.files)

/**
 * Render the Git row.
 * @param props - the panel snapshot, the view action, and copy.
 * @returns the row, or null outside a Git checkout.
 */
export function GitStrip({ usePanel, viewChanges, t, session }: GitStripProps): ReactNode {
  const facts = usePanel(snapshot => stripFacts(snapshot.state), sameFacts)
  if (facts === null || (session?.blank === true && facts.files === 0)) return null
  return (
    <div className={css.dock}>
      <div className={css.strip} data-forge-git-strip="">
        <span className={css.branch} title={facts.detached ? `${t('checkout.detached')} ${facts.name}` : facts.name}>
          <IconBranchOutlineRegular size={14} className={css.icon} />
          <span className={css.name}>{facts.name}</span>
        </span>
        {facts.files > 0 && (
          <button
            type="button"
            className={css.changes}
            aria-label={t('changes.local.viewAria', { count: facts.files, added: facts.additions, deleted: facts.deletions })}
            onClick={viewChanges}
          >
            <Counts file={{ additions: facts.additions, deletions: facts.deletions, binary: false }} t={t} />
          </button>
        )}
      </div>
    </div>
  )
}
