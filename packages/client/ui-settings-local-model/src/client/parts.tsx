/** Pieces shared by the Models card and the first-run option. */
import type { ReactNode } from 'react'
import { StateDot, Tag, type StateDotState } from '@janhq/jan-client-ui-primitives'
import type { LlamaCppHardware, LlamaCppPhase, LlamaCppProgress, LlamaCppState, ModelFit } from '@janhq/jan-api-llama-cpp-controller'
import type { TranslateNS } from '@janhq/jan-client-ui-slots'
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

/** @returns the size of the first-run model download. */
export function downloadSize(state: LlamaCppState): string {
  return formatBytes(state.model.modelBytes)
}

/** Phase dot and label. */
export function Status({ state, t }: { state: LlamaCppState; t: T }): ReactNode {
  return <span className={css.status} data-testid="local-model-status" data-phase={state.phase}>
    <StateDot state={tone(state.phase)} />{t(PHASE_KEY[state.phase])}
  </span>
}

/**
 * One download's progress: a bar, then percent, bytes, speed and time left.
 * @returns the bar and its caption.
 */
export function DownloadProgress({ progress, name, t }: { progress: LlamaCppProgress; name: string; t: T }): ReactNode {
  const received = progress.receivedBytes
  const total = Math.max(progress.totalBytes, 1)
  const percent = Math.min(100, Math.floor((received / total) * 100))
  const step = t('progressModelStep', { name })
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
  const running = state.downloads.find(item => item.error === undefined && item.paused === undefined && item.progress !== undefined)
  return <DownloadProgress progress={progress} name={running?.name ?? state.model.name} t={t} />
}

/** Failure message with the worker's last log lines. */
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

const FIT = {
  fits: { label: 'fitFits', hint: 'fitFitsHint', tone: 'success' },
  tight: { label: 'fitTight', hint: 'fitTightHint', tone: 'warning' },
  'too-large': { label: 'fitTooLarge', hint: 'fitTooLargeHint', tone: 'danger' },
} as const satisfies Record<ModelFit, { label: string; hint: string; tone: 'success' | 'warning' | 'danger' }>

/** How a model compares with this machine's memory; nothing while that is unknown. */
export function FitTag({ fit, t }: { fit: ModelFit | undefined; t: T }): ReactNode {
  if (fit === undefined) return null
  const copy = FIT[fit]
  return <span title={t(copy.hint)} data-testid="local-model-fit" data-fit={fit}><Tag tone={copy.tone}>{t(copy.label)}</Tag></span>
}

/** Marks a model that reads images through its vision projector. */
export function VisionTag({ t }: { t: T }): ReactNode {
  return <span title={t('visionHint')} data-testid="local-model-vision"><Tag tone="neutral">{t('visionTag')}</Tag></span>
}

/** One line naming the accelerators, the backend and system memory the worker found. */
export function HardwareSummary({ hardware, t }: { hardware: LlamaCppHardware | undefined; t: T }): ReactNode {
  if (hardware === undefined) return null
  const devices = hardware.devices.map(device => `${device.name} (${formatBytes(device.totalMiB * 1024 * 1024)})`).join(', ')
  const parts = [
    hardware.devices.length === 0 ? t('hardwareCpuOnly') : t('hardwareDevices', { devices }),
    t('hardwareBackend', { backend: hardware.backend }),
    t('hardwareMemory', { memory: formatBytes(hardware.memoryBytes) }),
  ]
  return <p className={css.muted} data-testid="local-model-hardware">{parts.join(' · ')}</p>
}
