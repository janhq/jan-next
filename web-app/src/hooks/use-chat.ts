import {
  DshChatTransport,
  type ContinuationContent,
} from '@/lib/dsh-chat-transport'
import {
  Chat,
  type UIMessage,
  type UseChatOptions,
  useChat as useChatSDK,
} from '@ai-sdk/react'
import { type ChatInit, type LanguageModelUsage } from 'ai'
import { useEffect, useMemo, useRef, useCallback } from 'react'
import { useChatSessions } from '@/stores/chat-session-store'

type CustomChatOptions = Omit<ChatInit<UIMessage>, 'transport'> &
  Pick<UseChatOptions<UIMessage>, 'experimental_throttle' | 'resume'> & {
    sessionId?: string
    sessionTitle?: string
    systemMessage?: string
    onTokenUsage?: (usage: LanguageModelUsage, messageId: string) => void
  }

/** The AI SDK chat hook on a per-thread DeepSeek Harness transport. */
export function useChat(options?: CustomChatOptions) {
  const transportRef = useRef<DshChatTransport | undefined>(undefined)
  // The session transportRef belongs to. The hook outlives a session switch (the
  // thread route is reused), and a turn left running in the background keeps
  // using its own transport, so a session must never inherit another's.
  const transportSessionRef = useRef<string | undefined>(undefined)
  const {
    sessionId,
    sessionTitle,
    systemMessage,
    onTokenUsage,
    ...chatInitOptions
  } = options ?? {}
  const ensureSession = useChatSessions((state) => state.ensureSession)
  const setSessionTitle = useChatSessions((state) => state.setSessionTitle)
  const updateStatus = useChatSessions((state) => state.updateStatus)

  const existingSessionTransport = sessionId
    ? useChatSessions.getState().sessions[sessionId]?.transport
    : undefined

  if (existingSessionTransport) {
    transportRef.current = existingSessionTransport
  } else if (
    !transportRef.current ||
    transportSessionRef.current !== sessionId
  ) {
    transportRef.current = new DshChatTransport(systemMessage, sessionId)
  }
  transportSessionRef.current = sessionId
  const transport = transportRef.current

  // Keyed by transport too, so a session switch hands the instructions and
  // callback to the new session's transport.
  useEffect(() => {
    transport.updateSystemMessage(systemMessage)
  }, [transport, systemMessage])

  useEffect(() => {
    transport.setOnTokenUsage(onTokenUsage)
  }, [transport, onTokenUsage])

  // Memoize to prevent calling ensureSession (which has side effects) on every render
  const chat = useMemo(() => {
    if (!sessionId || !transportRef.current) return undefined

    return ensureSession(
      sessionId,
      transportRef.current,
      () => new Chat({ ...chatInitOptions, transport: transportRef.current }),
      sessionTitle
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, ensureSession])

  useEffect(() => {
    if (sessionId && sessionTitle) {
      setSessionTitle(sessionId, sessionTitle)
    }
  }, [sessionId, sessionTitle, setSessionTitle])

  const chatResult = useChatSDK({
    ...(chat
      ? { chat }
      : { transport: transportRef.current, ...chatInitOptions }),
    experimental_throttle: options?.experimental_throttle,
    resume: false,
  })

  useEffect(() => {
    if (sessionId) {
      updateStatus(sessionId, chatResult.status)
    }
  }, [sessionId, chatResult.status, updateStatus])

  const setContinueFromContent = useCallback(
    (content: string | ContinuationContent) => {
      transportRef.current?.setContinueFromContent(content)
    },
    []
  )

  return {
    ...chatResult,
    setContinueFromContent,
  }
}
