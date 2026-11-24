/** Composer dock showing a session's context-window breakdown. */
import { memo, useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { ObservableSnapshot } from '@janhq/jan-client-store'
import {
  Button, focusWithoutRing, IconChevronRightOutlineRegular, IconCloseOutlineRegular,
  IconRefreshOutlineRegular, Tooltip,
} from '@janhq/jan-client-ui-primitives'
import type { InjectFace, PropsLocale } from '@janhq/jan-client-ui-slots'
import { CONTEXT_CATEGORIES, type ContextUsage, type ContextUsageCategory, type ContextUsageEntry } from '../types.ts'
import type { ContextPanelSnapshot } from './state.ts'
import css from './ContextPanel.module.css'

/** Private injection face: the renderer binds the session's snapshot to a selector hook. */
export interface ContextPanelInjected {
  readonly hooks: { readonly breakdown: ObservableSnapshot<ContextPanelSnapshot | null> }
  readonly refresh: () => void
  readonly dismiss: () => void
}

/** Inputs for the dock slot's context panel. */
export type ContextPanelProps = InjectFace<ContextPanelInjected> & PropsLocale<'contextUsage'>

type Translate = ContextPanelProps['t']
type RowId = ContextUsageCategory['id'] | 'autoCompactBuffer' | 'freeSpace'
interface UsageRow {
  readonly id: RowId
  readonly tokens: number
  readonly entries?: readonly ContextUsageEntry[]
}

const COLUMNS = 20
const CELL_COUNT = COLUMNS * 10
const VISIBLE_ENTRIES = 8

function formatTokens(tokens: number, t: Translate): string {
  if (tokens < 1000) return String(tokens)
  const unit = tokens >= 1_000_000 ? 1_000_000 : 1000
  const scaled = tokens / unit
  const value = scaled >= 100 ? Math.round(scaled) : Math.round(scaled * 10) / 10
  return t(unit === 1000 ? 'number.thousand' : 'number.million', { value: String(value).replace('.', t('decimalSeparator')) })
}

function formatPercent(tokens: number, capacity: number, t: Translate, precision = 0): string {
  const value = (100 * tokens / capacity).toFixed(precision).replace('.', t('decimalSeparator'))
  return t('percent', { value })
}

function usageRows(usage: ContextUsage): UsageRow[] {
  const byId = new Map(usage.categories.map(category => [category.id, category]))
  const rows: UsageRow[] = CONTEXT_CATEGORIES.map(id => byId.get(id) ?? { id, tokens: 0 })
  const { contextWindow, autoCompactTokens, usedTokens } = usage
  if (contextWindow !== undefined) {
    const freeSpace = Math.max(0, (autoCompactTokens ?? contextWindow) - usedTokens)
    if (autoCompactTokens !== undefined) {
      // Once usage passes the threshold, the occupied part is no longer reserve.
      rows.push({ id: 'autoCompactBuffer', tokens: Math.max(0, contextWindow - usedTokens - freeSpace) })
    }
    rows.push({ id: 'freeSpace', tokens: freeSpace })
  }
  return rows
}

interface CellRun {
  readonly row: UsageRow
  readonly start: number
  readonly length: number
}

function waffleRuns(rows: readonly UsageRow[], capacity: number): CellRun[] {
  const runs: CellRun[] = []
  let start = 0
  let tokens = 0
  // Round cumulative boundaries: every cell has exactly one owner, and
  // rounding many short categories cannot shift the total used boundary.
  const append = (row: UsageRow): void => {
    tokens += row.tokens
    const end = Math.min(CELL_COUNT, Math.round(CELL_COUNT * tokens / capacity))
    for (let cursor = start; cursor < end;) {
      // One Tooltip per contiguous segment of a row, not one per cell.
      const length = Math.min(end - cursor, COLUMNS - cursor % COLUMNS)
      runs.push({ row, start: cursor, length })
      cursor += length
    }
    start = end
  }
  for (const row of rows) {
    if (row.id !== 'autoCompactBuffer' && row.id !== 'freeSpace') append(row)
  }
  for (const row of rows) {
    if (row.id === 'freeSpace') append(row)
  }
  for (const row of rows) {
    if (row.id === 'autoCompactBuffer') append(row)
  }
  return runs
}

const Waffle = memo(function Waffle({ runs, highlight, t }: {
  runs: readonly CellRun[]
  highlight: (id: RowId | undefined) => void
  t: Translate
}) {
  return (
    <div className={css.waffle} role="img" aria-label={t('grid')}>
      {runs.map(({ row, start, length }) => (
        <Tooltip key={start} label={() => t('cell', { label: t(row.id), tokens: formatTokens(row.tokens, t) })} side="top" portal>
          <span
            className={css.run}
            data-context-tint={row.id}
            style={{ gridColumn: `span ${length}`, gridTemplateColumns: `repeat(${length}, minmax(0, 1fr))` }}
            onPointerEnter={(event) => { if (event.pointerType !== 'touch') highlight(row.id) }}
            onPointerLeave={() => { highlight(undefined) }}
          >
            {Array.from({ length }, (_, offset) => (
              <span key={start + offset} className={css.cell} data-context-cell={row.id} />
            ))}
          </span>
        </Tooltip>
      ))}
    </div>
  )
})

function BreakdownRow({ row, capacity, highlighted, t }: {
  row: UsageRow
  capacity: number | undefined
  highlighted: boolean
  t: Translate
}) {
  const entriesId = useId()
  const [expanded, setExpanded] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const canExpand = (row.entries?.length ?? 0) > 0
  const open = canExpand && expanded
  const sorted = useMemo(() => row.entries?.toSorted((a, b) => b.tokens - a.tokens), [row.entries])
  const remaining = (sorted?.length ?? 0) - VISIBLE_ENTRIES
  const label = t(row.id)
  const tokens = formatTokens(row.tokens, t)
  const percent = capacity === undefined ? undefined : formatPercent(row.tokens, capacity, t, 1)
  const accessibleLabel = t('cell', { label, tokens })
  const handleKey = (event: ReactKeyboardEvent<HTMLButtonElement>): void => {
    if (!canExpand || event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    event.stopPropagation()
    setExpanded(event.key === 'ArrowRight')
  }
  return (
    <li>
      <button
        type="button"
        className={css.row}
        data-context-row=""
        data-highlighted={highlighted || undefined}
        aria-label={percent === undefined ? accessibleLabel : `${accessibleLabel} · ${percent}`}
        aria-disabled={canExpand ? undefined : true}
        aria-expanded={canExpand ? open : undefined}
        aria-controls={canExpand ? entriesId : undefined}
        onClick={canExpand ? () => { setExpanded(!open) } : undefined}
        onKeyDown={handleKey}
      >
        <span className={css.rowLabel}>
          <span className={css.swatch} data-context-tint={row.id} aria-hidden="true" />
          <span className={css.ellipsis} title={label}>{label}</span>
        </span>
        <span className={css.value}>{tokens}</span>
        {percent !== undefined && <span className={css.percent}>{percent}</span>}
        <span className={css.chevron} aria-hidden="true">
          {canExpand && <IconChevronRightOutlineRegular size={12} />}
        </span>
      </button>
      {canExpand && (
        <ul id={entriesId} className={css.entries} hidden={!open}>
          {open && sorted?.slice(0, showAll ? undefined : VISIBLE_ENTRIES).map((entry, index) => (
            <li key={`${entry.label}:${index}`} className={css.entry}>
              <span className={css.ellipsis} title={entry.label}>{entry.label}</span>
              <span className={css.value}>{formatTokens(entry.tokens, t)}</span>
              {capacity !== undefined && <span className={css.percent}>{formatPercent(entry.tokens, capacity, t, 1)}</span>}
              <span aria-hidden="true" />
            </li>
          ))}
          {open && remaining > 0 && (
            <li>
              <button type="button" className={css.more} aria-expanded={showAll} onClick={() => { setShowAll(!showAll) }}>
                {showAll ? t('showLess') : t('more', { count: remaining })}
              </button>
            </li>
          )}
        </ul>
      )}
    </li>
  )
}

function navigateRows(event: ReactKeyboardEvent<HTMLUListElement>): void {
  if (event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
  const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-context-row]'))
  const index = buttons.findIndex(button => button === event.target)
  if (index === -1) return
  event.preventDefault()
  event.stopPropagation()
  const next = index + (event.key === 'ArrowUp' ? -1 : 1)
  buttons[(next + buttons.length) % buttons.length]?.focus()
}

function Breakdown({ usage, t }: { usage: ContextUsage; t: Translate }) {
  const { contextWindow } = usage
  const rows = useMemo(() => usageRows(usage), [usage])
  const runs = useMemo(() => contextWindow === undefined ? undefined : waffleRuns(rows, contextWindow), [rows, contextWindow])
  const [highlighted, setHighlighted] = useState<RowId>()
  return (
    <>
      <div className={css.breakdown} data-waffle={runs !== undefined || undefined}>
        {runs !== undefined && <Waffle runs={runs} highlight={setHighlighted} t={t} />}
        <ul className={css.rows} onKeyDown={navigateRows}>
          {rows.map(row => <BreakdownRow key={row.id} row={row} capacity={contextWindow} highlighted={row.id === highlighted} t={t} />)}
        </ul>
      </div>
      <p className={css.note}>{t('note')}</p>
    </>
  )
}

function Summary({ usage, t }: { usage: ContextUsage; t: Translate }) {
  const { usedTokens, contextWindow, autoCompactTokens, usedSource } = usage
  const used = formatTokens(usedTokens, t)
  return (
    <div className={css.summary}>
      <p>
        {contextWindow === undefined
          ? t('used', { used })
          : t('usedOf', { used, window: formatTokens(contextWindow, t), percent: formatPercent(usedTokens, contextWindow, t) })}
        {usedSource === 'estimate' && <> <span>{t('estimated')}</span></>}
      </p>
      {contextWindow !== undefined && autoCompactTokens !== undefined && (
        <p>{t('beforeCompaction', {
          left: formatTokens(Math.max(0, autoCompactTokens - usedTokens), t),
          percent: formatPercent(autoCompactTokens, contextWindow, t),
        })}</p>
      )}
    </div>
  )
}

function OpenPanel({ breakdown, refresh, dismiss, t }: Omit<ContextPanelProps, 'useBreakdown'> & {
  breakdown: ContextPanelSnapshot
}) {
  const root = useRef<HTMLElement>(null)
  const invoker = useRef<HTMLElement | null>(null)
  const refreshButton = useRef<HTMLButtonElement>(null)
  const { status, usage } = breakdown
  const loading = status === 'loading'
  const title = usage?.model === undefined ? t('title') : t('titleModel', { model: usage.model.model })

  const close = useCallback((): void => {
    const prior = invoker.current
    if (prior?.isConnected && root.current?.contains(document.activeElement)) focusWithoutRing(prior, { preventScroll: true })
    dismiss()
  }, [dismiss])
  useEffect(() => {
    const panel = root.current
    const owner = panel?.closest('[data-conversation-session]')
    if (panel == null || owner == null) return
    const active = document.activeElement
    if (active instanceof HTMLElement && owner === active.closest('[data-conversation-session]')
      && !panel.contains(active) && panel.closest('[inert], [hidden]') === null) {
      invoker.current = active
      focusWithoutRing(panel, { preventScroll: true })
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing
        || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || !(event.target instanceof Element)) return
      if (owner !== event.target.closest('[data-conversation-session]')) return
      if (event.target.closest('[role="dialog"], [role="menu"], [role="listbox"], [data-approval-key], .xterm, [inert]') !== null) return
      event.preventDefault()
      event.stopPropagation()
      close()
    }
    window.addEventListener('keydown', onKey, true)
    return () => { window.removeEventListener('keydown', onKey, true) }
  }, [close])

  return (
    <section ref={root} tabIndex={-1} className={css.panel} aria-label={t('title')}>
      <header className={css.header}>
        <h2 className={css.ellipsis} title={title}>{title}</h2>
        <Tooltip label={t('refresh')} side="top" portal>
          <Button
            ref={refreshButton}
            className={css.iconButton}
            size="sm"
            aria-label={t('refresh')}
            aria-disabled={loading || undefined}
            icon={<IconRefreshOutlineRegular />}
            onClick={() => { if (!loading) refresh() }}
          />
        </Tooltip>
        <Tooltip label={t('dismiss')} side="top" portal>
          <Button className={css.iconButton} size="sm" aria-label={t('dismiss')} icon={<IconCloseOutlineRegular />} onClick={close} />
        </Tooltip>
      </header>
      <div className={css.body}>
        {usage !== undefined && <Summary usage={usage} t={t} />}
        {loading && <p className={css.status} role="status">{t(usage === undefined ? 'loading' : 'refreshing')}</p>}
        {status === 'error' && (
          <div className={css.error}>
            <p role="alert">{t('failed')}</p>
            <Button size="sm" variant="outline" onClick={() => { refreshButton.current?.focus(); refresh() }}>{t('retry')}</Button>
          </div>
        )}
        {usage !== undefined && <Breakdown usage={usage} t={t} />}
      </div>
    </section>
  )
}

/**
 * Show the context breakdown only while its session panel is open.
 * @param props - renderer-bound session state, panel actions, and localized copy.
 * @returns the composer dock content or null while closed.
 */
export function ContextPanel({ useBreakdown, refresh, dismiss, t }: ContextPanelProps) {
  const breakdown = useBreakdown(value => value)
  return breakdown === null ? null : <OpenPanel breakdown={breakdown} refresh={refresh} dismiss={dismiss} t={t} />
}
