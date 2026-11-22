/**
 * Smooth streaming for Assistant prose. Network chunks arrive in bursts; the
 * reader sees text released at a steady, backlog-adaptive pace, whole words at
 * a time, and each newly shown run fades in over a few frames. The fade paints
 * through the CSS Custom Highlight API, so the React-owned Markdown DOM is never
 * touched. Reduced motion shows text as it arrives.
 */
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'

/** Slowest release, in characters per second (a brisk reading pace), so a backlog's tail does not crawl. */
const MIN_CPS = 300
/** A backlog drains within this many milliseconds while chunks keep arriving. */
const DRAIN_MS = 360
/** After the stream ends, what is left still types out, within this many milliseconds. */
const FINISH_MS = 700
/** A word longer than this is released mid-word instead of waiting for its end. */
const WORD_REACH = 16
/** Fade steps; each lasts STEP_MS. */
export const FADE_STEPS = 3
const STEP_MS = 70

const reducedMotion = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * How many characters of `text` to show after `elapsed` milliseconds, given `shown` now.
 * Releases at least one word per step and never splits a surrogate pair.
 * @param shown - characters currently shown.
 * @param text - full text received so far.
 * @param elapsed - milliseconds since the previous step.
 * @param finishing - the stream has ended; drain faster.
 * @returns the new shown length, at most `text.length`.
 */
export function revealStep(shown: number, text: string, elapsed: number, finishing: boolean): number {
  const backlog = text.length - shown
  if (backlog <= 0) return text.length
  const cps = Math.max(MIN_CPS, (backlog * 1000) / (finishing ? FINISH_MS : DRAIN_MS))
  let next = Math.min(text.length, shown + Math.max(1, Math.round((cps * elapsed) / 1000)))
  // Finish the word in progress so text appears a word at a time.
  const limit = Math.min(text.length, next + WORD_REACH)
  let end = next
  while (end < limit && !/\s/u.test(text[end] ?? '')) end++
  if (end < limit || end === text.length) next = end
  const code = text.charCodeAt(next - 1)
  if (code >= 0xd800 && code <= 0xdbff && next < text.length) next++
  return next
}

/** Characters of a reply's opening that identify it across renderer remounts. */
const KEY_CHARS = 48
/** Progress older than this belongs to a different reply. */
const PROGRESS_TTL_MS = 5_000
/** A live reply first seen longer than this shows at once instead of typing out from the start. */
const CATCH_UP_LIMIT = 4_000

/**
 * Shown length per reply opening. The streaming partial and the settled message are separate
 * renderer instances, and a running reply can remount when its Turn regroups; the paced
 * position carries over so the text neither jumps ahead nor types out again.
 */
const progress = new Map<string, { shown: number; at: number }>()

function initialShown(text: string, streaming: boolean): number {
  const now = Date.now()
  for (const [key, entry] of progress) if (now - entry.at > PROGRESS_TTL_MS) progress.delete(key)
  const carried = progress.get(text.slice(0, KEY_CHARS))
  if (carried !== undefined) return Math.min(carried.shown, text.length)
  return streaming && text.length <= CATCH_UP_LIMIT ? 0 : text.length
}

/**
 * Pace `text` for display. A live reply types out from where it was last shown, also
 * across remounts and the swap to the settled message; settled history shows at once;
 * a non-append replacement shows at once.
 * @returns the text to render and whether it has caught up with a finished stream.
 */
