/** Back / Forward stacks of main-view locations; pure bookkeeping, the service owns replay. */
import { createSnapshotStore } from '@janhq/jan-client-store'
import type { ObservableSnapshot } from '@janhq/jan-client-store'
import type { SubagentAddress } from '@janhq/jan-subagent/client'
import type { SessionId } from '@janhq/jan-session/types'
import type { MainPanelId } from '@janhq/jan-client-ui-layout/client'

/** Most entries one stack keeps; the oldest drop first. */
export const NAVIGATION_HISTORY_LIMIT = 50

/** One main-view state: the Session it shows (or none) and the global panel laid over it. */
export interface NavigationLocation {
  readonly sessionId?: SessionId
  readonly subagentAddress?: SubagentAddress
  /** Selected global panel; null displays the Conversation. */
  readonly panelId: MainPanelId | null
}

/** Whether Back and Forward have somewhere to go. */
export interface NavigationAvailability {
  readonly canGoBack: boolean
  readonly canGoForward: boolean
}

/** Stack direction a step moves toward. */
export type NavigationDirection = 'back' | 'forward'

/**
 * Whether two locations show the same thing. A subagent address is identified by
 * its parent and child: the mode can be resolved later without changing the target.
 * @param a - first location.
 * @param b - second location.
 * @returns true when panel and Session or subagent match.
 */
export function sameLocation(a: NavigationLocation, b: NavigationLocation): boolean {
  return a.panelId === b.panelId && sameSession(a, b)
}

/**
 * Whether two locations select the same Session or subagent.
 * @param a - first selection.
 * @param b - second selection.
 * @returns true when Session id and subagent parent and child match.
 */
export function sameSession(
  a: Pick<NavigationLocation, 'sessionId' | 'subagentAddress'>,
  b: Pick<NavigationLocation, 'sessionId' | 'subagentAddress'>,
): boolean {
  return a.sessionId === b.sessionId
    && a.subagentAddress?.parentSessionId === b.subagentAddress?.parentSessionId
    && a.subagentAddress?.childSessionId === b.subagentAddress?.childSessionId
}

/**
 * Browser-style history: `current` is where the user is, `back` and `forward`
 * hold the places on either side. Nothing persists; a restart starts empty.
 */
export class NavigationHistory {
  private back: NavigationLocation[] = []
  private forward: NavigationLocation[] = []
  private current: NavigationLocation | undefined
  private published: NavigationAvailability = { canGoBack: false, canGoForward: false }
  private readonly store = createSnapshotStore<NavigationAvailability>(this.published)

  /** Observable `{ canGoBack, canGoForward }`; republished only when a flag flips. */
  get availability(): ObservableSnapshot<NavigationAvailability> {
    return this.store
  }

  /**
   * Make `next` the current location as a new navigation: the place left joins
   * Back and Forward is discarded. Re-entering the current location is a no-op,
   * and the first location has nothing to leave.
   * @param next - location the user navigated to.
   */
  record(next: NavigationLocation): void {
    const current = this.current
    if (current !== undefined) {
      if (sameLocation(current, next)) {
        this.current = next
        return
      }
      this.back.push(current)
      if (this.back.length > NAVIGATION_HISTORY_LIMIT) this.back.shift()
      this.forward = []
    }
    this.current = next
    this.publish()
  }

  /**
   * Replace the current location without leaving an entry (startup restoration, system-driven changes).
   * @param next - location to show as current.
   */
  seed(next: NavigationLocation): void {
    this.current = next
  }

  /**
   * The nearest entry in `direction` that `isValid` accepts. Entries it rejects,
   * and entries that show the current location, are dropped on the way.
   * @param direction - stack to read.
   * @param isValid - whether a location still exists.
   * @returns the entry to replay, or undefined when none is left.
   */
  peek(direction: NavigationDirection, isValid: (location: NavigationLocation) => boolean): NavigationLocation | undefined {
    const stack = direction === 'back' ? this.back : this.forward
    while (stack.length > 0) {
      const candidate = stack[stack.length - 1] as NavigationLocation
      if (isValid(candidate) && (this.current === undefined || !sameLocation(candidate, this.current))) return candidate
      stack.pop()
    }
    this.publish()
    return undefined
  }

  /**
   * Move to the entry `peek` returned; the location left joins the opposite stack.
   * @param direction - stack `peek` read.
   */
  commit(direction: NavigationDirection): void {
    const from = direction === 'back' ? this.back : this.forward
    const to = direction === 'back' ? this.forward : this.back
    const target = from.pop()
    if (target === undefined) return
    if (this.current !== undefined) {
      to.push(this.current)
      if (to.length > NAVIGATION_HISTORY_LIMIT) to.shift()
    }
    this.current = target
    this.publish()
  }

  /**
   * Drop the entry `peek` returned, for a replay that failed.
   * @param direction - stack `peek` read.
   */
  discard(direction: NavigationDirection): void {
    const stack = direction === 'back' ? this.back : this.forward
    stack.pop()
    this.publish()
  }

  /**
   * Drop every entry `isValid` rejects, so the buttons only enable for places that still exist.
   * @param isValid - whether a location still exists.
   */
  prune(isValid: (location: NavigationLocation) => boolean): void {
    if (this.back.every(isValid) && this.forward.every(isValid)) return
    this.back = this.back.filter(isValid)
    this.forward = this.forward.filter(isValid)
    this.publish()
  }

  private publish(): void {
    const canGoBack = this.back.length > 0
    const canGoForward = this.forward.length > 0
    if (canGoBack === this.published.canGoBack && canGoForward === this.published.canGoForward) return
    this.published = { canGoBack, canGoForward }
    this.store.set(this.published)
  }
}
