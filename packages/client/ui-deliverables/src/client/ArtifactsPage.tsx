/**
 * Artifacts library: every file the assistant presented in any chat, newest
 * first, with search and kind filters. Each row opens the file, reveals it in
 * the file manager, or returns to its chat; a file deleted on disk stays listed
 * as unavailable.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Button, FileTypeIcon, IconChevronRightOutlineRegular, IconFolderOpenOutlineRegular, IconRightUpOutlineRegular,
  IconSearchOutlineRegular, Input, relativeTime,
} from '@janhq/jan-client-ui-primitives'
import type { ObservableSnapshot } from '@janhq/jan-client-store'
import type { GlobalStandardProps, InjectFace, PropsLocale, PropsRuntime } from '@janhq/jan-client-ui-slots'
import type { SessionId } from '@janhq/jan-session/types'
import {
  ARTIFACT_GROUPS, artifactRows, filterArtifacts, unindexedChats,
  type ArtifactAvailabilityMap, type ArtifactGroup, type ArtifactsController,
} from './artifacts.ts'
import { presentedFileUrl, type PresentedHost } from '../presented.ts'
import type { PresentedOpenController, PresentedOpenPhase } from './present-open.ts'
import type { NS } from './locales.ts'
import css from './ArtifactsPage.module.css'

/** Rows rendered before "show more"; each visible row stats its file once. */
const PAGE_SIZE = 24

/** Callbacks and observed state the plugin supplies to the page. */
export interface ArtifactsInjected {
  hooks: {
    presentedOpen: ObservableSnapshot<Readonly<Record<string, PresentedOpenPhase | undefined>>>
    presentedHost: ObservableSnapshot<PresentedHost | 'error' | null>
    availability: ObservableSnapshot<ArtifactAvailabilityMap>
    scanning: ObservableSnapshot<number>
  }
  reloadPresentedHost: PresentedOpenController['loadHost']
  openPresented: PresentedOpenController['open']
  checkAvailability: ArtifactsController['check']
  hydrate: ArtifactsController['hydrate']
  /** Show a chat in the main area. */
  openChat: (sessionId: SessionId) => void
}

/** Full props of the library page. */
export type ArtifactsPageProps = PropsRuntime<'main'> & PropsLocale<typeof NS> & InjectFace<ArtifactsInjected>
  & Pick<GlobalStandardProps, 'useSessions'>

/** Compact relative time through the namespace's own dictionary, so words follow the app locale. */
function timeLabel(at: number, now: number, t: ArtifactsPageProps['t']): string {
  const { unit, n } = relativeTime(at, now)
  return t('artifacts.time.ago', { t: unit === 'now' ? t('artifacts.time.now') : t(`artifacts.time.${unit}`, { n }) })
}

/**
 * Render the library page.
 * @param props - Session list, native open callbacks, availability, and localized copy.
 * @returns the header, search, kind filters, and file rows.
 */
