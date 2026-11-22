/**
 * Artifacts library: every file the assistant presented in any chat and every
 * web link any chat mentioned, newest first, under Files and Links tabs with
 * search. A row opens beside its chat in the app: a file in the chat's preview
 * tab, a link in its built-in browser tab. A file row also opens in the file's
 * application, reveals it in the file manager, or returns to its chat; a file
 * deleted on disk stays listed as unavailable. A link row also opens in the
 * user's own browser, copies, or returns to its chat.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Button, FileTypeIcon, IconChevronRightOutlineRegular, IconCopyOutlineRegular, IconFolderOpenOutlineRegular,
  IconGlobeOutlineRegular, IconRightUpOutlineRegular, IconSearchOutlineRegular, Input, SegmentedTabs, relativeTime,
} from '@janhq/jan-client-ui-primitives'
import type { ObservableSnapshot } from '@janhq/jan-client-store'
import type { GlobalStandardProps, InjectFace, PropsLocale, PropsRuntime } from '@janhq/jan-client-ui-slots'
import type { SessionId } from '@janhq/jan-session/types'
import {
  ARTIFACT_GROUPS, artifactRows, filterArtifacts, filterLinks, linkRows, unindexedChats,
  type ArtifactAvailabilityMap, type ArtifactGroup, type ArtifactsController, type LinkRow,
} from './artifacts.ts'
import { presentedFileUrl, type PresentedHost } from '../presented.ts'
import type { PresentedOpenController, PresentedOpenPhase } from './present-open.ts'
import type { NS } from './locales.ts'
import css from './ArtifactsPage.module.css'

/** Rows rendered before "show more"; each visible file row stats its file once. */
const PAGE_SIZE = 24
/** How long a copied link's button reads "Copied". */
const COPIED_MS = 1_500

type ArtifactsTab = 'files' | 'links'

/** Callbacks and observed state the plugin supplies to the page. */
export interface ArtifactsInjected {
  hooks: {
    presentedOpen: ObservableSnapshot<Readonly<Record<string, PresentedOpenPhase | undefined>>>
    presentedHost: ObservableSnapshot<PresentedHost | 'error' | null>
    availability: ObservableSnapshot<ArtifactAvailabilityMap>
    scanning: ObservableSnapshot<number>
    resetGeneration: ObservableSnapshot<number>
  }
  reloadPresentedHost: PresentedOpenController['loadHost']
  openPresented: PresentedOpenController['open']
  checkAvailability: ArtifactsController['check']
  hydrate: ArtifactsController['hydrate']
  /** Show a chat in the main area. */
  openChat: (sessionId: SessionId) => void
  /** Show a link's chat with the link in that chat's built-in browser tab. */
  openLink: (sessionId: SessionId, url: string) => void
  /** Open a link in the user's own browser. */
  openInBrowser: (url: string) => void
  /** Show a file's chat with the file in that chat's preview tab. */
  previewFile: (sessionId: SessionId, path: string) => void
}

/** Full props of the library page. */
export type ArtifactsPageProps = PropsRuntime<'main'> & PropsLocale<typeof NS> & InjectFace<ArtifactsInjected>
  & Pick<GlobalStandardProps, 'useSessions'>

/** Compact relative time through the namespace's own dictionary, so words follow the app locale. */
function timeLabel(at: number, now: number, t: ArtifactsPageProps['t']): string {
  const { unit, n } = relativeTime(at, now)
  return unit === 'now' ? t('artifacts.time.now') : t('artifacts.time.ago', { t: t(`artifacts.time.${unit}`, { n }) })
}

/**
 * The Links tab's rows: the link text opens the page in the browser.
 * @param props - visible rows, the chat callback, and localized copy.
 * @returns the link list.
 */
