/** Runtime display of titles that plugins write in another language, fed by the optional `pluginI18n` service. */
import type { HostObservable } from '@janhq/jan-client-ui-slots'

/** Display and request of translated titles; replaced on every change so consumers re-render. */
export interface ToolTitles {
  /** The cached translation of a title, or the title itself while none applies or none has arrived. */
  display(text: string): string
  /** Ask for the translation of a title on screen; a no-op unless one applies. */
  request(text: string): void
}

/** Shows every title as written. */
export const SOURCE_TITLES: ToolTitles = {
  display: text => text,
  request: () => {},
}

/**
 * Follows the translation service when one is composed and shows titles as written otherwise. The renderer binds
 * one hook to this source, so it keeps one identity while the service comes and goes.
 */
export class TitleBridge implements HostObservable<ToolTitles> {
  private current: ToolTitles = SOURCE_TITLES
  private readonly listeners = new Set<() => void>()

  getSnapshot(): ToolTitles {
    return this.current
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * Follow a translation service's titles until the returned disposer runs.
   * @param source - the service's title observable.
   * @returns disposer that returns to the titles as written.
   */
  attach(source: HostObservable<ToolTitles>): () => void {
    const adopt = (): void => {
      this.current = source.getSnapshot()
      this.notify()
    }
    adopt()
    const unsubscribe = source.subscribe(adopt)
    return () => {
      unsubscribe()
      this.current = SOURCE_TITLES
      this.notify()
    }
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener()
  }
}
