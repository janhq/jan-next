/** Composer roster backed only by the existing catalog and child Session summaries. */
import { useEffect, useId, useState } from 'react'
import type { SessionSummary } from '@janhq/jan-api-session-controller/client'
import type { SessionId } from '@janhq/jan-session/types'
import type { SubagentActivityEntry, SubagentAddress, SubagentCatalogEntry } from '@janhq/jan-subagent/client'
import {
  IconChevronDownOutlineRegular, IconChevronRightOutlineRegular, IconUsersOutlineRegular, StateDot, Tooltip,
} from '@janhq/jan-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime, TranslateNS } from '@janhq/jan-client-ui-slots'
import { activityDuration, entryName, formatDuration, formatExactDuration, formatTokens, tokenTotal } from './catalog-metrics.ts'
import type { NS } from './locales.ts'
import css from './SubagentActivityDock.module.css'

const RECENT_WINDOW_MS = 30_000
const timestampFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' })

/** Actions supplied to the composer dock by its slot registration. */
export interface SubagentActivityDockInjected {
  /** Open the existing sidebar conversation without changing the parent view. */
  openChildAside: (address: SubagentAddress) => void
}

/** Standard Session hooks, locale, and actions for the composer dock. */
export type SubagentActivityDockProps = PropsRuntime<'conversation.input.dock'>
  & InjectFace<SubagentActivityDockInjected> & PropsLocale<typeof NS>

type LocalChild = Exclude<SubagentCatalogEntry, { mode: 'external' }>
type Row = { entry: LocalChild; summary: SessionSummary | undefined; running: boolean }

function stageLabel(stage: SubagentActivityEntry | undefined, t: TranslateNS<typeof NS>): string {
  if (stage === undefined) return t('dock.stage.unavailable')
  if (stage.kind === 'calling-tool') {
    return stage.tool === null ? t('dock.stage.calling-tool') : t('dock.stage.named-tool', { tool: stage.tool })
  }
  return t(`dock.stage.${stage.kind}`)
}

function ActivityRow({ row, now, parentSessionId, openChildAside, t }: {
  row: Row
  now: number
  parentSessionId: SessionId
} & SubagentActivityDockInjected & PropsLocale<typeof NS>) {
  const { entry, summary, running } = row
  const name = entryName(entry)
  const values = summary?.projectionValues
  const activity = values?.subagentActivity
  const stage = activity?.current
  const terminal = stage?.kind === 'finished' || stage?.kind === 'failed' || stage?.kind === 'stopped'
  const model = values?.modelSelection?.lastUsed?.model
  const total = tokenTotal(values?.tokenUsage)
  const elapsed = activityDuration(summary, running ? 'running' : 'inactive', now)
  const [expanded, setExpanded] = useState(false)
  const historyId = useId()
  const state = running ? 'ongoing' : stage?.kind === 'finished' ? 'done' : stage?.kind === 'failed' ? 'error' : 'idle'
  const rowLabel = (
    <>
      <StateDot state={state} size={12} />
      <span className={css.identity}>
        <span className={css.primary}>
          <span className={css.name}>{name}</span>
          {model !== undefined && <span className={css.model}>{model}</span>}
        </span>
        <span className={css.stage}>{stageLabel(running && terminal ? undefined : stage, t)}</span>
      </span>
      <span className={css.metrics}>
        {elapsed !== undefined && (
          <span aria-label={t('duration.exactTitle', { duration: formatExactDuration(elapsed, t) })}>{formatDuration(elapsed, t)}</span>
        )}
        {total !== undefined && <span>{t('tokens.total', { value: formatTokens(total, t) })}</span>}
      </span>
    </>
  )
  return (
    <li className={css.row}>
      <div className={css.rowMain}>
        {activity == null ? <div className={css.rowLabel}>{rowLabel}</div> : (
          <button type="button" className={css.rowLabel} aria-expanded={expanded} aria-controls={historyId} onClick={() => { setExpanded(!expanded) }}>
            {rowLabel}
            {expanded ? <IconChevronDownOutlineRegular size={12} /> : <IconChevronRightOutlineRegular size={12} />}
          </button>
        )}
        <Tooltip label={t('open.sidebar')} delayMs={500} side="top" align="end">
          <button type="button" className={css.openAside} aria-label={t('open.sidebar.aria', { label: name })}
            onClick={() => { openChildAside({ parentSessionId, childSessionId: entry.id, mode: entry.mode }) }}>
            <IconChevronRightOutlineRegular size={14} />
          </button>
        </Tooltip>
      </div>
      {activity != null && (
        <ol id={historyId} className={css.history} hidden={!expanded}>
          {expanded && activity.recent.map(item => (
            <li key={item.seq} className={css.historyLine}>
              <time dateTime={new Date(item.at).toISOString()}>{timestampFormat.format(item.at)}</time>
              <span>{stageLabel(item, t)}</span>
            </li>
          ))}
        </ol>
      )}
    </li>
  )
}

