import { createSnapshotStore } from '@janhq/jan-client-store'

/** An ephemeral side question and its latest answer text, including partial text on failure. */
export interface SideAnswer {
  readonly question: string
  readonly text: string
  readonly status: 'streaming' | 'done' | 'error'
  readonly error?: 'noModel' | 'failed'
}

/** Owns the latest side answer and its independent cancellation. */
export class SideAnswerState {
  private readonly snapshot = createSnapshotStore<SideAnswer | null>(null, { flush: 'raf' })
  /**
   * Subscribe to answer changes, batched by animation frame in the browser.
   * @param listener - callback to notify when the snapshot changes.
   * @returns the unsubscribe function.
   */
  readonly subscribe = (listener: () => void): (() => void) => this.snapshot.subscribe(listener)
  /** Read the latest answer snapshot, or null when no answer panel is open. */
  readonly getSnapshot = (): SideAnswer | null => this.snapshot.getSnapshot()
  private active: AbortController | undefined

  constructor(private readonly ask: (question: string, signal: AbortSignal) => AsyncIterable<string>) {}

  /**
   * Start streaming a new side answer, cancelling any previous side request.
   * @param question - question to send to the side-answer stream.
   */
  start(question: string): void {
    this.active?.abort()
    const request = new AbortController()
    this.active = request
    this.snapshot.set({ question, text: '', status: 'streaming' })
    void this.read(question, request)
  }

  /** Clear the answer panel and cancel any active side request. */
  readonly dismiss = (): void => {
    this.active?.abort()
    this.active = undefined
    this.snapshot.set(null)
  }

  private async read(question: string, request: AbortController): Promise<void> {
    let text = ''
    try {
      for await (const delta of this.ask(question, request.signal)) {
        if (this.active !== request) return
        text += delta
        this.snapshot.set({ question, text, status: 'streaming' })
      }
      if (this.active === request) this.snapshot.set({ question, text, status: 'done' })
    } catch (error: unknown) {
      if (this.active !== request) return
      const noModel = typeof error === 'object' && error !== null && 'code' in error && error.code === 'btw/no-model'
      this.snapshot.set({ question, text, status: 'error', error: noModel ? 'noModel' : 'failed' })
    } finally {
      if (this.active === request) this.active = undefined
    }
  }
}
