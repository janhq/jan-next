/**
 * Git readings at the top right of the composer, right above its card: the
 * checked-out branch (or abbreviated commit on a detached HEAD)
 * and, when the `branch` scope changes files, its added and deleted lines,
 * which open the local changes view. Outside a checkout nothing renders. On a
 * blank Session the New Session options already name the branch beside New
 * worktree, so only the line counts show, and only when files changed.
 */

import type { ReactNode } from 'react'
import { IconBranchOutlineRegular } from '@janhq/jan-client-ui-primitives'
import type { HostObservable, InjectFace, PropsLocale } from '@janhq/jan-client-ui-slots'
import type {} from '@janhq/jan-client-ui-conversation/client'
import type { SessionSnapshot } from '@janhq/jan-api-session-controller/client'
import type { ForgePanelState } from '../types.ts'
import { Counts } from './DiffFile.tsx'
import type { NS } from './locales.ts'
import type { PanelSnapshot } from './source.ts'
import css from './GitStrip.module.css'

/** Business face of the readings. */
export interface GitStripInjected {
  /** Panel snapshot and Session snapshot; the renderer binds them as `usePanel` and `useSession`. */
  readonly hooks: { readonly panel: HostObservable<PanelSnapshot>; readonly session: HostObservable<Pick<SessionSnapshot, 'blank'>> }
  /** Open the local changes view. */
  readonly viewChanges: () => void
}

/** Full props of the readings. */
export type GitStripProps = InjectFace<GitStripInjected> & PropsLocale<typeof NS>

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
 * Render the Git readings.
 * @param props - the panel and Session snapshots, the view action, and copy.
 * @returns the readings, or null outside a Git checkout.
 */
export function GitStrip({ usePanel, useSession, viewChanges, t }: GitStripProps): ReactNode {
  const facts = usePanel(snapshot => stripFacts(snapshot.state), sameFacts)
  const blank = useSession(snapshot => snapshot.blank)
  if (facts === null || (blank && facts.files === 0)) return null
  return (
    <span className={css.strip} data-forge-git-strip="">
      {!blank && (
        <span className={css.branch} title={facts.detached ? `${t('checkout.detached')} ${facts.name}` : facts.name}>
          <IconBranchOutlineRegular size={14} className={css.icon} />
          <span className={css.name}>{facts.name}</span>
        </span>
      )}
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
    </span>
  )
}
