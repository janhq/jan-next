/** Download speed measurement. */

/** Window the transfer rate is averaged over. */
const WINDOW_MS = 3000

/** Shortest span a rate is reported for, so the first chunks do not read as a burst. */
const MIN_SPAN_MS = 500

/** Rolling transfer rate over the last {@link WINDOW_MS} of samples. */
export class RateMeter {
  private readonly samples: { at: number; bytes: number }[] = []

  /**
   * Record a cumulative byte count.
   * @param bytes - bytes received so far.
   * @param at - sample time in milliseconds.
   * @returns bytes per second over the window, or 0 until it spans {@link MIN_SPAN_MS}.
   */
  sample(bytes: number, at: number): number {
    this.samples.push({ at, bytes })
    while (this.samples.length > 2 && at - (this.samples[1]?.at ?? at) >= WINDOW_MS) this.samples.shift()
    const first = this.samples[0]
    if (first === undefined) return 0
    const span = at - first.at
    if (span < MIN_SPAN_MS || bytes < first.bytes) return 0
    return Math.round(((bytes - first.bytes) * 1000) / span)
  }
}