function LinkList({ rows, now, t, openChat, openLink, openInBrowser }: {
  rows: readonly LinkRow[]
  now: number
  t: ArtifactsPageProps['t']
  openChat: ArtifactsInjected['openChat']
  openLink: ArtifactsInjected['openLink']
  openInBrowser: ArtifactsInjected['openInBrowser']
}): ReactNode {
  const [copied, setCopied] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => { clearTimeout(timer.current) }, [])
  const copy = async (row: LinkRow) => {
    try {
      await navigator.clipboard.writeText(row.url)
    } catch {
      return
    }
    setCopied(row.key)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => { setCopied(null) }, COPIED_MS)
  }
  return <ul className={css.rows}>
    {rows.map(row => <li key={row.key} className={css.row} data-link-row={row.url}>
      <span className={css.icon}><IconGlobeOutlineRegular size={22} /></span>
      <div className={css.main}>
        <a className={css.link} href={row.url} target="_blank" rel="noopener noreferrer" title={row.url}
          aria-label={t('artifacts.linkBesideAria', { title: row.title })}
          onClick={(event) => {
            // A modified click keeps the browser's own meaning (new window, background tab).
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
            event.preventDefault()
            openLink(row.sessionId, row.url)
          }}>
          {row.title}
        </a>
        <span className={css.meta}>
          <span className={css.site}>{row.site}</span>
          <span className={css.time}>{t(`artifacts.from.${row.from}`)}</span>
          <span className={css.chat} title={row.chatTitle}>{row.chatTitle}</span>
          <span className={css.time}>{timeLabel(row.time, now, t)}</span>
        </span>
      </div>
      <div className={css.actions}>
        <Button size="sm" variant="outline" icon={<IconRightUpOutlineRegular size={14} />}
          aria-label={t('artifacts.linkOpenAria', { title: row.title })} onClick={() => { openInBrowser(row.url) }}>
          <span className={css.label}>{t('artifacts.openInBrowser')}</span>
        </Button>
        <Button size="sm" variant="outline" icon={<IconCopyOutlineRegular size={14} />}
          aria-label={t('artifacts.copyLinkAria', { title: row.title })} onClick={() => { void copy(row) }}>
          <span className={css.label} role={copied === row.key ? 'status' : undefined}>
            {t(copied === row.key ? 'artifacts.copied' : 'artifacts.copyLink')}
          </span>
        </Button>
        <Button size="sm" variant="outline" icon={<IconChevronRightOutlineRegular size={14} />}
          aria-label={t('artifacts.goToChatAria', { title: row.chatTitle })} onClick={() => { openChat(row.sessionId) }}>
          <span className={css.label}>{t('artifacts.goToChat')}</span>
        </Button>
      </div>
    </li>)}
  </ul>
}

/**
 * Render the library page.
 * @param props - Session list, native open callbacks, availability, and localized copy.
 * @returns the header, Files and Links tabs, search, kind filters, and rows.
 */
