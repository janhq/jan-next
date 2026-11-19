/** Composer context-occupancy meter: a ring and percentage below the card fed by the
 * `contextPressure` projection, with a click-open panel of the heuristic
 * `contextBreakdown` composition (system prompt, tools, conversation) and what
 * the Session runs with (MCP tools, plugins, skills, tools).
 * Renders nothing until a provider reports both pressure and a route
 * capacity. */

import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { UseProjection } from '@janhq/jan-api-session-controller/client'
import type { SessionContextPreviewValue, SessionInventory, SessionItemOrigin } from '@janhq/jan-api-session-controller/types'
// Type-only: the `contextPressure` / `contextBreakdown` projection key merges.
import type {} from '@janhq/jan-token-meter/client'
import { IconChevronRightOutlineRegular, Tooltip, useDismissOnOutsidePointer } from '@janhq/jan-client-ui-primitives'
import type { ComposerBarProps } from '../contract/slots.ts'
import { contextOccupancy } from '../context-occupancy.ts'
import css from './ContextMeter.module.css'

/** Ring geometry: 14px viewBox, 2px stroke. */
const RADIUS = 5.5
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

/**
 * Marker the localized occupancy sentence is split on, so the panel headline
 * keeps the reading in its own tone while each locale still owns the word
 * order (`45% of context used` / `上下文已用 45%`).
 */
const READING_SLOT = '\u0000'

/** Panel legend rows, in bar-segment order; each color class carries the shared swatch/segment tint. */
const ROWS = [
  { key: 'systemTokens', label: 'context.system', color: css.colorSystem },
  { key: 'toolsTokens', label: 'context.tools', color: css.colorTools },
  { key: 'messageTokens', label: 'context.messages', color: css.colorMessages },
] as const

interface InventoryItem {
  text: string
  origin?: SessionItemOrigin
}

interface InventoryRow {
  key: string
  label: 'context.inventory.plugins' | 'context.inventory.skills' | 'context.inventory.tools'
  items: InventoryItem[]
}

/**
 * One expandable inventory row per kind; plugins only when the Host knows the
 * preset composition. Tools are one list: Jan's own first, then each MCP tool
 * under its server, every item tagged with where it comes from like a skill.
 */
function inventoryRows(inventory: SessionInventory): InventoryRow[] {
  const rows: InventoryRow[] = []
  if (inventory.plugins !== undefined) {
    rows.push({ key: 'plugins', label: 'context.inventory.plugins', items: inventory.plugins.map(text => ({ text })) })
  }
  rows.push(
    { key: 'skills', label: 'context.inventory.skills', items: inventory.skills.map(skill => ({ text: skill.name, origin: skill.origin })) },
    {
      key: 'tools',
      label: 'context.inventory.tools',
      items: [
        ...inventory.tools.map(text => ({ text, origin: { kind: 'bundled' } as const })),
        ...inventory.mcpTools.map(tool => ({ text: `MCP ${tool.server} · ${tool.name}`, origin: tool.origin })),
      ],
    },
  )
  return rows
}

/** Plugin package names drop the shared scope prefix to fit the panel. */
function shortPlugin(name: string): string {
  return name.replace(/^@janhq\/jan-/, '')
}

/**
 * The short tag naming where an item comes from.
 * @param origin - Host-reported origin.
 * @param t - locale seat.
 * @returns the localized tag; a plugin reads as its own name.
 */
function originTag(origin: SessionItemOrigin, t: ComposerBarProps['t']): string {
  switch (origin.kind) {
    case 'plugin': return shortPlugin(origin.plugin)
    case 'project': return t('context.origin.project')
    case 'global': return t('context.origin.global')
    case 'bundled': return t('context.origin.bundled')
    case 'custom': return t('context.origin.custom')
    case 'session': return t('context.origin.session')
  }
}

/**
 * Format a token count for the compact context panel.
 * @param value - token count.
 * @param t - Conversation locale seat with shared compact-number templates.
 * @returns Compact localized count using K or M when needed.
 */
function formatTokens(value: number, t: ComposerBarProps['t']): string {
  const scaled = (candidate: number): string => candidate >= 100
    ? String(Math.round(candidate))
    : String(Math.round(candidate * 10) / 10)
  if (value < 1_000) return String(value)
  if (value < 1_000_000) return t('number.thousand', { value: scaled(value / 1_000) })
  return t('number.million', { value: scaled(value / 1_000_000) })
}

export interface ContextMeterProps {
  useProjection: UseProjection
  /** The selected model's window; shown before a request reports pressure. */
  selectedWindow?: number | undefined
  /** Host pricing of what the next request would inject; consulted until a request is logged. */
  previewContext?: (() => Promise<SessionContextPreviewValue | null>) | undefined
  /** The owning bar's locale seat, passed down as a plain prop. */
  t: ComposerBarProps['t']
}

