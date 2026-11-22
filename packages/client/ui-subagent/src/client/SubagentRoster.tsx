/** Composer drop-down over a root Session's subagents: one header, flat rows, each opening its activity trail. */
import { useEffect, useId, useState, type ReactNode } from 'react'
import type { SessionSummary } from '@janhq/jan-api-session-controller/client'
import type { SubagentAddress } from '@janhq/jan-subagent/client'
import type { SessionId } from '@janhq/jan-session/types'
import {
  IconChevronDownOutlineRegular, IconChevronRightOutlineRegular, IconPanelLeftOutlineRegular, IconRefreshOutlineRegular,
  IconUsersOutlineRegular,
  StateDot, Tooltip,
} from '@janhq/jan-client-ui-primitives'
import type { TranslateNS } from '@janhq/jan-client-ui-slots'
import {
  activityDuration, entryName, formatDuration, formatExactDuration, formatTokens, stageLabel, tokenTotal,
} from './catalog-metrics.ts'
import {
  catalogProgress, completedEntry, useCatalogs, type CatalogSources, type Catalogs, type SubagentCatalogSnapshot,
} from './catalog-state.ts'
import type { NS } from './locales.ts'
import css from './SubagentRoster.module.css'

const timestampFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' })

type Entry = SubagentCatalogSnapshot['entries'][number]

/** Navigation and refresh actions the roster borrows from its slot registration. */
export interface SubagentRosterActions {
  openChild: (address: SubagentAddress) => void
  openChildAside: (address: SubagentAddress) => void
  refreshProjection: (parentSessionId: SessionId) => void
}

/** Root Session, its board state, and the catalog sources. */
export type SubagentRosterProps = CatalogSources & SubagentRosterActions & {
  sessionId: SessionId
  /** A visible shared-task list sits under the rows. */
  hasSharedTasks: boolean
  /** Shared tasks or a task-board error keep an empty roster reachable. */
  hasBoardContent: boolean
  renderFooter: () => ReactNode
  t: TranslateNS<typeof NS>
}

type RowContext = SubagentRosterActions & {
  catalogs: Catalogs
  summaries: Readonly<Record<SessionId, SessionSummary>>
  expanded: ReadonlySet<SessionId>
  toggle: (id: SessionId) => void
  now: number
  t: TranslateNS<typeof NS>
}

function statusLabel(entry: Entry, summary: SessionSummary | undefined, t: TranslateNS<typeof NS>): string {
  if (entry.mode === 'external') return t('mode.external')
  if (entry.activity === 'running') return t('activity.running')
  if (completedEntry(entry, summary)) return t('activity.completed')
  const stage = summary?.projectionValues?.subagentActivity?.current
  return stage?.kind === 'failed' || stage?.kind === 'stopped' ? stageLabel(stage, t) : t('activity.inactive')
}

function dotState(entry: Entry, summary: SessionSummary | undefined): 'ongoing' | 'done' | 'error' | 'idle' {
  if (entry.activity === 'running') return 'ongoing'
  if (completedEntry(entry, summary)) return 'done'
  return summary?.projectionValues?.subagentActivity?.current.kind === 'failed' ? 'error' : 'idle'
}

