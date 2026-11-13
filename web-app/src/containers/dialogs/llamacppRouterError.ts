import { useAppState } from '@/hooks/useAppState'
import { useMessages } from '@/hooks/useMessages'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useChatSessions } from '@/stores/chat-session-store'

type Sessions = ReturnType<typeof useChatSessions.getState>['sessions']

/** Threads with a chat turn streaming. */
function streamingThreads(sessions: Sessions): string[] {
  return Object.entries(sessions)
    .filter(([, s]) => s.isStreaming)
    .map(([id]) => id)
}

/**
 * Whether the app has engine work in flight, independent of which provider is
 * selected: a model loading or a chat turn streaming. Separate from
 * [`hasActiveLlamacppRequest`] so the provider settings page, which already
 * knows it is on llama.cpp, can re-render when the answer changes.
 */
export function isEngineWorkInFlight(
  loadingModels: Record<string, boolean>,
  sessions: Sessions
): boolean {
  return (
    Object.keys(loadingModels).length > 0 ||
    streamingThreads(sessions).length > 0
  )
}

// Router errors are only user-facing when they could have killed an in-flight
// llamacpp generation. At launch/idle the router can emit startup noise with no
// active request; surfacing it would banner a provider the user never invoked.
export function hasActiveLlamacppRequest(): boolean {
  if (useModelProvider.getState().selectedProvider !== 'llamacpp') return false
  return isEngineWorkInFlight(
    useAppState.getState().loadingModels,
    useChatSessions.getState().sessions
  )
}

/** Stamps the error on the last user message of every streaming thread. */
export function stampErrorOnLastUserMessage(
  field: 'oomError' | 'backendError',
  value: string
) {
  for (const threadId of streamingThreads(useChatSessions.getState().sessions)) {
    const messages = useMessages.getState().getMessages(threadId)
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (m.role !== 'user') continue
      const meta = (m.metadata as Record<string, unknown> | undefined) ?? {}
      if (meta[field] === value) break
      useMessages.getState().updateMessage({
        ...m,
        metadata: { ...meta, [field]: value },
      })
      break
    }
  }
}

/** Stops every streaming turn and clears model-load state. */
export function clearActiveWork() {
  const app = useAppState.getState()
  const sessions = useChatSessions.getState().sessions
  for (const id of streamingThreads(sessions)) {
    try {
      sessions[id].chat.stop()
    } catch (e) {
      console.warn('router error: stopping a chat threw:', e)
    }
  }
  Object.keys(app.loadingModels).forEach((id) => app.clearThreadState(id))
  app.updateLoadingModel(false)
}