export function ArtifactsPage({
  t, useSessions, usePresentedOpen, usePresentedHost, useAvailability, useScanning,
  reloadPresentedHost, openPresented, checkAvailability, hydrate, openChat,
}: ArtifactsPageProps): ReactNode {
  const list = useSessions(state => state)
  const opens = usePresentedOpen(value => value)
  const host = usePresentedHost(value => value)
  const availability = useAvailability(value => value)
  const scanning = useScanning(value => value)
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState<ArtifactGroup | null>(null)
  const [limit, setLimit] = useState(PAGE_SIZE)
  const rows = useMemo(() => artifactRows(list), [list])
  const shown = useMemo(() => filterArtifacts(rows, query, group), [rows, query, group])
  const visible = shown.slice(0, limit)
  const visibleKeys = visible.map(row => row.key).join('\n')
  const counts = useMemo(() => {
    const byGroup = new Map<ArtifactGroup, number>()
    for (const row of rows) byGroup.set(row.group, (byGroup.get(row.group) ?? 0) + 1)
    return byGroup
  }, [rows])
  useEffect(() => { hydrate(unindexedChats(list)) }, [list, hydrate])
  useEffect(() => { if (host === null) void reloadPresentedHost() }, [host, reloadPresentedHost])
  // The key stands for the visible rows; a list refresh that keeps them does not stat again.
  useEffect(() => {
    for (const row of visible) void checkAvailability(row)
  }, [visibleKeys, checkAvailability])
  useEffect(() => { setLimit(PAGE_SIZE) }, [query, group])
  const desktop = host !== null && host !== 'error' && host.available
  const directoryOnly = host === null || host === 'error' || host.fileManager === null
  const now = Date.now()
  return <section className={css.page} data-artifacts-panel>
    <header className={css.head} data-window-drag>
      <div>
        <h1 className={css.title}>{t('artifacts.title')}</h1>
        <p className={css.intro}>{t('artifacts.description')}</p>
      </div>
      <span className={css.count} data-artifacts-count>{t('artifacts.count', { count: rows.length })}</span>
    </header>
    <div className={css.body}>
      <div className={css.column}>
        <Input type="search" className={css.search as string} icon={<IconSearchOutlineRegular size={16} />}
          placeholder={t('artifacts.search')} aria-label={t('artifacts.search')} value={query}
          onChange={(event) => { setQuery(event.target.value) }} />
        {rows.length > 0 && <div className={css.chips} role="group" aria-label={t('artifacts.filter')}>
          <button type="button" className={css.chip} aria-pressed={group === null} onClick={() => { setGroup(null) }}>
            {t('artifacts.all')}
          </button>
          {ARTIFACT_GROUPS.filter(kind => counts.has(kind)).map(kind => <button key={kind} type="button" className={css.chip}
            data-artifacts-group={kind} aria-pressed={group === kind} onClick={() => { setGroup(kind) }}>
            {t(`artifacts.group.${kind}`)}<span className={css.chipCount}>{counts.get(kind)}</span>
          </button>)}
        </div>}
        {scanning > 0 && <span className={css.status} role="status">{t('artifacts.scanning')}</span>}
        {shown.length === 0
          ? <div className={css.empty} data-artifacts-empty>
            <span>{t(rows.length === 0 ? 'artifacts.empty' : 'artifacts.noMatch')}</span>
            {rows.length > 0 && <Button size="sm" variant="outline" onClick={() => { setQuery(''); setGroup(null) }}>
              {t('artifacts.reset')}
            </Button>}
          </div>
          : <ul className={css.rows}>
            {visible.map((row) => {
              const missing = availability[row.key] === 'missing'
              const phase = opens[presentedFileUrl(row.sessionId, row.seq, row.index)]
              const busy = phase === 'opening' || phase === 'revealing'
              const failure = phase === 'error' || phase === 'revealError' || phase === 'nativeUnavailable' ? phase : undefined
              const blocked = !desktop || missing || busy
              return <li key={row.key} className={css.row} data-artifact-row={row.key} data-missing={missing || undefined}>
                <span className={css.icon}><FileTypeIcon path={row.path} size={28} /></span>
                <div className={css.main}>
                  <span className={css.name} title={row.path}>{row.name}</span>
                  <span className={css.meta}>
                    <span className={css.chat} title={row.chatTitle}>{row.chatTitle}</span>
                    <span className={css.time}>{timeLabel(row.time, now, t)}</span>
                  </span>
                  {(missing || failure !== undefined) && <span className={css.status} role="status" data-error={!missing || undefined}>
                    {missing || failure === undefined ? t('artifacts.unavailable')
                      : t(directoryOnly && failure === 'revealError' ? 'presented.directoryError' : `presented.${failure}`)}
                  </span>}
                </div>
                <div className={css.actions}>
                  <Button size="sm" variant="outline" disabled={blocked} icon={<IconRightUpOutlineRegular size={14} />}
                    aria-label={t('artifacts.openAria', { name: row.name })}
                    onClick={() => { void openPresented(row.sessionId, row.seq, row.index, 'open') }}>
                    <span className={css.label}>{t('artifacts.open')}</span>
                  </Button>
                  <Button size="sm" variant="outline" disabled={blocked} icon={<IconFolderOpenOutlineRegular size={14} />}
                    aria-label={t('artifacts.revealAria', { name: row.name })}
                    onClick={() => { void openPresented(row.sessionId, row.seq, row.index, 'reveal') }}>
                    <span className={css.label}>{t('artifacts.reveal')}</span>
                  </Button>
                  <Button size="sm" variant="outline" icon={<IconChevronRightOutlineRegular size={14} />}
                    aria-label={t('artifacts.goToChatAria', { title: row.chatTitle })}
                    onClick={() => { openChat(row.sessionId) }}>
                    <span className={css.label}>{t('artifacts.goToChat')}</span>
                  </Button>
                </div>
              </li>
            })}
          </ul>}
        {shown.length > limit && <Button className={css.more} size="sm" variant="outline"
          onClick={() => { setLimit(value => value + PAGE_SIZE) }}>
          {t('artifacts.showMore', { count: shown.length - limit })}
        </Button>}
      </div>
    </div>
  </section>
}
