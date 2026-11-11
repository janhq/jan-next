/** Pieces shared by the Models card and the first-run option. */
import type { ReactNode } from 'react'
import { StateDot, type StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { LlamaCppPhase, LlamaCppProgress, LlamaCppState } from '@deepseek-ai/dsh-api-llama-cpp-controller'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { estimateRemaining, formatBytes } from './state.ts'
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

/**
 * One download's progress: a bar over the whole download, then percent, bytes, speed and time left.
 * @returns the bar and its caption.
 */
export function DownloadProgress({ progress, name, t }: { progress: LlamaCppProgress; name: string; t: T }): ReactNode {
  const received = progress.overallReceivedBytes
  const total = Math.max(progress.overallTotalBytes, 1)
  const percent = Math.min(100, Math.floor((received / total) * 100))
  const step = progress.phase === 'engine' ? t('progressEngineStep') : t('progressModelStep', { name })
  const eta = estimateRemaining(total - received, progress.bytesPerSecond)
  const detail = [
    t('progressDetail', { percent: String(percent), received: formatBytes(received), total: formatBytes(total) }),
    ...progress.bytesPerSecond > 0 ? [t('progressSpeed', { speed: formatBytes(progress.bytesPerSecond) })] : [],
    ...eta === undefined ? [] : [t(eta.key, eta.params)],
  ].join(' · ')
  return <div className={css.progressBlock}>
    <progress className={css.progress} aria-label={step} value={received} max={total} />
    <p className={css.muted} data-testid="local-model-progress">{step}: {detail}</p>
  </div>
}

/** Progress of the first download while nothing is installed yet (first run). */
export function Progress({ state, t }: { state: LlamaCppState; t: T }): ReactNode {
  const progress = state.progress
  if (state.phase !== 'downloading' || progress === undefined) return null
  return <DownloadProgress progress={progress} name={state.downloads[0]?.name ?? state.model.name} t={t} />
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
