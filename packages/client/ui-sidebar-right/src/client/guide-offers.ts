/** The guide entries one chat offers: every entry without `offeredIn`, and those whose answer for that chat is true. */
import type { ObservableSnapshot } from '@janhq/jan-client-store'
import type { SessionId } from '@janhq/jan-session/types'
import type { SidebarRightGuideBox } from './tab-registry.ts'

/** The answer for a chat that has no Session yet. */
const NOT_OFFERED: ObservableSnapshot<boolean> = { getSnapshot: () => false, subscribe: () => () => {} }

/**
 * Filter the registry's guide entries for one chat.
 *
 * Each entry's `offeredIn` is asked once per registration, so a type answers from one source for
 * the chat's lifetime; a re-registered type is asked again. The returned list keeps its reference
 * until the registry or an answer changes.
 * @param source - the registry's entries, in `order`.
 * @param sessionId - the chat, or undefined for a blank chat, which offers no conditional entry.
 * @returns the offered entries, in `order`.
 */
export function offeredGuideEntries(
  source: ObservableSnapshot<readonly SidebarRightGuideBox[]>,
  sessionId: SessionId | undefined,
): ObservableSnapshot<readonly SidebarRightGuideBox[]> {
  const answers = new WeakMap<NonNullable<SidebarRightGuideBox['offeredIn']>, ObservableSnapshot<boolean>>()
  const answerOf = (entry: SidebarRightGuideBox): ObservableSnapshot<boolean> | undefined => {
    const ask = entry.offeredIn
    if (ask === undefined) return undefined
    if (sessionId === undefined) return NOT_OFFERED
    let answer = answers.get(ask)
    if (answer === undefined) {
      answer = ask(sessionId)
      answers.set(ask, answer)
    }
    return answer
  }
  let from: readonly SidebarRightGuideBox[] | undefined
  let mask = ''
  let offered: readonly SidebarRightGuideBox[] = []
  return {
    getSnapshot: () => {
      const entries = source.getSnapshot()
      const next = entries.map(entry => answerOf(entry)?.getSnapshot() === false ? '0' : '1').join('')
      if (entries !== from || next !== mask) {
        from = entries
        mask = next
        offered = next.includes('0') ? entries.filter((_, index) => next[index] === '1') : entries
      }
      return offered
    },
    subscribe: (listener) => {
      let answering: (() => void)[] = []
      const follow = (): void => {
        for (const stop of answering) stop()
        answering = source.getSnapshot().flatMap((entry) => {
          const answer = answerOf(entry)
          return answer === undefined ? [] : [answer.subscribe(listener)]
        })
      }
      follow()
      const stopSource = source.subscribe(() => {
        follow()
        listener()
      })
      return () => {
        stopSource()
        for (const stop of answering) stop()
        answering = []
      }
    },
  }
}
