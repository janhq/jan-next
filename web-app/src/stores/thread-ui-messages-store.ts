/**
 * The open thread's UI messages, as the chat view renders them (streaming
 * parts included). The thread route publishes them here so the composer's
 * work row and the work panel can follow the agent without owning the chat.
 */
import { create } from 'zustand'
import type { UIMessage } from 'ai'

type State = {
  threadId: string | undefined
  messages: UIMessage[]
  publish: (threadId: string, messages: UIMessage[]) => void
}

export const useThreadUIMessages = create<State>()((set) => ({
  threadId: undefined,
  messages: [],
  publish: (threadId, messages) => set({ threadId, messages }),
}))

const EMPTY: UIMessage[] = []
export const useOpenThreadMessages = (threadId: string | undefined) =>
  useThreadUIMessages((s) => (threadId && s.threadId === threadId ? s.messages : EMPTY))
