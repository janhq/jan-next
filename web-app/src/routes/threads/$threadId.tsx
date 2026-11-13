import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { createFileRoute, useParams, useSearch } from '@tanstack/react-router'
import { cn } from '@/lib/utils'

import HeaderPage from '@/containers/HeaderPage'
import { IconLayoutSidebarRight } from '@tabler/icons-react'
import { WorkPanel } from '@/containers/work/WorkPanel'
import { InteractionCards } from '@/containers/work/InteractionCards'
import { useWorkPanel } from '@/stores/work-panel-store'
import { useThreadUIMessages } from '@/stores/thread-ui-messages-store'
import { useThreads } from '@/hooks/useThreads'
import ChatInput from '@/containers/ChatInput'
import { useShallow } from 'zustand/react/shallow'
import { MessageItem } from '@/containers/MessageItem'

import { useMessages } from '@/hooks/useMessages'
import { useMessageErrors, type LoadReport } from '@/stores/message-errors'
import { buildLoadDiagnosticsReport } from '@/lib/loadDiagnosticsReport'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useAppState } from '@/hooks/useAppState'
import { SESSION_STORAGE_PREFIX } from '@/constants/chat'
import { useChat } from '@/hooks/use-chat'
import { useModelProvider } from '@/hooks/useModelProvider'
import { engineSlotsIdle } from '@janhq/tauri-plugin-llamacpp-api'
import { useInterfaceSettings } from '@/hooks/useInterfaceSettings'
import { renderInstructions } from '@/lib/instructionTemplate'
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation'
import { generateId } from 'ai'
import type { UIMessage } from '@ai-sdk/react'
import { useChatSessions } from '@/stores/chat-session-store'
import {
  convertThreadMessagesToUIMessages,
  extractContentPartsFromUIMessage,
  toolErrorsOf,
  uiMessageHasMeaningfulContent,
  threadMessageIsEmpty,
} from '@/lib/messages'
import { newUserThreadContent } from '@/lib/completion'
import {
  settleStoppedToolCalls,
} from '@/lib/stopped-tool-calls'
import {
  computeActivePath,
  backfillParentIds,
  makeSibling,
  withActiveChild,
  getParentId,
  getSiblings,
  getVersionInfo,
  hasBranching,
  repairDetachedAssistants,
  planContinuation,
} from '@/lib/message-branching'
import { ThreadMessage, MessageStatus, ChatCompletionRole } from '@janhq/core'
import {
  createImageAttachment,
} from '@/types/attachment'
import {
  useChatAttachments,
  NEW_THREAD_ATTACHMENT_KEY,
} from '@/hooks/useChatAttachments'
import { PromptProgress } from '@/components/PromptProgress'
import {
  OUT_OF_CONTEXT_SIZE,
  isContextOverflowMessage,
  isLocalContextOverflowMessage,
  parseContextOverflow,
} from '@/utils/error'
import { useTranslation, i18n } from '@/i18n/react-i18next-compat'
import {
  isContextLimitStop,
  isEmptyReply,
  offersContextIncrease,
} from '@/lib/chatFinish'
import { Button } from '@/components/ui/button'
import { IconAlertCircle, IconRefresh } from '@tabler/icons-react'
import DropdownModelProvider from '@/containers/DropdownModelProvider'
import { Shimmer } from '@/components/ai-elements/shimmer'
import { useMessageQueue } from '@/stores/message-queue-store'
import { generateThreadTitle } from '@/lib/thread-title-summarizer'
import { useAutoScroll } from '@/hooks/useAutoScroll'
import {
  getLocalPropsExtension,
  readCtxLen,
} from '@/lib/llamacppRouterProps'

const CHAT_STATUS = {
  STREAMING: 'streaming',
  SUBMITTED: 'submitted',
} as const

const TITLE_REFRESH_EVERY_N_ASSISTANT_MESSAGES = 4

// What a handler that starts a generation leaves for the onFinish that ends it,
// by thread. A turn can finish in the background while another thread is open
// (#9311), and the route component is reused across thread switches, so with a
// component ref that onFinish would consume what was set up for the open thread:
// link its reply under the other thread's message, or delete a message of the
// other thread as the "stale partial" of a Continue.
//
// The message the next assistant reply hangs off (versioning).
const pendingAssistantParents = new Map<string, string>()
// The stopped assistant message a Continue replaces in place.
const continueReplaceIds = new Map<string, string>()
// The partial output of a reply that stopped at the context limit, for the
// "Increase Context Size" button to resume from.
const pendingContinuations = new Map<
  string,
  { message: UIMessage; content: { text: string; reasoning: string } }
>()
// The n_ctx the thread's local model launched with, read by isContextLimitStop.
const launchedCtxLens = new Map<string, number | undefined>()
// The thread's in-flight title summarization. Only that thread's own activity
// cancels it.
const titleAborts = new Map<string, AbortController>()

// The text and reasoning a reply generated so far: what a resume replays as
// the assistant prefill, so a thinking model keeps its reasoning. Its author
// rides along: the resumed reply replaces this one and keeps rendering
// without remote images if an extension wrote it.
const partialOf = (message: UIMessage) => {
  const collect = (type: 'text' | 'reasoning') =>
    message.parts
      .filter((p) => p.type === type)
      .map((p) => (p as { text: string }).text)
      .join('')
  return {
    text: collect('text'),
    reasoning: collect('reasoning'),
  }
}

const takeFrom = <V,>(map: Map<string, V>, threadId: string) => {
  const value = map.get(threadId)
  map.delete(threadId)
  return value
}
const setOrClear = (
  map: Map<string, string>,
  threadId: string,
  value: string | null
) => {
  if (value == null) map.delete(threadId)
  else map.set(threadId, value)
}
const abortTitle = (threadId: string) => {
  takeFrom(titleAborts, threadId)?.abort()
}
// A deleted thread's hand-offs go with its chat session. Every thread that sets
// one has a session: the route creates it while rendering the thread.
useChatSessions.subscribe((state) => {
  for (const threadId of titleAborts.keys()) {
    if (!state.sessions[threadId]) abortTitle(threadId)
  }
  for (const map of [
    pendingAssistantParents,
    continueReplaceIds,
    pendingContinuations,
    launchedCtxLens,
  ]) {
    for (const threadId of map.keys()) {
      if (!state.sessions[threadId]) map.delete(threadId)
    }
  }
})

// The model a thread's turn runs on. A turn can finish in the background while
// another thread is open, and the global selection follows the open thread.
function turnModelOf(threadId: string) {
  return (
    useChatSessions
      .getState()
      .sessions[threadId]?.transport.getTurnModelSelection() ??
    useModelProvider.getState()
  )
}

// Persist the out-of-context error onto the latest user message so the banner
// survives thread switches, mirroring how LlamacppOomListener stamps oom/backend.
function stampContextErrorOnThread(
  threadId: string,
  message: string = OUT_OF_CONTEXT_SIZE
) {
  const messages = useMessages.getState().getMessages(threadId)
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role !== 'user') continue
    const meta = (m.metadata as Record<string, unknown> | undefined) ?? {}
    if (typeof meta.contextError === 'string') return
    useMessages.getState().updateMessage({
      ...m,
      metadata: { ...meta, contextError: message },
    })
    return
  }
}

