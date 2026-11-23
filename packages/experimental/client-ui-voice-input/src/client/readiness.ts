/** One reconnecting Host readiness mirror shared by every voice UI occurrence. */
import type { Context } from '@janhq/cordis'
import { RemoteStreamCarrierError } from '@janhq/jan-api-gateway/client'
import { createSnapshotStore, type SnapshotStore } from '@janhq/jan-client-store'
import type { SpeechCatalog } from '@janhq/jan-experimental-api-speech-to-text/types'
import type {} from '@janhq/jan-experimental-api-speech-to-text/remote'
import type { SpeechPreparationState } from '@janhq/jan-experimental-speech-to-text/types'

/** Complete provider state, with a separate transport failure that never rewrites Host readiness. */
export interface SpeechReadiness {
  readonly catalog: SpeechCatalog | null
  readonly connected: boolean
  readonly error: string | null
}

/**
 * Determine whether a provider can accept audio now or wake when it receives audio.
 * @param phase - The provider's current preparation phase.
 * @returns Whether capture may begin.
 */
export function canRecord(phase: SpeechPreparationState['phase'] | undefined): boolean {
  return phase === 'ready' || phase === 'standby' || phase === 'waking'
}

/**
 * Mirror host readiness once a voice surface requests it.
 * @param ctx - mounted speech Remote owner.
 * @returns shared readiness snapshot and joined observation cleanup.
 */
export function observeReadiness(ctx: Context): { state: SnapshotStore<SpeechReadiness>; start: () => void; dispose: () => Promise<void> } {
  const state = createSnapshotStore<SpeechReadiness>({ catalog: null, connected: false, error: null })
  let disposed = false
  const isDisposed = (): boolean => disposed
  const fail = (error: unknown): void => {
    state.set({ ...state.getSnapshot(), connected: false, error: error instanceof Error ? error.message : String(error) })
  }
  let stop: (() => Promise<void>) | undefined
  const start = (): void => {
    if (disposed || stop) return
    const stream = ctx.remote.$stream<SpeechCatalog>({
      name: 'Speech readiness', open: signal => ctx.remote.speech.follow(signal),
      ended: () => new RemoteStreamCarrierError('Speech readiness stream ended'), carrierFailed: fail,
    })
    const observing = (async () => {
      try {
        for await (const item of stream) {
          state.set({ catalog: item.value, connected: true, error: null })
          item.accept()
        }
      } catch (error) { if (!isDisposed()) fail(error) }
    })()
    stop = async () => { await stream.dispose(); await observing }
  }
  return { state, start, dispose: async () => { disposed = true; await stop?.() } }
}
