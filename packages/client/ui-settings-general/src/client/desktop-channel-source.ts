/** One shell-owned channel subscription shared by Settings views and their toast. */
import { createSnapshotStore } from '@janhq/jan-client-store'
import { captureFailure, type FailureDetails } from '@janhq/jan-client-ui-primitives'
import type { DesktopChannelBridge, DesktopChannelState, DesktopUpdateChannel, DesktopChannelChangeResult } from '../types.ts'

type Notice = { sequence: number; outcome: 'configuration' | 'applied' | Extract<DesktopChannelChangeResult, { kind: 'failed' }>['reason']; failure?: FailureDetails }
/** Actual shell state, optimistic selection and transient operation feedback. */
export interface DesktopChannelSnapshot {
  state?: DesktopChannelState
  failed: boolean
  pending?: DesktopUpdateChannel
  notice?: Notice
}

/** Client observation; no Host service or configuration file is read here. */
export class DesktopChannelSource {
  /** Stable observation shared by mounted General views and the shell toast. */
  readonly store = createSnapshotStore<DesktopChannelSnapshot>({ failed: false })
  private live = true
  private revision = 0
  private sequence = 0
  private readonly unsubscribe: () => void

  /** @param bridge - Isolated shell API, present only in Desktop. */
  constructor(private readonly bridge: DesktopChannelBridge) {
    this.unsubscribe = bridge.subscribe((state) => {
      if (!this.live) return
      this.revision++
      this.receive(state)
    })
    void bridge.get().then((state) => {
      if (this.live && this.revision === 0) this.receive(state)
    }, () => {
      if (this.live && this.revision === 0) this.store.set({ ...this.store.getSnapshot(), failed: true })
    })
  }

  private receive(state: DesktopChannelState): void {
    const previous = this.store.getSnapshot()
    const ownSaveFailure = previous.pending !== undefined || previous.notice?.outcome === 'uncertain'
    const notify = !ownSaveFailure && state.error !== undefined && state.error !== 'cleanup' && state.error !== previous.state?.error
    this.store.set({ ...previous, state, failed: false,
      ...(notify ? { notice: { sequence: ++this.sequence, outcome: 'configuration' as const,
        failure: captureFailure('desktop.channel.configure', { code: state.error }) } } : {}),
    })
  }

  /**
   * Show a pending choice until the shell reports its actual selection.
   * @param channel - Selected feed.
   * @returns After the shell reports the result.
   */
  async select(channel: DesktopUpdateChannel): Promise<void> {
    if (!this.isLive() || this.store.getSnapshot().pending !== undefined) return
    const state = this.store.getSnapshot().state
    if (state?.channel === channel && state.error === undefined && !state.changing) return
    const revision = this.revision
    const { notice: _notice, ...previous } = this.store.getSnapshot()
    this.store.set({ ...previous, pending: channel })
    let result: DesktopChannelChangeResult | undefined
    let failure: FailureDetails | undefined
    try {
      result = await this.bridge.set(channel)
    } catch (error) {
      failure = captureFailure('desktop.channel.select', error)
    }
    if (!this.isLive()) return
    if (result?.kind === 'failed') failure = captureFailure('desktop.channel.select', { code: result.reason })
    const accept = result !== undefined && revision === this.revision
    if (accept) this.revision++
    const { pending: _pending, ...current } = this.store.getSnapshot()
    this.store.set({
      ...current,
      ...(accept && result !== undefined ? { state: result.state, failed: false } : {}),
      ...(result?.kind === 'unchanged' ? {} : {
        notice: { sequence: ++this.sequence, outcome: result?.kind === 'applied' ? 'applied' as const : result?.kind === 'failed' ? result.reason : 'save' as const,
          ...failure === undefined ? {} : { failure } },
      }),
    })
  }

  /**
   * Retire only the toast whose animation completed.
   * @param sequence - Notice identity captured by the rendered toast.
   */
  dismissNotice(sequence: number): void {
    const current = this.store.getSnapshot()
    if (current.notice?.sequence !== sequence) return
    const { notice: _notice, ...next } = current
    this.store.set(next)
  }

  private isLive(): boolean { return this.live }

  /** Detach the shell subscription and ignore late IPC responses. */
  dispose(): void { this.live = false; this.unsubscribe() }
}
