/**
 * Questions and approvals DSH is waiting on, keyed by the thread they belong
 * to. They are live only while the runtime waits: a stopped turn or a runtime
 * exit withdraws them, so nothing here is persisted.
 */
import { create } from 'zustand'

export type AskOption = { label: string; description?: string }
export type AskQuestion = {
  id: string
  question: string
  detail?: string
  header?: string
  options?: AskOption[]
  multiSelect?: boolean
  /** `plan-review`: `detail` is the plan, `approve` the label that accepts it. */
  intent?: { kind: 'plan-review'; approve: string }
}
export type AskAnswer = { id: string; selected: string[]; custom?: string }

export type DshInteraction =
  | { kind: 'question'; requestId: string; questions: AskQuestion[] }
  | {
    kind: 'approval'
    requestId: string
    toolName: string
    callId?: string
    reason?: string
  }

type State = {
  byThread: Record<string, DshInteraction[]>
  add: (threadId: string, item: DshInteraction) => void
  remove: (requestId: string) => void
  clearThread: (threadId: string) => void
  clearAll: () => void
}

export const useDshInteractions = create<State>()((set) => ({
  byThread: {},
  add: (threadId, item) =>
    set((s) => ({
      byThread: {
        ...s.byThread,
        [threadId]: [...(s.byThread[threadId] ?? []), item],
      },
    })),
  remove: (requestId) =>
    set((s) => {
      const byThread: Record<string, DshInteraction[]> = {}
      for (const [id, items] of Object.entries(s.byThread)) {
        const kept = items.filter((i) => i.requestId !== requestId)
        if (kept.length) byThread[id] = kept
      }
      return { byThread }
    }),
  clearThread: (threadId) =>
    set((s) => {
      const byThread = { ...s.byThread }
      delete byThread[threadId]
      return { byThread }
    }),
  clearAll: () => set({ byThread: {} }),
}))

const EMPTY: DshInteraction[] = []
export const useThreadInteractions = (threadId: string | undefined) =>
  useDshInteractions((s) => (threadId ? (s.byThread[threadId] ?? EMPTY) : EMPTY))
