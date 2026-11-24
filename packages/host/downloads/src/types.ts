import type {} from '@janhq/cordis'

/** The label and icon family for a transfer. */
export type DownloadKind = 'model' | 'update' | 'backend' | 'plugin' | 'voice' | 'file'
/** Nonterminal transfer states. */
export type DownloadActiveState = 'queued' | 'downloading' | 'paused'
/** Terminal transfer states retained until the inbox is cleared. */
export type DownloadFinishState = 'done' | 'failed' | 'cancelled'
/** Actions the producer explicitly makes available for one row. */
export type DownloadAction = 'cancel' | 'pause' | 'resume' | 'retry' | 'open' | 'reveal'
/** Producer callbacks stay on the Host and are never serialized. */
export type DownloadActions = Partial<Record<DownloadAction, () => void | Promise<void>>>

/** Initial data for one attempt; an explicit id replaces its previous attempt. */
export interface DownloadStart {
  readonly id?: string
  readonly kind: DownloadKind
  readonly name: string
  readonly totalBytes?: number
  readonly actions?: DownloadActions
}

/** A cumulative progress report. Actions replace the previous set when specified. */
export interface DownloadUpdate {
  readonly state?: DownloadActiveState
  readonly receivedBytes?: number
  readonly totalBytes?: number
  readonly percent?: number
  readonly bytesPerSecond?: number
  readonly actions?: DownloadActions
}

/** Producer-owned reporting handle; reports after settlement or replacement are ignored. */
export interface DownloadHandle {
  /** @param update - Cumulative transfer progress or action changes. */
  update(update: DownloadUpdate): void
  /** @param state - Outcome. @param error - Diagnostic text. @param actions - Actions still valid after settlement. */
  finish(state: DownloadFinishState, error?: string, actions?: DownloadActions): void
}

/** Inbox record; this contains no local paths or producer callback functions. */
export interface DownloadItem {
  readonly id: string
  readonly kind: DownloadKind
  readonly name: string
  readonly state: DownloadActiveState | DownloadFinishState
  readonly actions: readonly DownloadAction[]
  readonly receivedBytes?: number
  readonly totalBytes?: number
  readonly percent?: number
  readonly bytesPerSecond?: number
  readonly error?: string
}

/** Current transfers and badge state; sequence is the last observed terminal notification. */
export interface DownloadSnapshot {
  readonly items: readonly DownloadItem[]
  readonly active: { readonly count: number; readonly percent: number | null }
  readonly unseen: { readonly sequence: number; readonly failed: boolean } | null
}

/** Session-local Host service used by download producers. */
export interface DownloadStore {
  /**
   * Report a new transfer attempt.
   * @param initial - Transfer identity and optional actions.
   * @returns Attempt-specific reporting handle.
   */
  start(initial: DownloadStart): DownloadHandle
  /**
   * Read the transfer list and badge state.
   * @returns Current immutable transfer list and badge state.
   */
  snapshot(): DownloadSnapshot
  /**
   * Observe changes to the transfer list.
   * @param listener - Called on changes; byte-only changes are coalesced.
   * @returns Removal callback.
   */
  subscribe(listener: () => void): () => void
  /**
   * Clear the unseen dot for finishes up to a sequence.
   * @param sequence - Acknowledge finishes seen up to this sequence.
   */
  markSeen(sequence: number): void
  /** Remove terminal rows, never an active or paused transfer. */
  clearFinished(): void
  /**
   * Run one producer action that the transfer currently offers.
   * @param id - Transfer to operate on.
   * @param action - Current producer callback to run.
   * @returns Settles when the producer callback settles.
   */
  act(id: string, action: DownloadAction): Promise<void>
  /** Withdraw subscriptions and scheduled publications. */
  dispose(): void
}

declare module '@janhq/cordis' {
  interface Context {
    /** Optional Host reporting capability for downloads. */
    downloads: DownloadStore
  }
}