type ThreadModel = {
  id: string
  provider: string
}

type SearchParams = {
  threadModel?: ThreadModel
}

// as route.threadsDetail
export const Route = createFileRoute('/threads/$threadId')({
  component: ThreadDetail,
  validateSearch: (search: Record<string, unknown>): SearchParams => {
    return {
      threadModel: search.threadModel as ThreadModel | undefined,
    }
  },
})

function ThreadDetail() {
  const serviceHub = useServiceHub()
  const { threadId } = useParams({ from: Route.id })
  const search = useSearch({ from: Route.id })
  const searchThreadModel = search.threadModel
  const fontSize = useInterfaceSettings((state) => state.fontSize)
  const messageZoom = useInterfaceSettings((state) => state.messageZoom)
  const setCurrentThreadId = useThreads((state) => state.setCurrentThreadId)
  const setMessages = useMessages((state) => state.setMessages)
  const addMessage = useMessages((state) => state.addMessage)
  const updateMessage = useMessages((state) => state.updateMessage)
  const deleteMessage = useMessages((state) => state.deleteMessage)
  const currentThread = useRef<string | undefined>(undefined)

  // Get attachments for this thread
  const attachmentsKey = threadId ?? NEW_THREAD_ATTACHMENT_KEY
  const getAttachments = useChatAttachments((state) => state.getAttachments)
  const clearAttachmentsForThread = useChatAttachments(
    (state) => state.clearAttachments
  )

  // The thread on screen. onFinish is a closure of the render that created its
  // chat, so this is how a turn finishing in the background tells it is not.
  const openThreadIdRef = useRef(threadId)
  openThreadIdRef.current = threadId

  // Subscribe directly to the thread data to ensure updates when model changes
  const thread = useThreads(useShallow((state) => state.threads[threadId]))

  // Get model and provider for useChat
  const selectedModel = useModelProvider((state) => state.selectedModel)
  const selectedProvider = useModelProvider((state) => state.selectedProvider)
  const getProviderByName = useModelProvider((state) => state.getProviderByName)
  const threadRef = useRef(thread)

  // Get system message from thread's assistant instructions (if thread has an assigned assistant)
  // Only use assistant instructions if the thread was created with one (e.g., via a project)
  const threadAssistant = thread?.assistants?.[0]
  const systemMessage = threadAssistant?.instructions
    ? renderInstructions(threadAssistant.instructions)
    : undefined

  useEffect(() => {
    threadRef.current = thread
  }, [thread])

  // Holds the partial assistant message while the model reloads after a
  // context-limit hit, so the user sees it instead of a blank gap. Tagged with
  // its thread: the turn it resumes can finish while another thread is open, so
  // it is shown only in its own thread and cleared by that turn.
  const [pendingContinue, setPendingContinue] = useState<{
    threadId: string
    message: UIMessage
  } | null>(null)
  const pendingContinueMessage =
    pendingContinue && pendingContinue.threadId === threadId
      ? pendingContinue.message
      : null
  const clearPendingContinue = useCallback(
    (ofThread: string) =>
      setPendingContinue((prev) => (prev?.threadId === ofThread ? null : prev)),
    []
  )
  const [contextLimitError, setContextLimitError] = useState<Error | null>(null)
  const { t } = useTranslation()

  // llama-server's overflow string is raw English; localize it, interpolating
  // the parsed request/context token counts when available. Any other wording
  // is a provider's own error (Anthropic, OpenAI), which already says what to
  // cut, so it is shown as is rather than hidden behind the generic text.
  const contextBannerMessage = useMemo(() => {
    const raw = contextLimitError?.message
    if (!raw) return undefined
    const info = parseContextOverflow(raw)
    if (info)
      return t('model-errors:contextOverflowDetail', {
        request: info.requestTokens.toLocaleString(),
        context: info.contextTokens.toLocaleString(),
      })
    if (!isLocalContextOverflowMessage(raw)) return raw
    return t('model-errors:contextOverflowGeneric')
  }, [contextLimitError, t])

  // Refs so onFinish (captured in closure) always calls the latest callbacks
  const oomErrorRaw = useAppState((s) => s.oomError)
  const setOomError = useAppState((s) => s.setOomError)
  const backendErrorRaw = useAppState((s) => s.backendError)
  const setBackendError = useAppState((s) => s.setBackendError)

  // These signals come from the llamacpp router via global Tauri events.
  // Mask them when the active provider isn't llamacpp so a router crash
  // doesn't decorate chats running against OpenAI / Anthropic / etc.
  const isLlamacppActive = selectedProvider === 'llamacpp'
  const oomError = isLlamacppActive ? oomErrorRaw : undefined
  const backendError = isLlamacppActive ? backendErrorRaw : undefined

  const handleContextSizeIncreaseRef = useRef<(() => void) | null>(null)
  const setChatMessagesRef = useRef<
    ((updater: (prev: UIMessage[]) => UIMessage[]) => void) | null
  >(null)
  // The per-turn hand-offs to onFinish (pending parent, Continue target,
  // context-limit partial, launched n_ctx) are module maps keyed by thread; see
  // pendingAssistantParents.

  // Use the AI SDK chat hook
  const {
    messages: chatMessages,
    status,
    error,
    sendMessage,
    regenerate,
    setMessages: setChatMessages,
    stop,
    setContinueFromContent,
  } = useChat({
    sessionId: threadId,
    sessionTitle: thread?.title,
    systemMessage,
    experimental_throttle: 50,
    onFinish: ({ message: finishedMessage, isAbort, isError }) => {
      // A stopped turn can end with a tool call that never got to run; settle
      // it before it is persisted so its card does not read "Running" forever.
      const message = isAbort
        ? settleStoppedToolCalls([finishedMessage])[0]
        : finishedMessage
      // The live copy too, for every aborted turn: one stopped before its tool
      // call had any input has nothing meaningful to persist below, but its
      // card still reads "Running". Only this turn's message: the setter is the
      // open thread's, and a background thread's turn can abort while another
      // thread is in front.
      if (isAbort) {
        setChatMessagesRef.current?.((prev) =>
          prev.map((m) =>
            m.id === finishedMessage.id ? settleStoppedToolCalls([m])[0] : m
          )
        )
      }
      const msgMeta = message.metadata as Record<string, unknown> | undefined
      const finishReason = msgMeta?.finishReason as string | undefined
      // Consume once per generation so a skipped persist (error/empty) can't
      // leak the replace target into a later, unrelated turn.
      const continueReplaceId = takeFrom(continueReplaceIds, threadId) ?? null

      // Context limit hit: send partial content as prefill so the model continues
      // from where it stopped. The stream wrapper injects it as the first text-delta
      // of the new message, so the user sees the partial text immediately.
      if (!isAbort && finishReason === 'length') {
        const providerState = turnModelOf(threadId)
        const isContextLimit = isContextLimitStop({
          provider: providerState.selectedProvider,
          usage: msgMeta?.usage as
            | { inputTokens?: number; outputTokens?: number }
            | undefined,
          ctxLen:
            providerState.selectedModel?.settings?.ctx_len?.controller_props
              ?.value,
          launchedCtxLen: launchedCtxLens.get(threadId),
        })

        if (isContextLimit) {
          // Stash the partial so the manual "Increase Context Size" button can
          // resume from here. Surface the standard banner with the manual
          // button - auto-increase was removed; the user explicitly opts in.
          const content = partialOf(message)
          if (content.text || content.reasoning) {
            pendingContinuations.set(threadId, { message, content })
          }
          // Stamped on the thread's own messages, so a thread that finished in
          // the background shows the banner when the user returns to it.
          stampContextErrorOnThread(threadId)
          if (openThreadIdRef.current === threadId) {
            setContextLimitError(new Error(OUT_OF_CONTEXT_SIZE))
          }
          // Falls through to store the partial as a stopped reply: returning
          // here dropped everything the model had generated.
        }
        // Any other length stop is the output-token cap: the partial is stored
        // as stopped so the "Continue" button can resume it.
      }

      if (!isAbort && message.parts.length) clearPendingContinue(threadId)

      // Nothing would be persisted for an empty reply, so without this the
      // turn silently vanishes and the user cannot tell it failed. The error
      // goes on the user turn it answers (as the stream-error path does):
      // that message is persisted, and the errorEntries effect below copies
      // the error into its metadata.error, which hydration restores on reload.
      if (isEmptyReply({ message, isAbort, isError, finishReason })) {
        const userTurnId =
          takeFrom(pendingAssistantParents, threadId) ??
          resolveAssistantParent(undefined)
        if (userTurnId) {
          useMessageErrors
            .getState()
            .setError(userTurnId, i18n.t('model-errors:emptyReply'))
        }
      }

      // The turn ended before completion (user hit Stop, or the model hit its
      // output-token cap). Persist the partial marked `stopped` so the UI can
      // offer a "Continue" affordance, and stamp the live message so the button
      // appears without waiting for a reload.
      const isStoppedTurn = isAbort || finishReason === 'length'

      // Persist assistant message to backend (skip if aborted).
      // For continuations, message.parts already contains partial + new content
      // because the stream wrapper prepended the partial text as the first delta.
      if (
        message.role === 'assistant' &&
        uiMessageHasMeaningfulContent(message)
      ) {
        const contentParts = extractContentPartsFromUIMessage(message)
        const toolErrors = toolErrorsOf(message)
        const messageMetadata = {
          ...((message.metadata || {}) as Record<string, unknown>),
          ...(isStoppedTurn ? { stopped: true } : {}),
          ...(toolErrors ? { toolErrors } : {}),
        }

        if (isStoppedTurn) {
          setChatMessagesRef.current?.((prev) =>
            prev.map((m) =>
              m.id === message.id
                ? {
                  ...m,
                  metadata: {
                    ...(m.metadata as Record<string, unknown> | undefined),
                    stopped: true,
                  },
                }
                : m
            )
          )
        }

        // A continuation resumes a stopped turn: the stale partial is deleted
        // below so the continued reply takes its place instead of forking a new
        // version. Inherit the partial's parent so the branch link holds.
        const continuation = planContinuation(
          useMessages.getState().getMessages(threadId),
          message.id,
          continueReplaceId,
          takeFrom(pendingAssistantParents, threadId) ?? null
        )

        let parentForAssistant = continuation.parentId

        // Never persist a detached assistant in a branched thread: if the
        // pending link was lost (e.g. a multi-step turn consumed the ref before
        // this reply finished), fall back to the user message this reply
        // answers. A null parentId would make computeActivePath treat the
        // assistant as a phantom root and drop it from the visible path.
        if (
          parentForAssistant == null &&
          hasBranching(useMessages.getState().getMessages(threadId))
        ) {
          parentForAssistant = resolveAssistantParent(undefined)
        }

        const assistantMessage: ThreadMessage = {
          type: 'text',
          role: ChatCompletionRole.Assistant,
          content: contentParts,
          id: message.id,
          object: 'thread.message',
          thread_id: threadId,
          status: MessageStatus.Ready,
          created_at: Date.now(),
          completed_at: Date.now(),
          metadata:
            parentForAssistant != null
              ? { ...messageMetadata, parentId: parentForAssistant }
              : messageMetadata,
        }

        const existingMessages = useMessages.getState().getMessages(threadId)
        const existingMessage = existingMessages.find(
          (m) => m.id === message.id
        )

        if (existingMessage) {
          // Preserve the existing branch link on re-runs of onFinish.
          const existingParent = getParentId(existingMessage)
          updateMessage(
            existingParent != null
              ? {
                ...assistantMessage,
                metadata: {
                  ...assistantMessage.metadata,
                  parentId: existingParent,
                },
              }
              : assistantMessage
          )
        } else {
          addMessage(assistantMessage)
          // New generation becomes the active branch under its parent so
          // version navigation lands on the latest reply by default.
          if (parentForAssistant) {
            const parent = existingMessages.find(
              (m) => m.id === parentForAssistant
            )
            if (parent) updateMessage(withActiveChild(parent, assistantMessage.id))
          }
        }

        // Drop the stale partial so the resumed turn replaces it in place
        // rather than appearing as a separate version of the same reply.
        if (continuation.deletePartialId) {
          deleteMessage(threadId, continuation.deletePartialId)
          useMessageErrors.getState().clearError(continuation.deletePartialId)
        }

        for (const m of existingMessages) {
          const meta = m.metadata as Record<string, unknown> | undefined
          if (meta?.error) {
            const rest = { ...meta }
            delete rest.error
            delete rest.loadReport
            updateMessage({ ...m, metadata: rest })
          }
          useMessageErrors.getState().clearError(m.id)
        }
      }

      if (!isAbort) {
        const localMessages = useMessages.getState().getMessages(threadId)
        const assistantCount = localMessages.filter(
          (m) => m.role === 'assistant'
        ).length
        const isRefreshTick =
          assistantCount === 1 ||
          (assistantCount > 0 &&
            assistantCount % TITLE_REFRESH_EVERY_N_ASSISTANT_MESSAGES === 0)
        const currentThread = useThreads.getState().threads[threadId]
        const autoGenerateTitle =
          useInterfaceSettings.getState().autoGenerateTitle
        if (
          autoGenerateTitle &&
          isRefreshTick &&
          !currentThread?.metadata?.titleSetManually
        ) {
          const TITLE_TRANSCRIPT_MAX_TURNS = 8
          const recent = localMessages.slice(-TITLE_TRANSCRIPT_MAX_TURNS)
          const inputText =
            recent
              .map((m) => {
                const text = m.content
                  ?.map((c) => c?.text?.value ?? '')
                  .join('')
                  .trim()
                if (!text) return ''
                const role = m.role === 'assistant' ? 'Assistant' : 'User'
                return `${role}: ${text}`
              })
              .filter(Boolean)
              .join('\n\n') ||
            useThreads.getState().threads[threadId]?.title
          if (inputText) {
            const turnModel = turnModelOf(threadId)
            const provider = turnModel.selectedProvider
            const modelId = turnModel.selectedModel?.id
              ; (async () => {
                if (provider === 'llamacpp' && modelId) {
                  let idle = false
                  for (let attempt = 0; attempt < 6; attempt++) {
                    try {
                      idle = await engineSlotsIdle(modelId)
                    } catch {
                      idle = true
                      break
                    }
                    if (idle) break
                    await new Promise((r) => setTimeout(r, 150))
                  }
                  if (!idle) return
                }
                // Deleted while waiting for the engine: nothing to name, and the
                // deletion has already cancelled what it could.
                if (!useChatSessions.getState().sessions[threadId]) return
                titleAborts.get(threadId)?.abort()
                const controller = new AbortController()
                titleAborts.set(threadId, controller)
                const title = await generateThreadTitle(
                  inputText,
                  controller.signal,
                  turnModel
                )
                if (titleAborts.get(threadId) === controller) {
                  titleAborts.delete(threadId)
                }
                if (!title || controller.signal.aborted) return
                useThreads.getState().updateThread(threadId, { title })
              })()
          }
        }
      }
    },
  })

  // Our error banners (oom/backend/context) can arrive out-of-band for the
  // router path, leaving the SDK stream stuck at 'submitted' so the
  // "Using tools…" indicator shimmers forever. Force a terminal status when a
  // banner is up — regenerate/reload restarts the turn anyway.
  const hasBannerError = !!(oomError || backendError || contextLimitError)
  const effectiveStatus = hasBannerError ? 'ready' : status

  // Read at send or stop time without making those callbacks depend on every
  // streamed token.
  const chatMessagesRef = useRef(chatMessages)
  chatMessagesRef.current = chatMessages
  // The work row and panel follow the live chat, streaming parts included.
  useEffect(() => {
    useThreadUIMessages.getState().publish(threadId, chatMessages)
  }, [threadId, chatMessages])
  const workPanelOpen = useWorkPanel((s) => s.open)
  const toggleWorkPanel = useWorkPanel((s) => s.toggle)

  // Stop cancels the thread's DSH turn (the transport sends session/cancel);
  // a tool call it cut short is settled so its card stops saying "Running".
  const handleStop = useCallback(() => {
    stop()
    setChatMessages((prev) => settleStoppedToolCalls(prev))
  }, [stop, setChatMessages])

  // Auto-scroll the reasoning container during streaming, pausing when the user scrolls up
  const {
    containerRef: reasoningContainerRef,
    isAtBottom: isReasoningAtBottom,
    handleScroll: handleReasoningScroll,
    scrollToBottom: scrollReasoningToBottom,
    forceScrollToBottom: forceScrollReasoningToBottom,
    reset: resetReasoningScroll,
  } = useAutoScroll()

  const lastIsAssistant = useMemo(() => {
    const last = chatMessages[chatMessages.length - 1]
    return !!last && last.role === 'assistant'
  }, [chatMessages])

  useEffect(() => {
    if (status === 'streaming') {
      resetReasoningScroll()
    }
  }, [status, resetReasoningScroll])

  useEffect(() => {
    if (status !== 'streaming') return
    launchedCtxLens.delete(threadId)
    // The model the streaming turn runs on, which a follow-up keeps even if
    // the selection has changed since the turn started.
    const { selectedModel: turnModel, selectedProvider: turnProvider } =
      turnModelOf(threadId)
    const modelId = turnModel?.id
    const ext = getLocalPropsExtension(turnProvider)
    if (!modelId || !ext?.getModelProps) return
    let cancelled = false
    ext
      .getModelProps(modelId)
      .then((props) => {
        if (!cancelled) launchedCtxLens.set(threadId, readCtxLen(props?.nCtx))
      })
      .catch(() => {
        // Router unreachable: isContextLimitStop falls back to its default.
      })
    return () => {
      cancelled = true
    }
  }, [status, threadId])

  useEffect(() => {
    if (status === 'streaming') {
      scrollReasoningToBottom()
    }
  }, [status, chatMessages, scrollReasoningToBottom])

  useEffect(() => {
    setCurrentThreadId(threadId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId])

  // Load messages on first mount
  useEffect(() => {
    // Skip if chat already has messages (e.g., returning to a streaming conversation)
    const existingSession = useChatSessions.getState().sessions[threadId]
    if (
      existingSession?.chat.messages.length > 0 ||
      existingSession?.isStreaming ||
      currentThread.current === threadId
    ) {
      return
    }

    serviceHub
      .messages()
      .fetchMessages(threadId)
      .then((fetchedMessages) => {
        if (fetchedMessages && fetchedMessages.length > 0) {
          const currentLocalMessages = useMessages
            .getState()
            .getMessages(threadId)

          let messagesToSet = fetchedMessages

          // Merge with local-only messages if needed
          if (currentLocalMessages && currentLocalMessages.length > 0) {
            const fetchedIds = new Set(fetchedMessages.map((m) => m.id))
            const localOnlyMessages = currentLocalMessages.filter(
              (m) => !fetchedIds.has(m.id)
            )

            if (localOnlyMessages.length > 0) {
              messagesToSet = [...fetchedMessages, ...localOnlyMessages].sort(
                (a, b) => (a.created_at || 0) - (b.created_at || 0)
              )
            }
          }

          // Drop and delete any persisted empty assistant rows produced by
          // the old bug where errored generations were written as empty-text
          // messages. Lossless cleanup — these carry no information.
          const emptyAssistantIds = messagesToSet
            .filter(threadMessageIsEmpty)
            .map((m) => m.id)
          if (emptyAssistantIds.length > 0) {
            messagesToSet = messagesToSet.filter(
              (m) => !emptyAssistantIds.includes(m.id)
            )
            for (const id of emptyAssistantIds) {
              deleteMessage(threadId, id)
            }
          }

          // Migrate threads corrupted by the pre-#8357 bug: assistant replies
          // saved with parentId:null are phantom roots that computeActivePath
          // drops. Re-parent them to the user turn they answer and persist.
          const repaired = repairDetachedAssistants(messagesToSet)
          if (repaired.length > 0) {
            const byId = new Map(repaired.map((m) => [m.id, m]))
            messagesToSet = messagesToSet.map((m) => byId.get(m.id) ?? m)
            for (const m of repaired) updateMessage(m)
          }

          setMessages(threadId, messagesToSet)

          const hydrated: Record<string, string> = {}
          const reports: Record<string, LoadReport> = {}
          for (const m of messagesToSet) {
            const meta = m.metadata as Record<string, unknown> | undefined
            const err = meta?.error
            if (typeof err === 'string' && err.length > 0) {
              hydrated[m.id] = err
              const report = meta?.loadReport as LoadReport | undefined
              if (typeof report?.text === 'string') reports[m.id] = report
            }
          }
          useMessageErrors.getState().hydrate(hydrated, reports)

          const activeRootId = (
            useThreads.getState().threads[threadId]?.metadata as
            | Record<string, unknown>
            | undefined
          )?.activeRootId as string | undefined
          const uiMessages = convertThreadMessagesToUIMessages(
            computeActivePath(messagesToSet, activeRootId)
          )
          setChatMessages(uiMessages)
          currentThread.current = threadId
        }
      })
      .catch((error) =>
        console.error('Failed to fetch messages for thread:', threadId, error)
      )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId, serviceHub])

  useEffect(() => {
    // A title being summarized is left to finish: it belongs to its thread,
    // not to the screen, and only writes that thread's title.
    return () => {
      setCurrentThreadId(undefined)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Resync the OOM/backend banner from message metadata on every thread switch.
  // Persisted by LlamacppOomListener at error time; unset state when this
  // thread carries no such metadata so the banner doesn't leak across threads.
  const threadMessagesForBanner = useMessages((s) => s.messages?.[threadId])
  useEffect(() => {
    let oom: string | undefined
    let be: string | undefined
    let ctx: string | undefined
    for (const m of threadMessagesForBanner ?? []) {
      const meta = m.metadata as Record<string, unknown> | undefined
      const o = meta?.oomError
      if (typeof o === 'string' && o.length > 0) oom = o
      const b = meta?.backendError
      if (typeof b === 'string' && b.length > 0) be = b
      const c = meta?.contextError
      if (typeof c === 'string' && c.length > 0) ctx = c
    }
    useAppState.getState().setOomError(oom)
    useAppState.getState().setBackendError(be)
    setContextLimitError(ctx ? new Error(ctx) : null)
  }, [threadId, threadMessagesForBanner])

  // Consolidated function to process and send a message. DSH takes text and
  // images; the composer only offers images (see ChatInput).
  const processAndSendMessage = useCallback(
    async (
      text: string,
      files?: Array<{ type: string; mediaType: string; url: string }>
    ) => {
      // Cancel any in-flight title summarization so it doesn't compete with this request
      abortTitle(threadId)

      // In-thread sends pass images inline via `files`; new-thread sends pass
      // them through the attachments store.
      const fileImages = (files ?? []).map((file) => {
        const base64 = file.url.split(',')[1] || ''
        return createImageAttachment({
          name: `image-${Date.now()}`,
          mimeType: file.mediaType,
          dataUrl: file.url,
          base64,
          size: Math.ceil((base64.length * 3) / 4),
        })
      })
      const images = fileImages.length
        ? fileImages
        : getAttachments(attachmentsKey).filter((a) => a.type === 'image')
      clearAttachmentsForThread(attachmentsKey)

      const messageId = generateId()
      const baseUserMessage = newUserThreadContent(
        threadId,
        text,
        images,
        messageId
      )
      // Once a thread has branches, link new turns into the active path so the
      // assistant reply attaches to this message. Legacy threads stay linear.
      const branchedMessages = useMessages.getState().getMessages(threadId)
      let userMessage = baseUserMessage
      if (hasBranching(branchedMessages)) {
        const activeRootId = (
          useThreads.getState().threads[threadId]?.metadata as
          | Record<string, unknown>
          | undefined
        )?.activeRootId as string | undefined
        const path = computeActivePath(branchedMessages, activeRootId)
        const parentId = path.length ? path[path.length - 1].id : null
        userMessage = {
          ...baseUserMessage,
          metadata: { ...(baseUserMessage.metadata ?? {}), parentId },
        }
        pendingAssistantParents.set(threadId, messageId)
      }
      addMessage(userMessage)

      const parts: Array<
        | { type: 'text'; text: string }
        | { type: 'file'; mediaType: string; url: string }
      > = [{ type: 'text', text: userMessage.content[0].text?.value ?? text }]
      for (const a of images) {
        if (a.dataUrl && a.mimeType) {
          parts.push({ type: 'file', mediaType: a.mimeType, url: a.dataUrl })
        }
      }

      sendMessage({
        parts,
        id: messageId,
        metadata: { ...userMessage.metadata, createdAt: new Date() },
      })
    },
    [
      sendMessage,
      threadId,
      addMessage,
      getAttachments,
      attachmentsKey,
      clearAttachmentsForThread,
    ]
  )

  // Sends a text-only queued message, bypassing attachment processing entirely.
  // This prevents stale or new attachments from leaking into auto-sent queue items.
  const sendQueuedMessage = useCallback(
    async (text: string) => {
      const messageId = generateId()
      const userMessage = newUserThreadContent(threadId, text, [], messageId)
      addMessage(userMessage)

      sendMessage({
        parts: [{ type: 'text', text }],
        id: messageId,
        metadata: userMessage.metadata,
      })
    },
    [sendMessage, threadId, addMessage]
  )

  // Check for and send initial message from sessionStorage
  const initialMessageSentRef = useRef(false)

  useEffect(() => {
    // Prevent duplicate sends
    if (initialMessageSentRef.current) return

    const initialMessageKey = `${SESSION_STORAGE_PREFIX.INITIAL_MESSAGE}${threadId}`

    const storedMessage = sessionStorage.getItem(initialMessageKey)

    if (storedMessage) {
      // Mark as sent immediately to prevent duplicate sends
      sessionStorage.removeItem(initialMessageKey)
      initialMessageSentRef.current = true

        // Process message asynchronously
        ; (async () => {
          try {
            const message = JSON.parse(storedMessage) as {
              text: string
              files?: Array<{ type: string; mediaType: string; url: string }>
            }

            await processAndSendMessage(message.text, message.files)
          } catch (error) {
            console.error('Failed to parse initial message:', error)
          }
        })()
    }
  }, [threadId, processAndSendMessage])

  const stripBannerMetadata = useCallback(() => {
    const tmsgs = useMessages.getState().getMessages(threadId)
    for (const m of tmsgs) {
      const meta = m.metadata as Record<string, unknown> | undefined
      if (!meta) continue
      if (
        meta.oomError == null &&
        meta.backendError == null &&
        meta.contextError == null
      )
        continue
      const nextMeta = { ...meta }
      delete nextMeta.oomError
      delete nextMeta.backendError
      delete nextMeta.contextError
      updateMessage({ ...m, metadata: nextMeta })
    }
  }, [threadId, updateMessage])

  // Dismiss any active thread-level banner error and strip its persisted
  // metadata. The banner stands in for a failed last assistant turn (hidden by
  // the render filter), so leaving it set would blank a healthy assistant on
  // whatever branch we navigate to next.
  const clearBannerErrors = useCallback(() => {
    if (oomError) setOomError(undefined)
    if (backendError) setBackendError(undefined)
    if (contextLimitError) setContextLimitError(null)
    if (oomError || backendError || contextLimitError) stripBannerMetadata()
  }, [
    oomError,
    setOomError,
    backendError,
    setBackendError,
    contextLimitError,
    stripBannerMetadata,
  ])

  // Handle submit from ChatInput
  const handleSubmit = useCallback(
    async (
      text: string,
      files?: Array<{ type: string; mediaType: string; url: string }>
    ) => {
      clearBannerErrors()
      await processAndSendMessage(text, files)
    },
    [processAndSendMessage, clearBannerErrors]
  )

  // Versioning helpers --------------------------------------------------------

  // Assign parentId along the current linear path the first time a thread forks,
  // so siblings and subtrees are well-defined. Idempotent. Returns the store.
  const ensureBranched = useCallback(() => {
    const msgs = useMessages.getState().getMessages(threadId)
    if (hasBranching(msgs)) return msgs
    const filled = backfillParentIds(msgs)
    filled.forEach((m) => updateMessage(m))
    return useMessages.getState().getMessages(threadId)
  }, [threadId, updateMessage])

  // Make `node` the active branch under its parent (or active root).
  const setActiveBranch = useCallback(
    (node: ThreadMessage) => {
      const parentId = getParentId(node)
      if (!parentId) {
        const t = useThreads.getState().threads[threadId]
        useThreads.getState().updateThread(threadId, {
          metadata: {
            ...((t?.metadata as Record<string, unknown> | undefined) ?? {}),
            activeRootId: node.id,
          },
        })
        return
      }
      const parent = useMessages
        .getState()
        .getMessages(threadId)
        .find((m) => m.id === parentId)
      if (parent) updateMessage(withActiveChild(parent, node.id))
    },
    [threadId, updateMessage]
  )

  // Rebuild the rendered conversation from the active path in the store.
  const syncActivePath = useCallback(() => {
    const msgs = useMessages.getState().getMessages(threadId)
    const activeRootId = (
      useThreads.getState().threads[threadId]?.metadata as
      | Record<string, unknown>
      | undefined
    )?.activeRootId as string | undefined
    setChatMessages(
      convertThreadMessagesToUIMessages(computeActivePath(msgs, activeRootId))
    )
  }, [threadId, setChatMessages])

  // Switch the visible version of a message (the `< n/m >` control).
  const handleSwitchVersion = useCallback(
    (messageId: string, dir: -1 | 1) => {
      const msgs = useMessages.getState().getMessages(threadId)
      const target = msgs.find((m) => m.id === messageId)
      if (!target) return
      const siblings = getSiblings(msgs, target)
      const idx = siblings.findIndex((m) => m.id === messageId)
      const next = siblings[idx + dir]
      if (!next) return
      abortTitle(threadId)
      clearBannerErrors()
      setActiveBranch(next)
      syncActivePath()
    },
    [threadId, setActiveBranch, syncActivePath, clearBannerErrors]
  )

  // Resolve the user message that an assistant reply hangs off of.
  const resolveAssistantParent = useCallback(
    (messageId: string | undefined): string | null => {
      const msgs = useMessages.getState().getMessages(threadId)
      const activeRootId = (
        useThreads.getState().threads[threadId]?.metadata as
        | Record<string, unknown>
        | undefined
      )?.activeRootId as string | undefined
      const path = computeActivePath(msgs, activeRootId)
      const idx =
        messageId == null
          ? path.length - 1
          : path.findIndex((m) => m.id === messageId)
      if (idx === -1) return null
      const sel = path[idx]
      if (sel.role === 'user') return sel.id
      for (let i = idx; i >= 0; i--) {
        if (path[i].role === 'user') return path[i].id
      }
      return null
    },
    [threadId]
  )

  // Regenerate keeps the previous reply as a prior version (no deletion); the
  // new reply arrives in onFinish as a sibling and becomes the active branch.
  const handleRegenerate = useCallback(
    (messageId?: string) => {
      const hadBannerError =
        useAppState.getState().oomError != null ||
        useAppState.getState().backendError != null ||
        contextLimitError != null
      if (useAppState.getState().oomError) {
        useAppState.getState().setOomError(undefined)
      }
      if (useAppState.getState().backendError) {
        useAppState.getState().setBackendError(undefined)
      }
      if (contextLimitError) setContextLimitError(null)
      if (hadBannerError) stripBannerMetadata()
      abortTitle(threadId)

      ensureBranched()
      setOrClear(
        pendingAssistantParents,
        threadId,
        resolveAssistantParent(messageId)
      )

      regenerate(messageId ? { messageId } : undefined)
    },
    [
      regenerate,
      stripBannerMetadata,
      contextLimitError,
      ensureBranched,
      resolveAssistantParent,
      threadId,
    ]
  )

  // Resume a turn that was stopped before it finished: replay the partial text
  // as an assistant prefill so the model continues from where it left off. The
  // transport re-emits the partial as the first delta, so the regenerated
  // message reconstitutes partial + new content and the KV cache is reused.
  const handleContinue = useCallback(
    (messageId: string) => {
      const msg = chatMessages.find((m) => m.id === messageId)
      if (!msg) return
      const partial = partialOf(msg)
      if (!partial.text && !partial.reasoning) return
      setContinueFromContent(partial)
      continueReplaceIds.set(threadId, messageId)
      handleRegenerate(messageId)
    },
    [chatMessages, setContinueFromContent, handleRegenerate, threadId]
  )

  // Editing forks a new sibling version (the original + its subtree are kept).
  // User edits regenerate a reply for the new branch; assistant edits don't.
  const handleEditMessage = useCallback(
    (messageId: string, newText: string) => {
      const msgs = ensureBranched()
      const target = msgs.find((m) => m.id === messageId)
      if (!target) return

      useMessageErrors.getState().clearError(messageId)
      abortTitle(threadId)

      const newId = generateId()
      const sibling = makeSibling(target, {
        id: newId,
        createdAt: Date.now(),
        text: newText,
      })
      addMessage(sibling)
      setActiveBranch(sibling)

      if (target.role === 'user') {
        pendingAssistantParents.set(threadId, newId)
        syncActivePath()
        regenerate({ messageId: newId })
      } else {
        syncActivePath()
      }
    },
    [
      ensureBranched,
      addMessage,
      setActiveBranch,
      syncActivePath,
      regenerate,
      threadId,
    ]
  )

  // Handle delete message
  const handleDeleteMessage = useCallback(
    (messageId: string) => {
      deleteMessage(threadId, messageId)
      useMessageErrors.getState().clearError(messageId)

      // Update chat messages for UI
      const updatedChatMessages = chatMessages.filter(
        (msg) => msg.id !== messageId
      )
      setChatMessages(updatedChatMessages)
    },
    [threadId, deleteMessage, chatMessages, setChatMessages]
  )

  // Handler for increasing context size
  const handleContextSizeIncrease = useCallback(async () => {
    if (!selectedModel) return

    // The reply this click resumes if the turn that stopped is not in
    // pendingContinuations (a restart empties it): the stored partial, marked
    // `stopped`, that hydration restored. Read before the awaits below, while
    // the open thread is still this one.
    const lastMessage = chatMessagesRef.current.at(-1)
    const stoppedPartial =
      lastMessage?.role === 'assistant' &&
        (lastMessage.metadata as { stopped?: boolean } | undefined)?.stopped
        ? { message: lastMessage, content: partialOf(lastMessage) }
        : undefined
    const storedPartial =
      stoppedPartial?.content.text || stoppedPartial?.content.reasoning
        ? stoppedPartial
        : undefined

    const updateProvider = useModelProvider.getState().updateProvider
    const provider = getProviderByName(selectedProvider)
    if (!provider) return

    const modelIndex = provider.models.findIndex(
      (m) => m.id === selectedModel.id
    )
    if (modelIndex === -1) return

    const model = provider.models[modelIndex]

    // Increase context length in steps: <8192 -> 8192 -> 32768 -> x1.5
    // An empty ctx_len is left to fit, so the window to grow from is the one
    // the model launched with, not a guess that could be below it.
    const currentCtxLen =
      readCtxLen(model.settings?.ctx_len?.controller_props?.value) ??
      launchedCtxLens.get(threadId) ??
      8192
    const maxCtxLen =
      (model.settings?.ctx_len?.controller_props?.max as number) || 131072

    let newCtxLen: number
    if (currentCtxLen < 8192) {
      newCtxLen = 8192
    } else if (currentCtxLen < 32768) {
      newCtxLen = 32768
    } else {
      newCtxLen = Math.round(currentCtxLen * 1.5)
    }

    newCtxLen = Math.min(newCtxLen, maxCtxLen)
    if (newCtxLen <= currentCtxLen) {
      stampContextErrorOnThread(threadId)
      setContextLimitError(new Error(OUT_OF_CONTEXT_SIZE))
      return
    }

    const updatedModel = {
      ...model,
      settings: {
        ...model.settings,
        ctx_len: {
          ...(model.settings?.ctx_len ?? {}),
          controller_props: {
            ...(model.settings?.ctx_len?.controller_props ?? {}),
            value: newCtxLen,
          },
        },
      },
    }

    const updatedModels = [...provider.models]
    updatedModels[modelIndex] = updatedModel as Model

    updateProvider(provider.provider, {
      models: updatedModels,
    })

    // For llamacpp the router reads ctx-size from the preset, not from any
    // request param — so we must write model.yml and bounce the router before
    // the regenerate, otherwise the next load picks up the OLD context size.
    // Other providers consume the new Zustand value directly on next load.
    if (provider.provider === 'llamacpp') {
      try {
        await serviceHub
          .models()
          .updateModelSettings(selectedModel.id, { ctx_len: newCtxLen })
      } catch (e) {
        updateProvider(provider.provider, {
          models: provider.models,
        })
        console.error('Failed to persist increased ctx_len', e)
        stampContextErrorOnThread(threadId)
        setContextLimitError(new Error(OUT_OF_CONTEXT_SIZE))
        return
      }
    } else {
      await serviceHub.models().stopModel(selectedModel.id)
    }

    // Resume from the partial the reply stopped at: the one captured at the
    // `finishReason === 'length'` event, or, when none was (the Map is empty
    // after an application restart), the stored reply read above. The
    // regenerate then continues it, and the "Growing the Mind…" shimmer renders
    // while the model reloads.
    // The prefill goes on this thread's own transport: the user may have
    // opened another thread while the model reloaded.
    const pending =
      takeFrom(pendingContinuations, threadId) ?? storedPartial
    if (pending) {
      useChatSessions
        .getState()
        .sessions[threadId]?.transport.setContinueFromContent(pending.content)
      setPendingContinue({ threadId, message: pending.message })
      // The partial is stored (see onFinish), so the resumed reply replaces it
      // in place rather than forking a second version of the same answer.
      continueReplaceIds.set(threadId, pending.message.id)
    }

    setTimeout(() => {
      handleRegenerate(pending?.message.id)
    }, 1000)
  }, [
    selectedModel,
    selectedProvider,
    getProviderByName,
    serviceHub,
    handleRegenerate,
    threadId,
  ])

  // Keep refs in sync so onFinish always calls the latest versions
  handleContextSizeIncreaseRef.current = handleContextSizeIncrease
  setChatMessagesRef.current = setChatMessages

  useEffect(() => {
    if (
      (oomError || backendError || contextLimitError) &&
      (status === 'streaming' || status === 'submitted')
    ) {
      try {
        stop()
      } catch (e) {
        console.warn('router error stop() threw:', e)
      }
    }
  }, [oomError, backendError, contextLimitError, status, stop])

  useEffect(() => {
    if (status === 'streaming') {
      // The new turn is now flowing; drop the saved partial so it can't be
      // consumed by a later, unrelated "Increase Context Size" click.
      pendingContinuations.delete(threadId)
    }
    if (status === 'error') clearPendingContinue(threadId)
  }, [status]) // eslint-disable-line react-hooks/exhaustive-deps

  // Message queue: auto-send the next queued message when the stream finishes.
  // No reactive subscription to the queue here — ChatInput owns the UI.
  // We only read the store imperatively when status transitions to 'ready'.
  const processingQueueRef = useRef(false)

  useEffect(() => {
    if (status !== 'ready' || processingQueueRef.current) return

    const next = useMessageQueue.getState().dequeue(threadId)
    if (!next) return

    processingQueueRef.current = true
    sendQueuedMessage(next.text)
      .catch((err) => {
        console.error('Failed to send queued message:', err)
      })
      .finally(() => {
        processingQueueRef.current = false
      })
  }, [status, threadId, sendQueuedMessage])

  // If streaming errors out, discard any queued messages so they don't sit there stuck
  useEffect(() => {
    if (status === 'error') {
      useMessageQueue.getState().clearQueue(threadId)
    }
  }, [status, threadId])

  // Attach the error to the assistant turn it belongs to so the banner renders
  // alongside any tool-call parts the model already produced. Falls back to the
  // last user message if no assistant message exists yet (e.g. provider 4xx
  // before streaming starts).
  useEffect(() => {
    if (!error) return
    let targetId: string | undefined
    let lastUserIdx = -1
    for (let i = chatMessages.length - 1; i >= 0; i--) {
      if (chatMessages[i].role === 'user') {
        lastUserIdx = i
        break
      }
    }
    for (let i = chatMessages.length - 1; i > lastUserIdx; i--) {
      if (chatMessages[i].role === 'assistant') {
        targetId = chatMessages[i].id
        break
      }
    }
    if (!targetId && lastUserIdx >= 0) {
      targetId = chatMessages[lastUserIdx].id
    }
    if (!targetId) return
    const errMessage =
      error instanceof Error ? error.message : String(error || 'Error')
    // Context overflow is owned by the global "Increase Context Size" banner;
    // a per-message Regenerate would just re-overflow the same prompt.
    if (isContextOverflowMessage(errMessage)) {
      stampContextErrorOnThread(threadId, errMessage)
      setContextLimitError(new Error(errMessage))
      useMessageErrors.getState().clearError(targetId)
      return
    }
    useMessageErrors.getState().setError(targetId, errMessage)
    const reportTarget = targetId
    // The turn's own model, not the one selected by the time anyone reads
    // this: the check offered from the message has to be about the model
    // that actually failed.
    const failedTurn = turnModelOf(threadId)
    const failedModel =
      failedTurn.selectedProvider === 'llamacpp'
        ? failedTurn.selectedModel?.id
        : undefined
    void buildLoadDiagnosticsReport(error)
      .then((report) => {
        // Only if this is still the error on screen: a second failure on the
        // same message must not be handed the previous one's report, and one
        // that resolves after `clearError` must not put it back.
        if (!report) return
        if (useMessageErrors.getState().errors[reportTarget] !== errMessage) {
          return
        }
        useMessageErrors.getState().setReport(reportTarget, report, failedModel)
        // Saved with the error so "Copy diagnostics" survives a reload.
        const saved = useMessages
          .getState()
          .getMessages(threadId)
          .find((m) => m.id === reportTarget)
        if (saved) {
          updateMessage({
            ...saved,
            metadata: {
              ...(saved.metadata || {}),
              loadReport: { text: report, model: failedModel },
            },
          })
        }
      })
      .catch((e) =>
        console.warn('could not build the load diagnostics report:', e)
      )
    const tm = useMessages.getState().getMessages(threadId).find(
      (m) => m.id === targetId
    )
    if (tm) {
      const existingError = (tm.metadata as Record<string, unknown> | undefined)
        ?.error
      if (existingError !== errMessage) {
        updateMessage({
          ...tm,
          metadata: { ...(tm.metadata || {}), error: errMessage },
        })
      }
    }
  }, [status, error, threadId, chatMessages, updateMessage])

  // Persist whenever the user message lands in useMessages — covers the race
  // where the stamping effect ran before addMessage's commit was observable.
  const localThreadMessages = useMessages((s) => s.messages?.[threadId])
  const errorEntries = useMessageErrors((s) => s.errors)
  useEffect(() => {
    if (!localThreadMessages) return
    for (const m of localThreadMessages) {
      const err = errorEntries[m.id]
      if (typeof err !== 'string' || !err) continue
      const existing = (m.metadata as Record<string, unknown> | undefined)
        ?.error
      if (existing === err) continue
      updateMessage({
        ...m,
        metadata: { ...(m.metadata || {}), error: err },
      })
    }
  }, [localThreadMessages, errorEntries, updateMessage])

  // Clear the queue when navigating away from this thread
  useEffect(() => {
    return () => {
      useMessageQueue.getState().clearQueue(threadId)
    }
  }, [threadId])

  const threadModel = useMemo(
    () => searchThreadModel ?? thread?.model,
    [searchThreadModel, thread]
  )

  // Per-message version counts for the `< n/m >` navigation control.
  const versionInfoById = useMemo(() => {
    const map: Record<string, { index: number; count: number }> = {}
    if (!localThreadMessages || !hasBranching(localThreadMessages)) return map
    for (const m of localThreadMessages) {
      const info = getVersionInfo(localThreadMessages, m)
      if (info.count > 1) map[m.id] = info
    }
    return map
  }, [localThreadMessages])

  return (
    <div className="flex flex-col h-[calc(100dvh-(env(safe-area-inset-bottom)+env(safe-area-inset-top)))]">
      <HeaderPage>
        <div className="flex items-center justify-between w-full pr-2">
          <DropdownModelProvider model={threadModel} />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('work:panel.open')}
            aria-pressed={workPanelOpen}
            onClick={toggleWorkPanel}
          >
            <IconLayoutSidebarRight aria-hidden />
          </Button>
        </div>
      </HeaderPage>
      <div className="relative flex flex-1 min-h-0 overflow-hidden">
      <div className="flex flex-1 min-w-0 flex-col h-full overflow-hidden">
        {/* Messages Area */}
        <div
          className="message-zoom flex-1 relative"
          style={
            {
              '--font-size-base': `calc(${fontSize} * ${messageZoom})`,
            } as CSSProperties
          }
        >
          <Conversation className="absolute inset-0 text-start">
            <ConversationContent
              className={cn('mx-auto w-full px-6 pb-4 md:w-4/5 xl:w-4/6')}
            >
              {chatMessages.map((message, index) => {
                const isLastMessage = index === chatMessages.length - 1
                const isFirstMessage = index === 0
                // An out-of-memory or backend error stands in for the failed
                // assistant turn: regenerate/reload restarts it from scratch, so
                // hide the partial (tool calls, "Worked for Ns") and show only
                // the banner. A context-limit stop keeps its partial: that text
                // was generated and stored, and the banner only offers a bigger
                // context to resume it.
                if (
                  isLastMessage &&
                  (oomError || backendError) &&
                  message.role === 'assistant'
                )
                  return null
                return (
                  <MessageItem
                    key={message.id}
                    message={message}
                    isFirstMessage={isFirstMessage}
                    isLastMessage={isLastMessage}
                    status={effectiveStatus}
                    reasoningContainerRef={reasoningContainerRef}
                    isReasoningAtBottom={isReasoningAtBottom}
                    onReasoningScroll={handleReasoningScroll}
                    onReasoningScrollToBottom={forceScrollReasoningToBottom}
                    onRegenerate={handleRegenerate}
                    onContinue={handleContinue}
                    onEdit={handleEditMessage}
                    onDelete={handleDeleteMessage}
                    versionInfo={versionInfoById[message.id]}
                    onSwitchVersion={handleSwitchVersion}
                    isAnimating={!pendingContinueMessage}
                    hideActions={!!pendingContinueMessage}
                    threadId={threadId}
                  />
                )
              })}
              {pendingContinueMessage && status === 'submitted' && (
                <MessageItem
                  key={`continue-placeholder-${pendingContinueMessage.id}`}
                  message={pendingContinueMessage}
                  isFirstMessage={false}
                  isLastMessage={true}
                  status={effectiveStatus}
                  reasoningContainerRef={reasoningContainerRef}
                  isReasoningAtBottom={isReasoningAtBottom}
                  onReasoningScroll={handleReasoningScroll}
                  onReasoningScrollToBottom={forceScrollReasoningToBottom}
                  onRegenerate={handleRegenerate}
                  onEdit={handleEditMessage}
                  onDelete={handleDeleteMessage}
                  hideActions
                  isAnimating={false}
                />
              )}
              {!oomError &&
                !backendError &&
                !contextLimitError &&
                status === CHAT_STATUS.SUBMITTED && (
                  <div className="flex flex-row items-center gap-2">
                    {pendingContinueMessage && (
                      <Shimmer duration={1}>Growing the Mind...</Shimmer>
                    )}
                    {!pendingContinueMessage && !lastIsAssistant && (
                      <PromptProgress />
                    )}
                  </div>
                )}
              {(contextLimitError || oomError || backendError) && (
                <div className="px-4 py-3 mx-4 my-2 rounded-lg border border-destructive/10 bg-destructive/10">
                  <div className="flex items-start gap-3">
                    <IconAlertCircle className="size-5 text-destructive shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-destructive mb-1">
                        {oomError
                          ? 'llama.cpp ran out of memory'
                          : backendError
                            ? 'GGML backend encountered an error'
                            : 'Model ran out of context size'}
                      </p>
                      <div className="table table-fixed w-full">
                        <span
                          className={
                            (oomError || backendError
                              ? 'text-xs font-mono'
                              : 'text-sm') +
                            ' text-muted-foreground table-cell align-middle'
                          }
                          style={{ wordWrap: 'break-word' }}
                        >
                          {oomError ?? backendError ?? contextBannerMessage}
                        </span>
                      </div>
                      {oomError && (
                        <ul className="mt-2 list-disc pl-5 text-xs text-muted-foreground space-y-0.5">
                          <li>Reduce context size (ctx-size)</li>
                          <li>Disable MTP (Multi-Token Prediction)</li>
                          <li>Lower n-gpu-layers or switch to a CPU backend</li>
                          <li>Use a smaller / more quantized model</li>
                        </ul>
                      )}
                      {offersContextIncrease(
                        selectedProvider,
                        (error ?? contextLimitError)?.message
                      ) ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="mt-3"
                          onClick={handleContextSizeIncrease}
                        >
                          <IconAlertCircle className="size-4 mr-2" />
                          Increase Context Size
                        </Button>
                      ) : oomError || backendError ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="mt-3"
                          onClick={() => handleRegenerate()}
                        >
                          <IconRefresh className="size-4 mr-2" />
                          Reload
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </div>
              )}
            </ConversationContent>
            <ConversationScrollButton />
          </Conversation>
        </div>

        {/* Chat Input - Fixed at bottom. No top padding: the scroll area (and
            its fade) runs right up to the composer, with the resting gap kept
            inside the scroll content as pb-4. */}
        <div className="pb-4 px-6 mx-auto w-full md:w-4/5 xl:w-4/6">
          <InteractionCards threadId={threadId} />
          <ChatInput
            model={threadModel}
            onSubmit={handleSubmit}
            onStop={handleStop}
            chatStatus={effectiveStatus}
          />
        </div>
      </div>
      {workPanelOpen && (
        <WorkPanel threadId={threadId} />
      )}
      </div>
    </div>
  )
}
