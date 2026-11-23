/**
 * Per-word reveal for streamed Markdown: each word fades in from a slight blur as it first appears.
 * Words are keyed by their offset in the source, and a reply's {@link StreamReveal} remembers when
 * each offset was first shown, so a word that remounts (its block freezing, the renderer
 * restarting) resumes its fade instead of replaying it.
 */
import { useLayoutEffect, useRef, type ReactNode } from 'react'

/** Birth times of a streamed reply's words, by source offset. */
export interface StreamReveal {
  /**
   * When the word at `at` was first shown, recording now if it is new.
   * @param at - The word's offset in the full source text.
   * @returns A `performance.now()` timestamp.
   */
  born(at: number): number
}

/** How long one word takes to fade in, in milliseconds. */
export const REVEAL_MS = 450

/** A fresh reveal for one reply. Keep one per reply so remounts keep their birth times. */
export function createStreamReveal(): StreamReveal {
  const births = new Map<number, number>()
  return {
    born(at) {
      let born = births.get(at)
      if (born === undefined) {
        born = performance.now()
        births.set(at, born)
      }
      return born
    },
  }
}

const KEYFRAMES: Keyframe[] = [{ opacity: 0, filter: 'blur(4px)' }, { opacity: 1, filter: 'blur(0px)' }]
const TIMING: KeyframeAnimationOptions = { duration: REVEAL_MS, easing: 'cubic-bezier(.2,.6,.2,1)', fill: 'backwards' }
const reducedMotion = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** One streamed word. It animates once per mount, from where its fade had reached, so re-renders never replay it. */
function RevealWord({ at, reveal, children }: {
  readonly at: number
  readonly reveal: StreamReveal
  readonly children: string
}): ReactNode {
  const ref = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    const age = performance.now() - reveal.born(at)
    const element = ref.current
    if (element === null || age >= REVEAL_MS || typeof element.animate !== 'function' || reducedMotion()) return undefined
    const animation = element.animate(KEYFRAMES, TIMING)
    animation.currentTime = Math.max(0, age)
    return () => { animation.cancel() }
  }, [at, reveal])
  return <span ref={ref} data-reveal="">{children}</span>
}

/**
 * Split a text node's value into whitespace and revealing words.
 * @param value - The text node's value.
 * @param offset - The value's offset in the full source text.
 * @param reveal - The reply's reveal.
 * @returns Plain whitespace strings and one revealing span per word.
 */
export function revealWords(value: string, offset: number, reveal: StreamReveal): ReactNode[] {
  const parts: ReactNode[] = []
  let index = 0
  for (const token of value.split(/(\s+)/u)) {
    if (token !== '') {
      if (/^\s+$/u.test(token)) parts.push(token)
      else parts.push(<RevealWord key={offset + index} at={offset + index} reveal={reveal}>{token}</RevealWord>)
    }
    index += token.length
  }
  return parts
}
