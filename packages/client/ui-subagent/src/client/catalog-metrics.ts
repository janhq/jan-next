/** Names, elapsed time, and provider usage shared by subagent roster surfaces. */
import type { SessionProjectionMap, SessionSummary } from '@janhq/jan-api-session-controller/client'
import type { SubagentCatalogEntry } from '@janhq/jan-subagent/client'
import type { TranslateNS } from '@janhq/jan-client-ui-slots'
import type { NS } from './locales.ts'

/**
 * Format a token count compactly.
 * @param value - total provider tokens.
 * @param t - subagent dictionary translator.
 * @returns localized compact count without its unit.
 */
export function formatTokens(value: number, t: TranslateNS<typeof NS>): string {
  const scaled = (next: number): string => next >= 100
    ? String(Math.round(next))
    : String(Math.round(next * 10) / 10)
  if (value < 1_000) return String(value)
  if (value < 1_000_000) return t('tokens.thousand', { value: scaled(value / 1_000) })
  return t('tokens.million', { value: scaled(value / 1_000_000) })
}

/**
 * Sum the four disjoint durable provider-usage buckets.
 * @param usage - provider measurement, absent until reported.
 * @returns total tokens, or undefined when no measurement was reported.
 */
export function tokenTotal(
  usage: SessionProjectionMap['tokenUsage'] | undefined,
): number | undefined {
  return usage === undefined
    ? undefined
    : usage.uncachedInputTokens + usage.outputTokens
      + usage.cacheReadTokens + usage.cacheWriteTokens
}

/**
 * Read projected elapsed time, freezing it at the last observed event on inactive rows.
 * @param summary - existing child session summary.
 * @param activity - whether the child's Agent is running.
 * @param now - current wall time in milliseconds.
 * @returns total active-turn milliseconds, or undefined when timing is unavailable.
 */
export function activityDuration(
  summary: SessionSummary | undefined,
  activity: 'running' | 'inactive',
  now: number,
): number | undefined {
  if (summary === undefined) return undefined
  const timing: SessionProjectionMap['subagentTiming'] | undefined
    = summary.projectionValues?.subagentTiming
  if (timing === undefined) return undefined
  if (timing.active === undefined) return timing.settledMs
  const end = activity === 'running'
    ? now
    : timing.active.through
  return timing.settledMs + Math.max(0, end - timing.active.since)
}

interface DurationParts {
  seconds: number
  minutes: number
  hours: number
  days: number
  totalMinutes: number
  totalHours: number
}

function splitDuration(ms: number): DurationParts {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1_000)
  const totalMinutes = Math.floor(totalSeconds / 60)
  const totalHours = Math.floor(totalMinutes / 60)
  return {
    seconds: totalSeconds % 60,
    minutes: totalMinutes % 60,
    hours: totalHours % 24,
    days: Math.floor(totalHours / 24),
    totalMinutes,
    totalHours,
  }
}

/**
 * Format elapsed time with decreasing precision at larger scales.
 * @param ms - total active-turn milliseconds.
 * @param t - subagent dictionary translator.
 * @returns localized duration.
 */
export function formatDuration(ms: number, t: TranslateNS<typeof NS>): string {
  const { seconds, minutes, hours, days, totalMinutes, totalHours } = splitDuration(ms)
  if (days >= 365) {
    const years = Math.floor(days / 365)
    const months = Math.floor((days % 365) / 30)
    return months === 0
      ? t('duration.years', { years })
      : t('duration.yearsMonths', { years, months })
  }
  if (days >= 30) {
    const months = Math.floor(days / 30)
    const remainingDays = days % 30
    return remainingDays === 0
      ? t('duration.months', { months })
      : t('duration.monthsDays', { months, days: remainingDays })
  }
  if (days > 0) {
    return hours === 0
      ? t('duration.days', { days })
      : t('duration.daysHours', { days, hours })
  }
  if (totalHours > 0) {
    return t('duration.hours', {
      hours: totalHours,
      minutes: String(minutes).padStart(2, '0'),
      seconds: String(seconds).padStart(2, '0'),
    })
  }
  if (totalMinutes > 0) {
    return t('duration.minutes', {
      minutes: totalMinutes,
      seconds: String(seconds).padStart(2, '0'),
    })
  }
  return t('duration.seconds', { seconds })
}

/**
 * Preserve exact whole seconds for hover and accessible naming.
 * @param ms - total active-turn milliseconds.
 * @param t - subagent dictionary translator.
 * @returns localized exact duration.
 */
export function formatExactDuration(ms: number, t: TranslateNS<typeof NS>): string {
  const { seconds, minutes, hours, days } = splitDuration(ms)
  return days === 0
    ? formatDuration(ms, t)
    : t('duration.exactDays', {
      days,
      hours: String(hours).padStart(2, '0'),
      minutes: String(minutes).padStart(2, '0'),
      seconds: String(seconds).padStart(2, '0'),
    })
}

/**
 * Name a child without using its creation description as identity.
 * @param entry - direct child catalog row.
 * @returns sibling-unique name or its historical Session id.
 */
export function entryName(entry: SubagentCatalogEntry): string {
  return entry.mode === 'continuable' || entry.mode === 'external' ? entry.name ?? entry.id : entry.id
}
