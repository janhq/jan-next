/**
 * A thread's working setup, kept in its metadata: the folder its tools run in,
 * whether changes there ask first, and whether it plans before acting. DSH
 * gets all three with each prompt, so a restarted runtime picks them up.
 */
import { useThreads } from '@/hooks/useThreads'
import { useDshSettings } from '@/hooks/useDshSettings'
import { getServiceHub } from '@/hooks/useServiceHub'

/** `ask`: write, edit and bash wait for approval. `auto`: they run. */
export type EditPolicy = 'ask' | 'auto'

export type ThreadWork = {
  /** An attached folder; absent means the thread's private workspace. */
  folder?: string
  editPolicy?: EditPolicy
  planMode?: boolean
}

export function threadWorkOf(thread: Thread | undefined): ThreadWork {
  const meta = (thread?.metadata ?? {}) as Record<string, unknown>
  const folder = typeof meta.folder === 'string' && meta.folder ? meta.folder : undefined
  const editPolicy =
    meta.editPolicy === 'ask' || meta.editPolicy === 'auto' ? meta.editPolicy : undefined
  return { folder, editPolicy, planMode: meta.planMode === true }
}

/**
 * The policy in effect: the thread's own choice, else `auto` in its private
 * workspace (nothing there is the user's) and `ask` in a folder they attached.
 */
export function effectivePolicy(work: ThreadWork, defaultFolder: string): EditPolicy {
  return work.editPolicy ?? (work.folder || defaultFolder ? 'ask' : 'auto')
}

/**
 * Writes the setup without touching `updated`: switching a chip is not
 * activity, and must not move the thread to the top of the list.
 */
export function setThreadWork(threadId: string, patch: ThreadWork) {
  const state = useThreads.getState()
  const thread = state.threads[threadId]
  if (!thread) return
  const metadata = { ...(thread.metadata ?? {}) } as Record<string, unknown>
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete metadata[key]
    else metadata[key] = value
  }
  const next = { ...thread, metadata }
  useThreads.setState({ threads: { ...state.threads, [threadId]: next } })
  void getServiceHub().threads().updateThread(next)
}

/** The folder the thread's tools run in, created when it is the private one. */
export async function resolveThreadFolder(threadId: string, work: ThreadWork): Promise<string> {
  if (work.folder) return work.folder
  const fallback = useDshSettings.getState().workspace.trim()
  if (fallback) return fallback
  return getServiceHub().dsh().threadWorkspace(threadId)
}
