/**
 * Session-scoped draft state for the generic question composer. The Slot
 * registry owns store instances; this module exports only the factory so a
 * plugin reload cannot reuse a module-global handle.
 */
import { defineStore, type EngineStoreHandle } from '@janhq/jan-client-store'
import type { SessionId } from '@janhq/jan-session/types'
import type { AskUserQuestionItem } from '@janhq/jan-user-questions/types'
import { recommendedOptions } from './question-answers.ts'

const DRAFT_STORAGE_KEY = 'jan.user-questions.drafts.v1'

/** One in-progress answer, including an explicit skip. */
export interface QuestionDraftAnswer {
  /** Offered labels currently selected. */
  selected: string[]
  /** Human-authored alternative or additional answer. */
  custom: string
  /** Whether the user explicitly skipped this question. */
  skipped: boolean
}

/** Navigation and answer drafts for one pending request. */
export interface QuestionDraftProgress {
  /** Current question index. */
  index: number
  /** One draft per question, in request order. */
  drafts: QuestionDraftAnswer[]
  /** Local indefinite-wait choice restored with the draft. */
  wait?: 'editing' | 'waiting'
}

interface QuestionDraftState {
  progressByRequest: Record<string, QuestionDraftProgress>
}

type QuestionDraftActions = {
  replace: (draft: QuestionDraftState, requestKey: string, progress: QuestionDraftProgress) => void
  clear: (draft: QuestionDraftState, requestKey: string) => void
  prune: (draft: QuestionDraftState, keep: readonly string[]) => void
}

/** Read progress only when it still describes this question batch. */
export function questionDraftProgress(value: unknown, questionCount: number): QuestionDraftProgress | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const progress = value as Record<string, unknown>
  if (typeof progress.index !== 'number' || !Number.isInteger(progress.index)
    || progress.index < 0 || progress.index >= questionCount
    || !Array.isArray(progress.drafts) || progress.drafts.length !== questionCount
    || (progress.wait !== undefined && progress.wait !== 'editing' && progress.wait !== 'waiting')) return undefined
  return progress.drafts.every((item: unknown) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return false
    const draft = item as Record<string, unknown>
    return Array.isArray(draft.selected) && draft.selected.every((label: unknown) => typeof label === 'string')
      && typeof draft.custom === 'string' && typeof draft.skipped === 'boolean'
  }) ? value as QuestionDraftProgress : undefined
}

/** Honor edits made by older browsers that did not persist a wait disposition. */
export function questionDraftHold(progress: QuestionDraftProgress | undefined, questions: readonly AskUserQuestionItem[]): QuestionDraftProgress['wait'] {
  return progress?.wait ?? (progress?.drafts.some((draft, index) => {
    if (draft.custom !== '' || draft.skipped) return true
    const question = questions[index]
    if (question === undefined) return false
    const defaults = recommendedOptions(question)
    return draft.selected.length !== defaults.length || draft.selected.some((label, i) => label !== defaults[i])
  }) ? 'editing' : undefined)
}

/** Read this browser's saved draft when a timed card has no mounted composer. */
export function persistedQuestionDraft(sessionId: SessionId, key: string, questionCount: number): QuestionDraftProgress | undefined {
  if (typeof localStorage === 'undefined') return undefined
  try {
    const data = localStorage.getItem(`${DRAFT_STORAGE_KEY}.${sessionId}`)
    if (data === null) return undefined
    const snapshot = JSON.parse(data) as { progressByRequest?: Record<string, unknown> } | null
    return questionDraftProgress(snapshot?.progressByRequest?.[key], questionCount)
  } catch {
    // Storage failures affect draft restoration only, as with the store's own persistence.
    return undefined
  }
}

/**
 * Declare the question composer's Session store. Drafts persist per Session so
 * leaving the Session or restarting the Client does not erase an unfinished answer.
 * @returns a persisted store handle whose instance is owned by the Slot registry.
 */
export function createQuestionDraftStore(): EngineStoreHandle<QuestionDraftState, QuestionDraftActions> {
  return defineStore({
    init: (): QuestionDraftState => ({ progressByRequest: {} }),
    persist: DRAFT_STORAGE_KEY,
    actions: {
      replace: (draft, requestKey, progress) => {
        draft.progressByRequest[requestKey] = progress
      },
      clear: (draft, requestKey) => {
        draft.progressByRequest = Object.fromEntries(
          Object.entries(draft.progressByRequest).filter(([key]) => key !== requestKey),
        )
      },
      prune: (draft, keep) => {
        const live = new Set(keep)
        draft.progressByRequest = Object.fromEntries(
          Object.entries(draft.progressByRequest).filter(([key]) => live.has(key)),
        )
      },
    },
  })
}
