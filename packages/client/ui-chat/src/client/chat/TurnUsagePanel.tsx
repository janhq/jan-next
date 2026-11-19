/** Completed-Turn token usage and speed action, and its accounting details dialog. */

import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'
import {
  IconClockOutlineRegular, IconDatabaseOutlineRegular, IconGaugeOutlineRegular, Tooltip,
} from '@janhq/jan-client-ui-primitives'
import type { TurnTiming, TurnTokenUsage } from '../contract/chat-nodes.ts'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import { formatTokensPerSecond } from './message-chrome.ts'
import { formatDuration } from './StatsPills.tsx'
import { formatCacheHitPercent, formatExactTokens, formatTokens } from './token-format.ts'
import { useStatDialog } from './stat-dialog.ts'
import css from './TurnUsagePanel.module.css'
import dialogCss from './stat-dialog.module.css'

export interface TurnUsagePanelProps {
  usage: TurnTokenUsage
  /** Latency and output speed; absent fields stay off the pill and the dialog. */
  timing?: TurnTiming | undefined
  /** The owning view's locale seat, passed down as a plain prop. */
  t: ChatViewSlotProps['t']
}

function formatExactCount(value: number, t: ChatViewSlotProps['t']): string {
  return t('message.turnUsage.count', { count: formatExactTokens(value, t) })
}

/** One pill figure; hovering it names the figure and its exact value. */
function Stat({ hint, disabled, children }: { hint: string; disabled: boolean; children: ReactNode }) {
  return (
    <Tooltip label={hint} side="bottom" portal disabled={disabled}>
      <span className={css.stat} data-turn-usage-stat>{children}</span>
    </Tooltip>
  )
}

/**
 * Turn-usage IconActions pill with a click-open Turn-usage details dialog.
 * The pill spells out input, output, cached input, time to first token and
 * output speed; hovering a figure names it with its exact value. Assistive
 * technology reads the same figures from the dialog.
 * @param props - Turn usage buckets, timing and locale seat.
 * @returns The trigger and, while open, its portaled dialog anchored above the trigger.
 */
export function TurnUsagePanel({ usage, timing, t }: TurnUsagePanelProps) {
  const { open, setOpen, rootRef, panelRef, anchorName } = useStatDialog()

  const cacheHit = usage.cacheReadTokens === undefined
    ? null
    : formatCacheHitPercent(usage.cacheReadTokens, usage.totalTokens - usage.outputTokens, 1)
  const routes = usage.routes?.map(route => `${route.provider}/${route.model}`).join(', ') ?? ''
  const ttft = timing?.ttftMs === undefined ? null : formatDuration(timing.ttftMs, t)
  const speed = timing?.tokensPerSecond === undefined
    ? null
    : t('message.tokensPerSecond', { tps: formatTokensPerSecond(timing.tokensPerSecond) })
  const hint = (name: string, value: string) => `${name} · ${value}`

  return (
    <span ref={rootRef} style={{ anchorName }} className={css.root}>
      <button
        type="button"
        className={css.trigger}
        aria-label={t('message.turnUsage.title')}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => { setOpen(!open) }}
      >
        <IconDatabaseOutlineRegular className={css.narrowIcon} />
        {/* The button is named "Turn usage"; the figures are a visual summary
            whose timing varies run to run, and the dialog reads every one out. */}
        <span className={css.label} aria-hidden>
          <Stat hint={hint(t('message.turnUsage.input'), formatExactCount(usage.uncachedInputTokens, t))} disabled={open}>
            <span className={css.glyph}>↓</span>
            {formatTokens(usage.uncachedInputTokens, t)}
          </Stat>
          <Stat hint={hint(t('message.turnUsage.output'), formatExactCount(usage.outputTokens, t))} disabled={open}>
            <span className={css.glyph}>↑</span>
            {formatTokens(usage.outputTokens, t)}
          </Stat>
          {usage.cacheReadTokens !== undefined && (
            <Stat hint={hint(t('message.turnUsage.cacheRead'), formatExactCount(usage.cacheReadTokens, t))} disabled={open}>
              <IconDatabaseOutlineRegular />
              {formatTokens(usage.cacheReadTokens, t)}
            </Stat>
          )}
          {ttft !== null && (
            <Stat hint={hint(t('message.turnUsage.ttft'), ttft)} disabled={open}>
              <IconClockOutlineRegular />
              {ttft}
            </Stat>
          )}
          {speed !== null && (
            <Stat hint={hint(t('message.turnUsage.speed'), speed)} disabled={open}>
              <IconGaugeOutlineRegular />
              {speed}
            </Stat>
          )}
        </span>
      </button>
      {open && createPortal(
        <div
          ref={panelRef}
          className={dialogCss.panel}
          role="dialog"
          aria-label={t('message.turnUsage.title')}
          style={{ positionAnchor: anchorName }}
        >
          <div className={dialogCss.title}>
            <span className={dialogCss.titleLabel}>
              <IconDatabaseOutlineRegular />
              {t('message.turnUsage.title')}
            </span>
            <span className={dialogCss.titleValue}>{formatExactCount(usage.totalTokens, t)}</span>
          </div>
          <div className={dialogCss.titleRule} aria-hidden />
          <dl className={dialogCss.details} data-turn-usage-details>
            {routes !== '' && (
              <>
                <dt>{t('message.turnUsage.model')}</dt>
                <dd className={dialogCss.route}>{routes}</dd>
              </>
            )}
            {cacheHit !== null && (
              <>
                <dt>{t('message.turnUsage.cacheHit')}</dt>
                <dd>{`${cacheHit}%`}</dd>
              </>
            )}
            <dt>{t('message.turnUsage.input')}</dt>
            <dd>{formatExactCount(usage.uncachedInputTokens, t)}</dd>
            {usage.cacheReadTokens !== undefined && (
              <>
                <dt>{t('message.turnUsage.cacheRead')}</dt>
                <dd>{formatExactCount(usage.cacheReadTokens, t)}</dd>
              </>
            )}
            {usage.cacheWriteTokens !== undefined && (
              <>
                <dt>{t('message.turnUsage.cacheWrite')}</dt>
                <dd>{formatExactCount(usage.cacheWriteTokens, t)}</dd>
              </>
            )}
            <dt>{t('message.turnUsage.output')}</dt>
            <dd>
              {formatExactCount(usage.outputTokens, t)}
              {usage.reasoningTokens !== undefined && (
                <span className={dialogCss.reasoning}>
                  {t('message.turnUsage.reasoning', { tokens: formatExactCount(usage.reasoningTokens, t) })}
                </span>
              )}
            </dd>
            {ttft !== null && (
              <>
                <dt>{t('message.turnUsage.ttft')}</dt>
                <dd>{ttft}</dd>
              </>
            )}
            {speed !== null && (
              <>
                <dt>{t('message.turnUsage.speed')}</dt>
                <dd>{speed}</dd>
              </>
            )}
          </dl>
        </div>,
        document.body,
      )}
    </span>
  )
}