/** One subagent: status, title and usage on a line; its trail and own subagents underneath when open. */
function RosterRow({ entry, parentSessionId, context }: { entry: Entry; parentSessionId: SessionId; context: RowContext }) {
  const { catalogs, summaries, expanded, toggle, now, openChild, openChildAside, t } = context
  const detailId = useId()
  const summary = summaries[entry.id]
  const external = entry.mode === 'external'
  const name = entryName(entry)
  const title = entry.label || summary?.title || name
  const values = summary?.projectionValues
  const model = external ? undefined : values?.modelSelection?.lastUsed?.model
  const total = tokenTotal(values?.tokenUsage)
  const elapsed = activityDuration(summary, entry.activity, now)
  const migration = summary?.formatStatus === 'migration-required' || catalogs[entry.id]?.state === 'migration-required'
  const open = !external && expanded.has(entry.id)
  const address = entry.mode === 'external' ? undefined : { parentSessionId, childSessionId: entry.id, mode: entry.mode }
  const line = (
    <>
      <StateDot state={dotState(entry, summary)} size={12} />
      <span className={css.status}>{statusLabel(entry, summary, t)}</span>
      <span className={css.title}>{title}</span>
      {!external && <IconChevronRightOutlineRegular size={12} className={css.chevron} aria-hidden />}
    </>
  )
  const children = catalogs[entry.id]?.entries ?? []
  return (
    <li className={css.row} data-open={open || undefined}>
      <div className={css.line}>
        {external ? <div className={css.toggle}>{line}</div> : (
          <button type="button" className={css.toggle} aria-expanded={open} aria-controls={detailId}
            onClick={() => { toggle(entry.id) }}>
            {line}
          </button>
        )}
        {(total !== undefined || elapsed !== undefined) && (
          <span className={css.metrics}>
            {total !== undefined && <span>{t('tokens.total', { value: formatTokens(total, t) })}</span>}
            {elapsed !== undefined && (
              <span title={t('duration.exactTitle', { duration: formatExactDuration(elapsed, t) })}>{formatDuration(elapsed, t)}</span>
            )}
          </span>
        )}
        {address !== undefined && (
          <Tooltip label={t('open.sidebar')} delayMs={500} side="top" align="end">
            <button type="button" className={css.aside} aria-label={t('open.sidebar.aria', { label: title })}
              onClick={() => { openChildAside(address) }}>
              <IconPanelLeftOutlineRegular size={14} />
            </button>
          </Tooltip>
        )}
      </div>
      {open && address !== undefined && (
        <div id={detailId} className={css.detail}>
          <div className={css.meta}>
            {title !== name && <span>{name}</span>}
            {model !== undefined && <span>{model}</span>}
            {migration && <span>{t('catalog.migrationRequired')}</span>}
            <button type="button" className={css.openChat} onClick={() => { openChild(address) }}>
              {t('open.chat')}
            </button>
          </div>
          <ol className={css.trail}>
            {(values?.subagentActivity?.recent ?? []).map(item => (
              <li key={item.seq}>
                <span>{stageLabel(item, t)}</span>
                <time dateTime={new Date(item.at).toISOString()}>{timestampFormat.format(item.at)}</time>
              </li>
            ))}
            {values?.subagentActivity == null && <li><span>{stageLabel(undefined, t)}</span></li>}
          </ol>
          {children.length > 0 && (
            <ul className={css.rows}>
              {children.map(child => (
                <RosterRow key={child.id} entry={child} parentSessionId={entry.id} context={context} />
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  )
}

/** Rows of one parent's subagents with their own disclosure and live clock. */
export type SubagentRowListProps = SubagentRosterActions & {
  parentSessionId: SessionId
  entries: readonly Entry[]
  catalogs: Catalogs
  summaries: Readonly<Record<SessionId, SessionSummary>>
  t: TranslateNS<typeof NS>
}

/**
 * The roster's rows, shared by the composer drop-down and each turn's header.
 * @param props - parent Session, its listed entries, catalogs and actions.
 * @returns The row list; durations tick each second while any listed branch runs.
 */
export function SubagentRowList({
  parentSessionId, entries, catalogs, summaries, openChild, openChildAside, refreshProjection, t,
}: SubagentRowListProps) {
  const [expanded, setExpanded] = useState<ReadonlySet<SessionId>>(() => new Set())
  const [now, setNow] = useState(() => Date.now())
  const live = Object.values(catalogs).some(branch => branch.entries.some(entry => entry.activity === 'running'))
  useEffect(() => {
    if (!live) return
    const timer = setInterval(() => { setNow(Date.now()) }, 1_000)
    return () => { clearInterval(timer) }
  }, [live])
  const toggle = (id: SessionId): void => {
    if (!expanded.has(id)) refreshProjection(id)
    setExpanded((current) => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
    })
  }
  const context: RowContext = {
    catalogs, summaries, expanded, toggle, now: Math.max(now, Date.now()), openChild, openChildAside, refreshProjection, t,
  }
  return (
    <ul className={css.rows}>
      {entries.map(entry => <RosterRow key={entry.id} entry={entry} parentSessionId={parentSessionId} context={context} />)}
    </ul>
  )
}

/**
 * The composer's subagent drop-down for a root Session. It shows while a child or
 * the root runs, or while shared tasks or a load error need it; finished subagents
 * otherwise live on their turn's header.
 * @param props - root Session, board state, catalog sources and actions.
 * @returns A header that opens the roster in place, or null with nothing to show.
 */
export function SubagentRoster({ sessionId, hasBoardContent, useSessions, useSessionStatus, ...rest }: SubagentRosterProps) {
  const { catalogs, summaries } = useCatalogs({ useSessions, useSessionStatus })
  const rootRunning = useSessionStatus(snapshot => snapshot.get(sessionId)?.running === true)
  const catalog: SubagentCatalogSnapshot | undefined = catalogs[sessionId]
    ?? (hasBoardContent ? { entries: [], state: 'loading', error: null } : undefined)
  const childRunning = catalog?.entries.some(entry => entry.activity === 'running') === true
  // Hiding unmounts the body, so a roster that comes back starts closed.
  if (catalog === undefined || (catalog.entries.length === 0 && !hasBoardContent && catalog.state !== 'error')) return null
  if (!childRunning && !rootRunning && !hasBoardContent && catalog.state !== 'error') return null
  return <RosterBody sessionId={sessionId} catalog={catalog} catalogs={catalogs} summaries={summaries} {...rest} />
}

function RosterBody({
  sessionId, catalog, catalogs, summaries, hasSharedTasks, renderFooter, openChild, openChildAside, refreshProjection, t,
}: Omit<SubagentRosterProps, 'hasBoardContent' | keyof CatalogSources> & {
  catalog: SubagentCatalogSnapshot
  catalogs: Catalogs
  summaries: Readonly<Record<SessionId, SessionSummary>>
}) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const runningId = useId()
  const entries = catalog.entries
  const running = entries.filter(entry => entry.activity === 'running').length
  const totalKey = entries.length === 1 ? 'count.total.one' : 'count.total.other'
  const progress = catalogProgress(entries, summaries, t)
  return (
    <section className={css.seat} aria-label={t('section.title')} data-subagent-action>
      <button type="button" className={css.header} aria-expanded={open} aria-controls={panelId}
        aria-describedby={running > 0 ? runningId : undefined} onClick={() => { setOpen(!open) }}>
        <span className={css.headerIcon} aria-hidden>
          {running > 0 ? <StateDot state="ongoing" /> : <IconUsersOutlineRegular size={14} />}
        </span>
        <span data-subagent-count>{t(totalKey, { count: entries.length })}</span>
        {progress !== '' && <span className={css.progress}>{progress}</span>}
        <IconChevronDownOutlineRegular size={12} className={css.chevron} aria-hidden />
      </button>
      {running > 0 && (
        <span id={runningId} hidden>{t(running === 1 ? 'count.running.one' : 'count.running.other', { count: running })}</span>
      )}
      {open && (
        <div id={panelId} className={css.panel} data-subagent-panel>
          {catalog.state === 'loading' && entries.length === 0 && <p className={css.notice}>{t('loading.label')}</p>}
          {catalog.state === 'error' && (
            <div className={css.error}>
              <span>{catalog.error?.message ?? t('load.error')}</span>
              <button type="button" className={css.refresh} onClick={() => { refreshProjection(sessionId) }}>
                <IconRefreshOutlineRegular size={12} />
                {t('retry')}
              </button>
            </div>
          )}
          {hasSharedTasks && catalog.state === 'ready' && entries.length === 0 && (
            <p className={css.notice}>{t('section.empty')}</p>
          )}
          {entries.length > 0 && (
            <SubagentRowList parentSessionId={sessionId} entries={entries} catalogs={catalogs} summaries={summaries}
              openChild={openChild} openChildAside={openChildAside} refreshProjection={refreshProjection} t={t} />
          )}
          {renderFooter()}
        </div>
      )}
    </section>
  )
}
