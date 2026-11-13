/** Unsubscribes the listener it was returned for. */
export interface Disposable {
  dispose(): void
}

/** Subscribes a listener; dispose the result to unsubscribe. */
export type Event<T> = (listener: (e: T) => void) => Disposable

/** The producing side of an `Event`. */
export class Emitter<T> {
  // Wrapped in objects so one function subscribed twice is two subscriptions.
  private listeners = new Set<{ fn: (e: T) => void }>()

  readonly event: Event<T> = (fn) => {
    const entry = { fn }
    this.listeners.add(entry)
    return { dispose: () => void this.listeners.delete(entry) }
  }

  /** Delivers `e` to every listener; a throwing one must not starve the rest. */
  fire(e: T): void {
    for (const { fn } of [...this.listeners]) {
      try {
        fn(e)
      } catch (error) {
        console.error('Event listener failed:', error)
      }
    }
  }

  dispose(): void {
    this.listeners.clear()
  }
}