export function useSmoothText(text: string, streaming: boolean): { text: string; settled: boolean } {
  const [, rerender] = useState(0)
  const shown = useRef<number | undefined>(undefined)
  const source = useRef(text)
  const streamingRef = useRef(streaming)
  streamingRef.current = streaming
  shown.current ??= initialShown(text, streaming)
  // Hidden documents get no animation frames; show everything rather than stall the settled swap.
  const skip = reducedMotion() || (typeof document !== 'undefined' && document.visibilityState === 'hidden')
  if (skip || !text.startsWith(source.current.slice(0, shown.current))) shown.current = text.length
  source.current = text
  const behind = shown.current < text.length
  const frame = useRef(0)
  const last = useRef(0)
  // The loop stops once it catches up; text that lands before its last rerender commits
  // leaves `behind` unchanged, so every render that is behind restarts a stopped loop.
  useEffect(() => {
    if (!behind) {
      if (!streaming) progress.delete(source.current.slice(0, KEY_CHARS))
      return
    }
    if (frame.current !== 0) return
    last.current = performance.now()
    const step = (now: number): void => {
      const target = source.current
      shown.current = revealStep(shown.current ?? 0, target, Math.max(0, now - last.current), !streamingRef.current)
      progress.set(target.slice(0, KEY_CHARS), { shown: shown.current, at: Date.now() })
      last.current = now
      frame.current = shown.current < target.length ? requestAnimationFrame(step) : 0
      rerender(value => value + 1)
    }
    frame.current = requestAnimationFrame(step)
  })
  useEffect(() => {
    // A hidden document gets no frames; show the rest so returning finds the full reply.
    const hide = (): void => {
      if (document.visibilityState !== 'hidden' || shown.current === source.current.length) return
      cancelAnimationFrame(frame.current)
      frame.current = 0
      shown.current = source.current.length
      progress.delete(source.current.slice(0, KEY_CHARS))
      rerender(value => value + 1)
    }
    document.addEventListener('visibilitychange', hide)
    return () => {
      cancelAnimationFrame(frame.current)
      frame.current = 0
      document.removeEventListener('visibilitychange', hide)
    }
  }, [])
  const visible = behind ? text.slice(0, shown.current) : text
  return { text: visible, settled: !streaming && !behind }
}

interface FreshRun { range: Range; born: number }
const fresh: FreshRun[] = []
let fadeFrame = 0

function highlights(): HighlightRegistry | undefined {
  return typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight === 'function' ? CSS.highlights : undefined
}

function paintFades(now: number): void {
  const registry = highlights()
  if (registry === undefined) return
  const steps: Range[][] = Array.from({ length: FADE_STEPS }, () => [])
  const live = fresh.filter((run) => {
    // A frame's timestamp can precede a run pushed earlier in the same frame.
    const step = Math.max(0, Math.floor((now - run.born) / STEP_MS))
    steps[step]?.push(run.range)
    return step < FADE_STEPS
  })
  fresh.splice(0, fresh.length, ...live)
  steps.forEach((ranges, step) => { registry.set(`jan-stream-fade-${step}`, new Highlight(...ranges)) })
  fadeFrame = fresh.length > 0 ? requestAnimationFrame(paintFades) : 0
}

/** A range over the last `count` characters of `root`'s text. */
function tailRange(root: Node, count: number): Range | undefined {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) nodes.push(node as Text)
  let remaining = count
  const range = document.createRange()
  const last = nodes.at(-1)
  if (last === undefined) return undefined
  range.setEnd(last, last.length)
  for (const node of nodes.toReversed()) {
    if (node.length >= remaining) { range.setStart(node, node.length - remaining); return range }
    remaining -= node.length
  }
  range.setStart(nodes[0] ?? last, 0)
  return range
}

/**
 * Fade in text appended under `root` while `active`. Call after every render that may append.
 * @param root - the rendered Markdown container.
 * @param active - the text is streaming in.
 */
export function useStreamFade(root: RefObject<HTMLElement | null>, active: boolean): void {
  const length = useRef<number | undefined>(undefined)
  useLayoutEffect(() => {
    const element = root.current
    if (element === null || highlights() === undefined || reducedMotion()) return
    const now = element.textContent.length
    const before = length.current
    length.current = now
    if (!active || before === undefined || now <= before) return
    const range = tailRange(element, now - before)
    if (range === undefined) return
    fresh.push({ range, born: performance.now() })
    if (fadeFrame === 0) fadeFrame = requestAnimationFrame(paintFades)
  })
}
