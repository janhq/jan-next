/** Pieces shared by the Models card and the first-run option. */
import type { ReactNode } from 'react'
import { StateDot, type StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { LlamaCppPhase, LlamaCppState } from '@deepseek-ai/dsh-api-llama-cpp-controller'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { formatBytes } from './state.ts'
import type { NS } from './locales.ts'
import css from './LocalModel.module.css'

/** Translate within this plugin's namespace. */
export type T = TranslateNS<typeof NS>

const PHASE_KEY = {
  checking: 'phaseChecking', missing: 'phaseMissing', downloading: 'phaseDownloading', installed: 'phaseInstalled',
  starting: 'phaseStarting', running: 'phaseRunning', stopped: 'phaseStopped', failed: 'phaseFailed',
} as const satisfies Record<LlamaCppPhase, string>

function tone(phase: LlamaCppPhase): StateDotState {
  if (phase === 'running') return 'done'
  if (phase === 'failed') return 'error'
  if (phase === 'downloading' || phase === 'starting' || phase === 'checking') return 'ongoing'
  return 'idle'
}

/** @returns the total first download for this backend and model. */
export function downloadSize(state: LlamaCppState): string {
  return formatBytes(state.model.modelBytes + state.model.engineBytes)
}

/** Phase dot and label. */
export function Status({ state, t }: { state: LlamaCppState; t: T }): ReactNode {
  return <span className={css.status} data-testid="local-model-status" data-phase={state.phase}>
    <StateDot state={tone(state.phase)} />{t(PHASE_KEY[state.phase])}
  </span>
}

/** Byte progress of the active download step. */
export function Progress({ state, t }: { state: LlamaCppState; t: T }): ReactNode {
  const progress = state.progress
  if (state.phase !== 'downloading' || progress === undefined) return null
  const label = t(progress.phase === 'engine' ? 'progressEngine' : 'progressModel', {
    received: formatBytes(progress.receivedBytes), total: formatBytes(progress.totalBytes),
  })
  return <>
    <progress className={css.progress} aria-label={label} value={progress.receivedBytes} max={progress.totalBytes} />
    <p className={css.muted} data-testid="local-model-progress">{label}</p>
  </>
}

/** Failure message with the engine's last log lines. */
export function Failure({ state, t }: { state: LlamaCppState; t: T }): ReactNode {
  if (state.phase !== 'failed') return null
  return <div role="alert">
    <p className={css.error} data-testid="local-model-error">{state.error}</p>
    {state.logTail !== undefined && <details>
      <summary className={css.muted}>{t('details')}</summary>
      <pre className={css.log}>{state.logTail}</pre>
    </details>}
  </div>
}
