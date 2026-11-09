/** One reconnecting mirror of the Host's local model state, shared by every view. */
import type { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { LlamaCppState } from '@deepseek-ai/dsh-api-llama-cpp-controller'
import type {} from '@deepseek-ai/dsh-api-llama-cpp-controller/remote'

/** Latest Host state plus transport health; a lost stream never rewrites the Host state. */
export interface LocalModelMirror {
  readonly state: LlamaCppState | null
  readonly connected: boolean
}

/**
 * Follow the Host state for the plugin's lifetime.
 * @param ctx - context owning the mounted `llamaCpp` Remote.
 * @returns the shared snapshot store and its cleanup.
 */
export function observeLocalModel(ctx: Context): { store: SnapshotStore<LocalModelMirror>; dispose: () => Promise<void> } {
  const store = createSnapshotStore<LocalModelMirror>({ state: null, connected: false })
  let disposed = false
  const lost = (): void => { store.set({ ...store.getSnapshot(), connected: false }) }
  const stream = ctx.remote.$stream<LlamaCppState>({
    name: 'Local model state', open: signal => ctx.remote.llamaCpp.follow(signal),
    ended: () => new Error('Local model state stream ended'), carrierFailed: lost,
  })
  const observing = (async () => {
    try {
      for await (const item of stream) {
        store.set({ state: item.value, connected: true })
        item.accept()
      }
    } catch { if (!disposed) lost() }
  })()
  return { store, dispose: async () => { disposed = true; await stream.dispose(); await observing } }
}

/**
 * Format a byte count for people.
 * @param bytes - size in bytes.
 * @returns e.g. "2.7 GB" or "23 MB".
 */
export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`
  if (bytes <= 0) return '0 MB'
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`
}
