/** Ephemeral lifecycle of one session's context breakdown request. */
import { createSnapshotStore } from '@janhq/jan-client-store'
import type { ContextUsage } from '../types.ts'

/** Latest loading state and, when available, the last successful breakdown. */
export interface ContextPanelSnapshot {
  readonly status: 'loading' | 'ready' | 'error'
  readonly usage?: ContextUsage | undefined
}

/** Owns the open panel and the cancellation of its latest request. */
export class ContextPanelState {
  /** Observable panel state; `null` means the panel is closed. */
  readonly snapshot = createSnapshotStore<ContextPanelSnapshot | null>(null)
  private active: AbortController | undefined

  constructor(private readonly fetchBreakdown: (signal: AbortSignal) => Promise<ContextUsage>) {}

  /** Open or refresh the panel, retaining the last good breakdown until the request settles. */
  readonly refresh = (): void => {
    this.active?.abort()
    const request = new AbortController()
    this.active = request
    const usage = this.snapshot.getSnapshot()?.usage
    this.snapshot.set({ status: 'loading', usage })
    void this.load(request, usage)
  }

  /** Close the panel and cancel its outstanding request. */
  readonly dismiss = (): void => {
    this.active?.abort()
    this.active = undefined
    this.snapshot.set(null)
  }

  private async load(request: AbortController, previous: ContextUsage | undefined): Promise<void> {
    try {
      const usage = await this.fetchBreakdown(request.signal)
      if (this.active === request) this.snapshot.set({ status: 'ready', usage })
    } catch {
      if (this.active === request) this.snapshot.set({ status: 'error', usage: previous })
    } finally {
      if (this.active === request) this.active = undefined
    }
  }
}