export function ContextMeter({ useProjection, selectedWindow, previewContext, t }: ContextMeterProps) {
  const pressure = useProjection('contextPressure')
  const logged = useProjection('contextBreakdown')
  const [open, setOpen] = useState(false)
  const [preview, setPreview] = useState<SessionContextPreviewValue | null>(null)
  const rootRef = useRef<HTMLSpanElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  // Before the first request nothing is logged, so the Host's priced preview of the
  // system prompt, tools, and runtime context stands in for both reading and breakdown.
  const loggedTotal = logged === undefined ? 0 : logged.systemTokens + logged.toolsTokens + logged.messageTokens
  const unlogged = loggedTotal === 0
  // Re-read on a model switch and on each panel open, so preset and tool changes show;
  // a logged Session still reads it on open for what the next request runs with.
  useEffect(() => {
    if ((!unlogged && !open) || previewContext === undefined) return
    let current = true
    previewContext().then(
      (value) => { if (current) setPreview(value) },
      () => { if (current) setPreview(null) },
    )
    return () => { current = false }
  }, [unlogged, previewContext, selectedWindow, open])
  const unsent = unlogged && preview !== null ? preview : undefined
  const inventory = preview?.inventory
  const breakdown = unsent ?? logged
  // Until a provider reports usage (a first reply cut before it did), the
  // priced composition stands in for the reading, so it never reads ~0.
  const estimate = breakdown === undefined ? 0 : breakdown.systemTokens + breakdown.toolsTokens + breakdown.messageTokens
  const context = contextOccupancy(pressure, selectedWindow, estimate)
  const available = context !== null
  const anchorName = `--jan-context-${useId().replaceAll(':', '')}`
  useDismissOnOutsidePointer(rootRef, open && available, setOpen, panelRef)

  // A model switch can temporarily remove capacity while this component stays
  // mounted. Close the now-unavailable panel instead of preserving stale UI.
  useEffect(() => {
    if (!available && open) setOpen(false)
  }, [available, open])

  useEffect(() => {
    if (!open || !available) return
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [available, open])

  if (context === null) return null
  const percent = context.percent
  const reading = `${percent}%`
  const [headBefore = '', headAfter = ''] = t('context.aria', { percent: READING_SLOT })
    .split(READING_SLOT)
    .map(part => part.trim())

  // The bar's overall length stays the provider-exact percent; the heuristic
  // breakdown only proportions its colored parts. A zero-width part is dropped
  // instead of rendered: `.segment`'s min-width keeps a hairline part visible,
  // which at 0% occupancy would draw a filled bar over an empty context.
  const breakdownTotal = breakdown === undefined
    ? 0
    : breakdown.systemTokens + breakdown.toolsTokens + breakdown.messageTokens
  const parts = breakdown === undefined || breakdownTotal === 0
    ? [{ key: 'total', color: undefined, width: percent }]
    : ROWS.map(row => ({ key: row.key, color: row.color, width: percent * breakdown[row.key] / breakdownTotal }))
  const segments = parts.filter(part => part.width > 0)

  return (
    <span ref={rootRef} style={{ anchorName }} className={css.root}>
      <Tooltip label={t('context.aria', { percent: reading })} side="top" delayMs={200} disabled={open} portal>
        <button
          type="button"
          className={css.trigger}
          aria-label={t('context.aria', { percent: reading })}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => { setOpen(!open) }}
        >
          <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden>
            <circle className={css.track} cx="7" cy="7" r={RADIUS} />
            <circle
              className={css.fill}
              cx="7"
              cy="7"
              r={RADIUS}
              strokeDasharray={`${CIRCUMFERENCE * percent / 100} ${CIRCUMFERENCE}`}
              transform="rotate(-90 7 7)"
            />
          </svg>
          <span>{reading}</span>
        </button>
      </Tooltip>
      {open && createPortal(
        <div
          ref={panelRef}
          className={css.panel}
          style={{ positionAnchor: anchorName }}
          role="dialog"
          aria-label={t('context.used')}
        >
          <div className={css.header}>
            {/* Empty sides collapse through `.headline:empty` so the locale that
                needs no leading (or trailing) text spends no header gap. */}
            <span className={css.headline}>{headBefore}</span>
            <span className={css.percent}>{reading}</span>
            <span className={css.headline}>{headAfter}</span>
            {/* `~`: usedTokens prefers projectedTokens, whose surface delta is
                heuristically repriced on top of the provider-anchored sample. */}
            <span className={css.figures}>
              {`~${formatTokens(context.usedTokens, t)} / ${formatTokens(context.contextWindow, t)}`}
            </span>
          </div>
          <div className={css.bar}>
            {segments.map(segment => (
              <div
                key={segment.key}
                className={segment.color === undefined ? css.segment : `${css.segment} ${segment.color}`}
                style={{ width: `${segment.width}%` }}
              />
            ))}
          </div>
          {breakdown !== undefined && (
            <dl className={css.rows}>
              {ROWS.map(row => (
                <div key={row.key} className={css.row}>
                  <dt>
                    <span className={`${css.swatch} ${row.color}`} aria-hidden />
                    {t(row.label)}
                  </dt>
                  <dd>{`~${formatTokens(breakdown[row.key], t)}`}</dd>
                </div>
              ))}
            </dl>
          )}
          {inventory !== undefined && (
            <section className={css.inventory} aria-label={t('context.inventory.title')}>
              <div className={css.inventoryTitle}>{t('context.inventory.title')}</div>
              {inventoryRows(inventory).map(row => (
                <details key={row.key} className={css.inventoryRow} data-inventory={row.key}>
                  <summary>
                    <IconChevronRightOutlineRegular className={css.chevron} aria-hidden />
                    <span className={css.inventoryLabel}>{t(row.label)}</span>
                    <span className={css.inventoryCount}>{row.items.length}</span>
                  </summary>
                  {row.items.length === 0
                    ? <p className={css.inventoryEmpty}>{t('context.inventory.none')}</p>
                    : (
                      <ul className={css.inventoryList}>
                        {row.items.map(item => (
                          <li key={`${item.origin?.kind ?? ''}/${item.text}`}>
                            {item.origin !== undefined && (
                              <span className={css.origin} data-origin={item.origin.kind}>{originTag(item.origin, t)}</span>
                            )}
                            {item.text}
                          </li>
                        ))}
                      </ul>
                    )}
                </details>
              ))}
            </section>
          )}
        </div>,
        document.body,
      )}
    </span>
  )
}
