/** Focus and highlight a destination only inside the active Settings pane. */
import { isBehindModal } from '@janhq/jan-client-ui-primitives'
import type { SettingsSearchTarget } from './settings-search.ts'

const MOUNT_WAIT_MS = 1_000
const HIGHLIGHT_MS = 1_600
const HIGHLIGHT = 'data-settings-revealed'

/**
 * Reveal the destination now or wait for its content to mount.
 * @param pane - the active scrollable Settings region.
 * @param target - the requested page or owned row.
 * @param unavailable - reports a destination that did not mount before the deadline.
 * @returns disposer for the observer, timers and highlight.
 */
export function revealSettingsTarget(pane: HTMLElement, target: SettingsSearchTarget, unavailable: () => void): () => void {
  let highlighted: HTMLElement | undefined
  let observer: MutationObserver | undefined
  let timeout: number | undefined
  const stop = () => {
    observer?.disconnect()
    observer = undefined
    window.clearTimeout(timeout)
  }
  const reveal = (): boolean => {
    const outlet = pane.querySelector(':scope > [data-slot="settings.section"]')
    const destination = target.destination
    const element = destination.kind === 'page'
      ? (outlet?.hasChildNodes() ? pane : null)
      : [...(outlet?.querySelectorAll<HTMLElement>('[data-settings-search-row]') ?? [])]
        .find(row => row.dataset.settingsSearchRow === destination.id)
    if (element == null || element.closest('[hidden], [inert]') !== null) return false
    stop()
    if (element === pane) pane.scrollTop = 0
    // Centered, so the row is not left against the pane edge under a floating notice.
    else element.scrollIntoView({ block: 'center', inline: 'nearest' })
    if (!isBehindModal(element)) element.focus({ preventScroll: true })
    element.setAttribute(HIGHLIGHT, '')
    highlighted = element
    timeout = window.setTimeout(() => { element.removeAttribute(HIGHLIGHT) }, HIGHLIGHT_MS)
    return true
  }
  if (!reveal()) {
    observer = new MutationObserver(reveal)
    observer.observe(pane, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'inert'] })
    timeout = window.setTimeout(() => { stop(); unavailable() }, MOUNT_WAIT_MS)
  }
  return () => { stop(); highlighted?.removeAttribute(HIGHLIGHT) }
}
