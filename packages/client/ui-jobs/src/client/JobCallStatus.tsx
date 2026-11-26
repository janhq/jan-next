/**
 * The live status a transcript tool-call row shows for the job its call
 * started: the producer's progress line or the latest output line while the
 * job runs, and, for a call that handed its job to the background, the job's
 * own clock and final state.
 */
import { useEffect, useState } from 'react'
import type { JobView } from '@janhq/jan-api-job-controller/client'
import { StateDot } from '@janhq/jan-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@janhq/jan-client-ui-slots'
import type { TOOL_STATUS_CLOCK_ATTRIBUTE } from '@janhq/jan-client-ui-tool/client'
import { dotState, formatDuration, statusLabel, type JobListInjected } from './JobListAction.tsx'
import { latestLine } from './live-line.ts'
import { NS } from './locales.ts'
import css from './JobCallStatus.module.css'

/** Registration face: the jobs snapshot plus roster and observation streams. */
export type JobCallStatusInjected = Pick<JobListInjected, 'hooks' | 'watchRows' | 'observe'>

/** Full props of the call status slot entry. */
export type JobCallStatusProps =
  PropsRuntime<'tool.call.status'>
  & PropsLocale<typeof NS>
  & InjectFace<JobCallStatusInjected>

/** A job still settling past its call by less than this was not backgrounded. */
const BACKGROUND_SLACK_MS = 1_000

/** The job clock replaces the row's call duration; the type pins the tool contract's attribute name. */
const CLOCK: typeof TOOL_STATUS_CLOCK_ATTRIBUTE = 'data-tool-status-clock'

function isLive(job: JobView): boolean {
  return job.status === 'running' || job.status === 'stopping'
}

/**
 * Render the status of the job behind one tool call, or nothing when the call
 * started no job.
 * @param props - call identity, the session, and the jobs face.
 * @returns the status line.
 */
export function JobCallStatus({ sessionId, callId, settledAt, useJobs, watchRows, observe, t }: JobCallStatusProps) {
  const job = useJobs(state => state.rows[sessionId]?.find(row => row.toolCall?.callId === callId))
  const live = job !== undefined && isLive(job)
  const jobId = job?.id
  const text = useJobs(state => live && jobId !== undefined ? state.observed[jobId]?.text : undefined)
  // Roster and observation streams are reference-counted per session and job.
  useEffect(() => watchRows(sessionId), [sessionId, watchRows])
  useEffect(() => live && jobId !== undefined ? observe(sessionId, jobId) : undefined, [live, sessionId, jobId, observe])
  const background = job !== undefined && settledAt !== undefined
    && (live || (job.finishedAt ?? 0) - settledAt > BACKGROUND_SLACK_MS)
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!(background && live)) return
    const timer = window.setInterval(() => { setNow(Date.now()) }, 1_000)
    return () => { window.clearInterval(timer) }
  }, [background, live])
  if (job === undefined) return null
  const line = live ? job.progress ?? (text === undefined ? undefined : latestLine(text)) : undefined
  if (!background && line === undefined) return null
  const elapsed = (live ? now : job.finishedAt ?? job.startedAt) - job.startedAt
  return (
    <span className={css.status} data-job-status={job.status}>
      {line !== undefined && <span className={css.line} title={line} aria-label={`${t('call.lastLine')}: ${line}`}>{line}</span>}
      {background && (
        <span className={css.background} {...{ [CLOCK]: '' }}>
          <StateDot state={dotState(job.status)} size={8} />
          <span>{live ? t('call.background') : statusLabel(job.status, t)}</span>
          <span className={css.elapsed}>{formatDuration(elapsed, t)}</span>
        </span>
      )}
    </span>
  )
}