/**
 * Show direct running children and briefly retain settled children above the composer.
 * @param props - Session-bound slot props and the existing sidebar action.
 * @returns The roster when it has visible children, otherwise null.
 */
export function SubagentActivityDock({ sessionId, useSessions, useSessionStatus, openChildAside, t }: SubagentActivityDockProps) {
  const entries = useSessions(state => state.projectionsBySession[sessionId]?.values.subagentCatalog)
  return entries === undefined || entries.length === 0 ? null : (
    <ActivityDockRows entries={entries} sessionId={sessionId} useSessions={useSessions}
      useSessionStatus={useSessionStatus} openChildAside={openChildAside} t={t} />
  )
}

function ActivityDockRows({ entries, sessionId, useSessions, useSessionStatus, openChildAside, t }: {
  entries: readonly SubagentCatalogEntry[]
} & Pick<SubagentActivityDockProps, 'sessionId' | 'useSessions' | 'useSessionStatus' | 'openChildAside' | 't'>) {
  const summaries = useSessions(state => state.byId)
  const statuses = useSessionStatus(value => value)
  const [clock, setClock] = useState(() => Date.now())
  const [collapsed, setCollapsed] = useState(false)
  const rowsId = useId()
  const now = Math.max(clock, Date.now())
  const runningRows: Row[] = []
  const settledRows: Row[] = []
  let nextExpiry: number | undefined
  let liveElapsed = false
  for (const entry of entries) {
    if (entry.mode === 'external') continue
    const summary = summaries[entry.id]
    const running = statuses.get(entry.id)?.running ?? summary?.running ?? false
    if (running) {
      runningRows.push({ entry, summary, running })
      liveElapsed ||= summary?.projectionValues?.subagentTiming?.active !== undefined
      continue
    }
    const stage = summary?.projectionValues?.subagentActivity?.current
    if (stage?.kind !== 'finished' && stage?.kind !== 'failed' && stage?.kind !== 'stopped') continue
    const expires = stage.at + RECENT_WINDOW_MS
    if (expires <= now) continue
    settledRows.push({ entry, summary, running })
    nextExpiry = Math.min(nextExpiry ?? expires, expires)
  }
  useEffect(() => {
    if (nextExpiry === undefined) return
    const timer = setTimeout(() => { setClock(Date.now()) }, Math.max(0, nextExpiry - Date.now()))
    return () => { clearTimeout(timer) }
  }, [nextExpiry])
  useEffect(() => {
    if (!liveElapsed || collapsed) return
    const timer = setInterval(() => { setClock(Date.now()) }, 1_000)
    return () => { clearInterval(timer) }
  }, [liveElapsed, collapsed])
  if (runningRows.length === 0 && settledRows.length === 0) return null
  return (
    <section className={css.dock} aria-label={t('section.title')}>
      <button type="button" className={css.header} aria-expanded={!collapsed} aria-controls={rowsId} onClick={() => { setCollapsed(!collapsed) }}>
        <IconUsersOutlineRegular size={14} />
        <span>{t('section.title')}</span>
        {runningRows.length > 0 && <span className={css.count}>{t('dock.running-count', { count: runningRows.length })}</span>}
        <span className={css.headerChevron}>
          {collapsed ? <IconChevronRightOutlineRegular /> : <IconChevronDownOutlineRegular />}
        </span>
      </button>
      <div id={rowsId} className={css.body} hidden={collapsed}>
        {runningRows.length > 0 && (
          <ul className={css.rows}>
            {runningRows.map(row => (
              <ActivityRow key={row.entry.id} row={row} now={now} parentSessionId={sessionId} openChildAside={openChildAside} t={t} />
            ))}
          </ul>
        )}
        {settledRows.length > 0 && (
          <details className={css.settled}>
            <summary>{t('dock.recently-settled')}</summary>
            <ul className={css.rows}>
              {settledRows.map(row => (
                <ActivityRow key={row.entry.id} row={row} now={now} parentSessionId={sessionId} openChildAside={openChildAside} t={t} />
              ))}
            </ul>
          </details>
        )}
      </div>
    </section>
  )
}
