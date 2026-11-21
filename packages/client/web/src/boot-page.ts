/**
 * Framework-free boot page and failure report. It remains available when a
 * client plugin fails because React arrives only with the UI renderer.
 * @module @janhq/jan-client-web/src/boot-page
 */
import type { LoaderEntryState } from './loader-status.ts'
import css from './boot-page.module.css'

/** Create a div with one module class and optional text. */
function div(className: string | undefined, text?: string): HTMLDivElement {
  const el = document.createElement('div')
  el.className = className ?? ''
  if (text !== undefined) el.textContent = text
  return el
}

/** Kernel-owned page mounted below the application's root element. */
export class BootPage {
  private readonly root: HTMLDivElement
  private readonly card: HTMLDivElement
  private readonly mark: HTMLDivElement
  private readonly wordmark: HTMLDivElement
  private readonly progress: HTMLDivElement
  private readonly hint: HTMLDivElement
  private readonly states = new Map<string, LoaderEntryState>()
  private readonly active = new Set<string>()
  private total = 0
  private failure: string | undefined

  /**
   * Build and attach the boot page.
   * @param container - Application mount point.
   */
  constructor(container: HTMLElement) {
    this.root = div(css.boot)
    this.root.dataset.janBoot = ''
    this.card = div(css.card)
    this.mark = div(css.mark, '\u{1F44B}')
    this.mark.setAttribute('aria-hidden', 'true')
    this.wordmark = div(css.wordmark, 'Jan')
    this.progress = div(css.progress)
    this.progress.dataset.janBootProgress = ''
    this.progress.setAttribute('role', 'progressbar')
    this.progress.setAttribute('aria-label', 'Loading plugins')
    this.hint = div(css.hint, 'Loading plugins…')
    this.card.append(this.mark, this.wordmark, this.progress, this.hint)
    this.root.append(this.card)
    container.append(this.root)
    this.updateProgress()
  }

  /**
   * Set the number of loader entries represented by the progress bar.
   * @param total - Complete boot roster size.
   */
  setTotal(total: number): void {
    this.total = total
    this.updateProgress()
  }

  /**
   * Project one loader entry's fiber state.
   * @param id - Loader entry name.
   * @param state - Projected fiber state.
   */
  setState(id: string, state: LoaderEntryState): void {
    this.states.set(id, state)
    if (state === 'active') this.active.add(id)
    this.updateProgress()
    this.render()
  }

  /**
   * Display the boot failure report.
   * @param message - Failure report text.
   */
  fail(message: string): void {
    this.failure = message
    this.render()
  }

  /** Detach the page before or after the UI renderer takes the mount point. */
  dispose(): void {
    this.root.remove()
  }

  /** Redraw the state-dependent content below the wordmark. */
  private render(): void {
    const failed = [...this.states].filter(([, state]) => state === 'failed').map(([id]) => id)
    if (this.failure === undefined && failed.length === 0) {
      if (this.progress.parentElement !== this.card) {
        this.card.replaceChildren(this.mark, this.wordmark, this.progress, this.hint)
      }
      return
    }
    const report = div(css.failed)
    report.append(div(css.failedTitle, 'Failed to load plugins'))
    for (const id of failed) report.append(div(css.failedItem, id))
    if (this.failure !== undefined) report.append(div(css.failedItem, this.failure))
    this.card.replaceChildren(this.mark, this.wordmark, report)
  }

  /** Grow the progress bar monotonically as loader entries activate; it starts a fifth full so it reads as alive. */
  private updateProgress(): void {
    const ratio = this.total === 0 ? 0 : Math.min(this.active.size / this.total, 1)
    this.progress.style.setProperty('--jan-boot-progress', `${String(Math.round(20 + ratio * 80))}%`)
  }
}
