/** Non-consuming, line-oriented output subscription for one job. @module @janhq/jan-tool-jobs/watch */

import type { JobOutputRead } from '@janhq/jan-jobs'
import { TextRetainer } from '@janhq/jan-output-retention'

// Bound retained fragments for commands that never print a newline.
const MAX_LINE_CHARS = 16_384

interface PartialLine {
  text: string
  truncated: boolean
}

/** One watch's cursor, line fragments, deadline and pending notification. */
export class OutputWatch {
  private readonly stdout: PartialLine = { text: '', truncated: false }
  private readonly stderr: PartialLine = { text: '', truncated: false }
  private readonly log: PartialLine = { text: '', truncated: false }
  private batch: TextRetainer | undefined
  private timer: NodeJS.Timeout | undefined

  /**
   * @param offset - ring position when the watch starts.
   * @param pattern - optional filter applied to individual lines.
   * @param debounceMs - time after the first match to batch further matches.
   * @param remaining - number of live batches allowed.
   * @param maxBytes - maximum preview bytes per batch.
   * @param deliver - timer callback that delivers and counts a batch.
   */
  constructor(
    public offset: number,
    private readonly pattern: RegExp | undefined,
    private readonly debounceMs: number,
    public remaining: number,
    private readonly maxBytes: number,
    private readonly deliver: () => void,
  ) {}

  /** Read delta chunks, preserving per-stream partial lines without consuming the model cursor.
   * @param read - the registry delta at {@link offset}.
   */
  observe(read: JobOutputRead): void {
    this.offset = read.next
    if (read.lossy) {
      this.reset(this.stdout)
      this.reset(this.stderr)
      this.reset(this.log)
    }
    for (const chunk of read.chunks) {
      const line = chunk.channel === 'stderr' ? this.stderr : chunk.channel === 'log' ? this.log : this.stdout
      if (chunk.gapBefore) this.reset(line)
      let start = 0
      for (let end = chunk.text.indexOf('\n'); end !== -1; end = chunk.text.indexOf('\n', start)) {
        this.append(line, chunk.text, start, end)
        this.match(line)
        start = end + 1
      }
      this.append(line, chunk.text, start, chunk.text.length)
    }
    if (this.batch !== undefined && this.timer === undefined) {
      this.timer = setTimeout(this.deliver, this.debounceMs)
      this.timer.unref()
    }
  }

  /**
   * Collect and clear one notification, optionally finishing unterminated lines at settlement.
   * @param final - whether the stream has ended.
   * @returns the matching text, or undefined if nothing matched.
   */
  flush(final = false): string | undefined {
    if (final) {
      if (this.stdout.text.length > 0) this.match(this.stdout)
      if (this.stderr.text.length > 0) this.match(this.stderr)
      if (this.log.text.length > 0) this.match(this.log)
    }
    this.stop()
    const preview = this.batch?.finish()
    this.batch = undefined
    if (preview === undefined) return undefined
    return preview.truncated ? `${preview.text.trimEnd()}\n[watch output truncated]` : preview.text
  }

  /** Cancel any scheduled delivery. */
  stop(): void {
    clearTimeout(this.timer)
    this.timer = undefined
  }

  private append(line: PartialLine, text: string, start: number, end: number): void {
    const take = Math.min(end - start, MAX_LINE_CHARS - line.text.length)
    if (take > 0) line.text += text.slice(start, start + take)
    if (take < end - start) line.truncated = true
  }

  private match(line: PartialLine): void {
    const text = line.text.endsWith('\r') ? line.text.slice(0, -1) : line.text
    if (this.pattern === undefined || this.pattern.test(text)) {
      if (this.batch === undefined) this.batch = new TextRetainer({ kind: 'head', maxBytes: this.maxBytes })
      this.batch.push(line.truncated ? `${text} [line truncated]\n` : `${text}\n`)
    }
    this.reset(line)
  }

  private reset(line: PartialLine): void {
    line.text = ''
    line.truncated = false
  }
}
