/** Plain-text context shared by the clipboard and the current Session's composer. */

import type { ChangeRequestFailureContext, ChangeRequestFailureSelection } from '@janhq/jan-experimental-forge/types'
import type { PropsLocale } from '@janhq/jan-client-ui-slots'
import type { NS } from './locales.ts'

/** Maximum UTF-16 length of the complete clipboard and composer block. */
export const MAX_FAILURE_CONTEXT_CHARS = 12_000
const FIELD_CHARS = 1_200
const LOG_CHARS = 2_000

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Format the requested failures in stable order, preserving identity before detail.
 * @param context - head-verified provider diagnostics.
 * @param selection - which failed checks and reviews to include.
 * @param t - localized block labels shared by the two actions.
 * @returns bounded plain text with an explicit notice when any detail was omitted.
 */
export function buildFailureContext(context: ChangeRequestFailureContext, selection: ChangeRequestFailureSelection,
  t: PropsLocale<typeof NS>['t']): string {
  const { snapshot, logs, reviews, failures } = context
  const marker = t('change.failure.trimmed')
  const limit = MAX_FAILURE_CONTEXT_CHARS - marker.length - 2
  let trimmed = context.truncated
  let text = ''
  const put = (line: string, max = FIELD_CHARS, tail = false): void => {
    const available = Math.min(max, limit - text.length - (text === '' ? 0 : 1))
    if (line === '') return
    if (available <= 0) { trimmed = true; return }
    trimmed ||= line.length > available
    text += (text === '' ? '' : '\n') + (tail ? line.slice(-available) : line.slice(0, available)).toWellFormed()
  }
  put(t('change.failure.identity', { number: snapshot.ref.number, title: snapshot.title }))
  put(snapshot.url)
  put(t('change.failure.head', { sha: snapshot.headSha }))

  const checks = selection.kind === 'review' ? [] : snapshot.checks.filter(check =>
    (check.state === 'failure' || check.state === 'cancelled') && (selection.kind === 'all'
      || (check.name === selection.name && check.workflow === selection.workflow && check.url === selection.url)),
  ).toSorted((a, b) => compare(a.workflow ?? '', b.workflow ?? '') || compare(a.name, b.name)
    || compare(a.url ?? '', b.url ?? '') || compare(a.output?.title ?? '', b.output?.title ?? '')
    || compare(a.output?.summary ?? '', b.output?.summary ?? ''))
  if (selection.kind !== 'review' && (checks.length > 0 || snapshot.checksRollup === 'failure')) {
    put(`\n${t('change.failure.checks')}`)
    for (const check of checks) {
      const name = check.workflow === null ? check.name : `${check.workflow} / ${check.name}`
      put(`- ${check.state === 'cancelled' ? t('change.failure.cancelled', { name }) : name}`)
    }
    if (checks.length === 0) put(t('change.failure.empty'))
  }
  if (selection.kind !== 'check' && (reviews.length > 0 || snapshot.reviewDecision === 'changes-requested')) {
    put(`\n${t('change.review.changesRequested')}`)
    for (const review of reviews.toSorted((a, b) => compare(a.author ?? '', b.author ?? '') || compare(a.body, b.body))) {
      if (review.author !== null) put(`@${review.author}`)
      put(review.body.trim())
      for (const comment of review.comments.toSorted((a, b) => compare(a.path, b.path) || (a.line ?? 0) - (b.line ?? 0)
        || compare(a.body, b.body))) {
        put(`- ${comment.path}${comment.line === null ? '' : `:${String(comment.line)}`}: ${comment.body.trim()}`)
      }
    }
    if (reviews.length === 0) put(t('change.failure.empty'))
  }
  for (const check of checks) {
    const excerpts = check.url === null ? [] : logs.filter(log => log.url === check.url)
      .toSorted((a, b) => compare(a.step, b.step) || compare(a.text, b.text))
    if (check.output === undefined && excerpts.length === 0 && check.url === null) continue
    put(`\n${check.name}`)
    if (check.url !== null) put(check.url)
    if (check.output?.title != null) put(check.output.title.trim())
    if (check.output?.summary != null && check.output.summary !== check.output.title) put(check.output.summary.trim())
    for (const excerpt of excerpts) {
      put(t('change.failure.step', { name: excerpt.step }))
      put(excerpt.text, LOG_CHARS, true)
      trimmed ||= excerpt.truncated
    }
  }
  if (failures.length > 0) put(`\n${t('change.failure.partial')}`)
  return trimmed ? `${text}\n\n${marker}` : text
}
