/** One localized instruction anchored to an existing interface element. */
export interface GuidanceStep {
  /** The target's exact data-guide value, in lowercase dotted domain-first form. */
  readonly target: string
  /** Plain-text localized heading, read at render so a language switch applies to the next card. */
  readonly title: () => string
  /** Plain-text localized instruction, read at render. */
  readonly body: () => string
  /** Wait for activation of the actual target instead of showing a Next button. */
  readonly advanceOn?: 'click'
}

/** Named, explicitly started tour in presentation order. */
export interface GuidanceTour {
  /** Stable id shared by start and seen-state operations. */
  readonly id: string
  readonly steps: readonly GuidanceStep[]
}

/** Browser guidance registry and local seen state. */
export interface GuidanceService {
  /**
   * Register a tour for the contributing plugin's lifetime.
   * @param tour - definition with a unique id and valid target names.
   * @returns a disposer that unregisters the tour and closes it without acknowledging it.
   * @throws when the id is already registered or a target name is invalid.
   */
  register(tour: GuidanceTour): () => void
  /**
   * Start or replay a registered tour, skipping missing targets.
   * A successful start dismisses any current tour; dismissal and completion mark the tour seen.
   * @param id - registered tour id.
   * @returns whether the tour started; unknown or currently unreachable tours leave the active tour unchanged.
   */
  start(id: string): boolean
  /**
   * Check whether a guidance item has been acknowledged in this app profile.
   * @param id - tour or coachmark id.
   * @returns whether the id has been recorded.
   */
  hasSeen(id: string): boolean
  /**
   * Acknowledge a tour or coachmark in the local app profile.
   * @param id - stable guidance id.
   */
  markSeen(id: string): void
  /** Clear tour and coachmark acknowledgements in the local app profile. */
  resetSeen(): void
}
