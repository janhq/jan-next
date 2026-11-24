import { createSnapshotStore } from '@janhq/jan-client-store'

export interface SideAnswer {
  readonly question: string
  readonly text: string
  readonly status: 'streaming' | 'done' | 'error'
  readonly error?: 'noModel' | 'failed'
}

/** Owns the latest side answer and its independent cancellation. */
export class SideAnswerState {
  private readonly snapshot = createSnapshotStore<SideAnswer | null>(null, { flush: 'raf' })
  readonly subscribe = (listener: () => void): (() => void) => this.snapshot.subscribe(listener)
  readonly getSnapshot = (): SideAnswer | null => this.snapshot.getSnapshot()
  private active: AbortController | undefined

  constructor(private readonly ask: (question: string, signal: AbortSignal) => AsyncIterable<string>) {}

  start(question: string): void {
    this.active?.abort()
    const request = new AbortController()
    this.active = request
    this.snapshot.set({ question, text: '', status: 'streaming' })
    void this.read(question, request)
  }

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
