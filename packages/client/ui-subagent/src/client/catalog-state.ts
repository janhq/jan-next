/** Catalog snapshots shared by the header switcher and the composer roster. */
import { useMemo } from 'react'
import type {
  SessionListState, SessionProjectionMap, SessionProjectionSnapshot, SessionSummary,
} from '@janhq/jan-api-session-controller/client'
import type { SessionId } from '@janhq/jan-session/types'
import type { SessionStatusSnapshot } from '@janhq/jan-client-ui-session/client'
import type { TranslateNS } from '@janhq/jan-client-ui-slots'
import type { NS } from './locales.ts'

/** One Session's direct catalog with live activity folded into each entry. */
export type SubagentCatalogSnapshot = Omit<SessionProjectionSnapshot, 'values' | 'state'> & {
  state: 'loading' | 'ready' | 'migration-required' | 'error'
  entries: (SessionProjectionMap['subagentCatalog'][number] & { activity: 'running' | 'inactive' })[]
}

/** Every observed catalog, keyed by its parent Session. */
export type Catalogs = Readonly<Record<SessionId, SubagentCatalogSnapshot>>

/** The catalog-relevant Session list and live status hooks. */
export interface CatalogSources {
  useSessions: <T>(select: (state: SessionListState) => T) => T
  useSessionStatus: <T>(select: (snapshot: SessionStatusSnapshot) => T) => T
}

/**
 * Fold projected membership and Session activity into catalog snapshots.
 * @param sources - Session list and live status hooks.
 * @returns Catalogs plus the summaries their rows read.
 */
export function useCatalogs({ useSessions, useSessionStatus }: CatalogSources): {
  catalogs: Catalogs
  summaries: Readonly<Record<SessionId, SessionSummary>>
} {
  const projections = useSessions(state => state.projectionsBySession)
  const summaries = useSessions(state => state.byId)
  const statuses = useSessionStatus(value => value)
  const catalogs = useMemo<Catalogs>(() => {
    return Object.fromEntries(Object.entries(projections).map(([id, snapshot]) => {
      const projected = snapshot.values.subagentCatalog
      const state = snapshot.state === 'idle'
        ? projected === undefined ? 'loading' : 'ready'
        : snapshot.state === 'migration-required' && projected !== undefined ? 'ready' : snapshot.state
      return [id, {
        state,
        error: snapshot.error,
        entries: (projected ?? []).map(entry => ({
          ...entry,
          activity: (statuses.get(entry.id)?.running ?? summaries[entry.id]?.running) === true
            ? 'running' as const : 'inactive' as const,
        })),
      } satisfies SubagentCatalogSnapshot]
    }))
  }, [projections, summaries, statuses])
  return { catalogs, summaries }
}

/** Only a local child's last closed, normally completed turn receives the completed marker. */
export function completedEntry(entry: SubagentCatalogSnapshot['entries'][number], summary: SessionSummary | undefined): boolean {
  return entry.mode !== 'external' && entry.activity === 'inactive'
    && summary?.projectionValues?.subagentTiming?.lastTurnCompleted === true
}

/** Count direct catalog members without treating external or other inactive entries as completed. */
export function catalogProgress(
  entries: SubagentCatalogSnapshot['entries'],
  summaries: Readonly<Record<SessionId, SessionSummary>>,
  t: TranslateNS<typeof NS>,
): string {
  let completed = 0
  let active = 0
  let inactive = 0
  let external = 0
  for (const entry of entries) {
    if (entry.mode === 'external') external++
    else if (entry.activity === 'running') active++
    else if (completedEntry(entry, summaries[entry.id])) completed++
    else inactive++
  }
  return [
    ...completed > 0 ? [t('progress.completed', { count: completed })] : [],
    ...active > 0 ? [t('progress.active', { count: active })] : [],
    ...inactive > 0 ? [t('progress.inactive', { count: inactive })] : [],
    ...external > 0 ? [t('progress.external', { count: external })] : [],
  ].join('\u2002·\u2002')
}
