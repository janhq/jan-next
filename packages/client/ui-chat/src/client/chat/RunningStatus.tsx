/** Running Turn clock isolated from the transcript's render cycle. */
import { memo, type ReactNode } from 'react'
import { TextShimmer } from '@janhq/jan-client-ui-primitives'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import { useRunDurationLabel } from './run-clock.ts'
import { RunningWhaleTail } from './RunningWhaleTail.tsx'
import a11yCss from './accessibility.module.css'
import css from './ChatView.module.css'

interface RunningStatusProps {
  readonly announcement?: string
  readonly phaseLabel: string
  readonly startTime: number | undefined
  /** Freeze the shown duration while the Client cannot observe the Session. */
  readonly paused: boolean
  /** Keep the slot without showing or announcing the status: the Session stopped before its Turn closed. */
  readonly holding?: boolean
  readonly t: ChatViewSlotProps['t']
  /** Feature details shown after the clock, e.g. a local model's prompt reading progress. */
  readonly detail?: ReactNode
}

/**
 * Show live elapsed time after the current Turn's content without announcing ticks.
 * @param props - Current Turn start time, pause state, localized phase, and details.
 * @returns the blue running indicator; mount while the Session is running, or holding its slot hidden until the
 * Turn's actions row replaces it.
 */
export const RunningStatus = memo(function RunningStatus({
  announcement, phaseLabel, startTime, paused, holding = false, t, detail,
}: RunningStatusProps) {
  const duration = useRunDurationLabel(startTime, paused || holding, t)
  return (
    <div className={css.running} data-chat-running data-holding={holding ? '' : undefined} aria-hidden={holding || undefined}>
      {holding ? null : (
        <span className={a11yCss.visuallyHidden} role="status" aria-live="polite" aria-atomic="true">
          {announcement ?? phaseLabel}
        </span>
      )}
      <span className={css.runningDivider} aria-hidden="true" />
      <span className={css.runningContent}>
        <RunningWhaleTail />
        <TextShimmer active={!holding} className={css.runningText}>
          <TextShimmer className={css.runningPhase}>{phaseLabel}</TextShimmer>
          {duration !== null && <TextShimmer className={css.runningDuration}>{duration}</TextShimmer>}
        </TextShimmer>
        {detail}
      </span>
    </div>
  )
})