export function ArtifactsPage({
  t, useSessions, usePresentedOpen, usePresentedHost, useAvailability, useScanning, useResetGeneration,
  reloadPresentedHost, openPresented, checkAvailability, hydrate, openChat, openLink, openInBrowser, previewFile,
}: ArtifactsPageProps): ReactNode {
  const list = useSessions(state => state)
  const opens = usePresentedOpen(value => value)
  const host = usePresentedHost(value => value)
  const availability = useAvailability(value => value)
  const scanning = useScanning(value => value)
  const resetGeneration = useResetGeneration(value => value)
  const [tab, setTab] = useState<ArtifactsTab>('files')
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState<ArtifactGroup | null>(null)
  const [limit, setLimit] = useState(PAGE_SIZE)
  const rows = useMemo(() => artifactRows(list), [list])
  const links = useMemo(() => linkRows(list), [list])
  const shown = useMemo(() => filterArtifacts(rows, query, group), [rows, query, group])
  const shownLinks = useMemo(() => filterLinks(links, query), [links, query])
  const files = tab === 'files'
  const visible = files ? shown.slice(0, limit) : []
  const visibleKeys = visible.map(row => row.key).join('\n')
  const counts = useMemo(() => {
    const byGroup = new Map<ArtifactGroup, number>()
    for (const row of rows) byGroup.set(row.group, (byGroup.get(row.group) ?? 0) + 1)
    return byGroup
  }, [rows])
  useEffect(() => { hydrate(unindexedChats(list)) }, [list, hydrate])
  useEffect(() => { if (host === null) void reloadPresentedHost() }, [host, reloadPresentedHost])
  // Visible rows are checked again after a connection reset clears their availability.
  useEffect(() => {
    for (const row of visible) void checkAvailability(row)
  }, [visibleKeys, checkAvailability, resetGeneration])
  useEffect(() => { setLimit(PAGE_SIZE) }, [tab, query, group])
  const desktop = host !== null && host !== 'error' && host.available
  const directoryOnly = host === null || host === 'error' || host.fileManager === null
  const total = files ? rows.length : links.length
  const matching = files ? shown.length : shownLinks.length
  const now = Date.now()
  return <section className={css.page} data-artifacts-panel>
    <header className={css.head} data-window-drag>
      <div>
        <h1 className={css.title}>{t('artifacts.title')}</h1>
        <p className={css.intro}>{t(files ? 'artifacts.description' : 'artifacts.linksDescription')}</p>
      </div>
      <span className={css.count} data-artifacts-count>{t('artifacts.count', { count: total })}</span>
    </header>
    <div className={css.body}>
      <div className={css.column}>
        <SegmentedTabs<ArtifactsTab> className={css.tabs} size="sm" label={t('artifacts.tabs')} value={tab} onChange={setTab}
          items={[
            { value: 'files', label: t('artifacts.tab.files'), id: 'artifacts-tab-files', panelId: 'artifacts-panel-files' },
            { value: 'links', label: t('artifacts.tab.links'), id: 'artifacts-tab-links', panelId: 'artifacts-panel-links' },
          ]} />
        <Input type="search" className={css.search as string} icon={<IconSearchOutlineRegular size={16} />}
          placeholder={t(files ? 'artifacts.search' : 'artifacts.linksSearch')}
          aria-label={t(files ? 'artifacts.search' : 'artifacts.linksSearch')} value={query}
          onChange={(event) => { setQuery(event.target.value) }} />
        {files && rows.length > 0 && <div className={css.chips} role="group" aria-label={t('artifacts.filter')}>
          <button type="button" className={css.chip} aria-pressed={group === null} onClick={() => { setGroup(null) }}>
            {t('artifacts.all')}
          </button>
          {ARTIFACT_GROUPS.filter(kind => counts.has(kind)).map(kind => <button key={kind} type="button" className={css.chip}
            data-artifacts-group={kind} aria-pressed={group === kind} onClick={() => { setGroup(kind) }}>
            {t(`artifacts.group.${kind}`)}<span className={css.chipCount}>{counts.get(kind)}</span>
          </button>)}
        </div>}
        {scanning > 0 && <span className={css.status} role="status">{t(files ? 'artifacts.scanning' : 'artifacts.linksScanning')}</span>}
        <div role="tabpanel" id={`artifacts-panel-${tab}`} aria-labelledby={`artifacts-tab-${tab}`}>
          {matching === 0
            ? <div className={css.empty} data-artifacts-empty>
              <span>{files
                ? t(rows.length === 0 ? 'artifacts.empty' : 'artifacts.noMatch')
                : t(links.length === 0 ? 'artifacts.linksEmpty' : 'artifacts.linksNoMatch')}</span>
              {total > 0 && <Button size="sm" variant="outline" onClick={() => { setQuery(''); setGroup(null) }}>
                {t('artifacts.reset')}
              </Button>}
            </div>
            : !files ? <LinkList rows={shownLinks.slice(0, limit)} now={now} t={t} openChat={openChat}
              openLink={openLink} openInBrowser={openInBrowser} />
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
                      {missing ? <span className={css.name} title={row.path}>{row.name}</span>
                        : <button type="button" className={css.nameButton} title={row.path}
                          aria-label={t('artifacts.previewAria', { name: row.name })}
                          onClick={() => { previewFile(row.sessionId, row.path) }}>{row.name}</button>}
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
        </div>
        {matching > limit && <Button className={css.more} size="sm" variant="outline"
          onClick={() => { setLimit(value => value + PAGE_SIZE) }}>
          {t('artifacts.showMore', { count: matching - limit })}
        </Button>}
      </div>
    </div>
  </section>
}
