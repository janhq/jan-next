/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import React from 'react'

// -----------------------------------------------------------------------------
// Hoisted shared state + mocks (needed because vi.mock factory runs first)
// -----------------------------------------------------------------------------
const h = vi.hoisted(() => {
  const mockSendMessage = vi.fn()
  const mockRegenerate = vi.fn()
  const mockStop = vi.fn()
  const mockAddToolOutput = vi.fn()
  const mockSetChatMessages = vi.fn()
  const mockSetContinueFromContent = vi.fn()

  const chatState: { messages: any[]; status: string; error: Error | null } = {
    messages: [],
    status: 'ready',
    error: null,
  }

  const threadsState: any = {
    threads: {
      'thread-1': {
        id: 'thread-1',
        title: 'My Thread',
        metadata: {},
        assistants: [],
        model: { id: 'gpt-x', provider: 'openai' },
      },
    },
    setCurrentThreadId: vi.fn(),
    updateThread: vi.fn(),
  }
  const useThreadsMock: any = (selector: any) => selector(threadsState)
  useThreadsMock.getState = () => threadsState

  const messagesState: any = {
    setMessages: vi.fn(),
    addMessage: vi.fn(),
    updateMessage: vi.fn(),
    deleteMessage: vi.fn(),
    getMessages: vi.fn(() => []),
  }
  const useMessagesMock: any = (selector: any) => selector(messagesState)
  useMessagesMock.getState = () => messagesState

  const appStateState = {
    ragToolNames: new Set<string>(),
    tools: [] as Array<{ name: string; server?: string }>,
    extensionTools: [] as Array<{
      wireName: string
      extensionId: string
      name: string
      server: string
    }>,
    setOomError: vi.fn(),
    setBackendError: vi.fn(),
    busyThreads: {} as Record<string, boolean>,
    embeddingThreads: {} as Record<string, boolean>,
    setThreadBusy: vi.fn(),
    setThreadEmbedding: vi.fn(),
  }
  const useAppStateMock: any = (selector: any) => selector(appStateState)
  useAppStateMock.getState = () => appStateState

  const modelProviderState: any = {
    selectedModel: {
      id: 'gpt-x',
      capabilities: ['tools'],
      settings: {
        ctx_len: { controller_props: { value: 4096, max: 131072 } },
        auto_increase_ctx_len: { controller_props: { value: true } },
      },
    },
    selectedProvider: 'openai',
    getProviderByName: vi.fn((name: string) => ({
      provider: name,
      models: [
        {
          id: 'gpt-x',
          settings: {
            ctx_len: { controller_props: { value: 4096, max: 131072 } },
          },
        },
      ],
    })),
    updateProvider: vi.fn(),
  }
  const useModelProviderMock: any = (selector: any) => selector(modelProviderState)
  useModelProviderMock.getState = () => modelProviderState

  const chatSessionsState: any = {
    sessions: {},
    getSessionData: vi.fn(() => ({ tools: [] })),
  }
  const useChatSessionsMock: any = (selector: any) => selector(chatSessionsState)
  useChatSessionsMock.getState = () => chatSessionsState
  // Listeners the route registers to learn a thread's session was removed (the
  // thread was deleted); removeChatSession below notifies them.
  const chatSessionListeners = new Set<(state: any) => void>()
  useChatSessionsMock.subscribe = (listener: (state: any) => void) => {
    chatSessionListeners.add(listener)
    return () => chatSessionListeners.delete(listener)
  }
  const removeChatSession = (threadId: string) => {
    const rest = { ...chatSessionsState.sessions }
    delete rest[threadId]
    chatSessionsState.sessions = rest
    for (const listener of [...chatSessionListeners]) listener(chatSessionsState)
  }

  const attachmentsState: any = {
    getAttachments: vi.fn(() => []),
    clearAttachments: vi.fn(),
    setAttachments: vi.fn(),
  }
  const useChatAttachmentsMock: any = (selector: any) => selector(attachmentsState)
  useChatAttachmentsMock.getState = () => attachmentsState


  const toolAvailableState: any = {
    getDisabledToolsForThread: vi.fn(() => []),
  }
  const useToolAvailableMock: any = (selector: any) => selector(toolAvailableState)
  useToolAvailableMock.getState = () => toolAvailableState

  const messageQueueState: any = {
    dequeue: vi.fn(() => null),
    clearQueue: vi.fn(),
  }
  const useMessageQueueMock: any = (_selector: any) => undefined
  useMessageQueueMock.getState = () => messageQueueState

  return {
    // The route's thread id, which the tests move to simulate a thread switch.
    routeParams: { threadId: 'thread-1' },
    mockSendMessage,
    mockRegenerate,
    mockStop,
    mockAddToolOutput,
    mockSetChatMessages,
    mockSetContinueFromContent,
    chatState,
    threadsState,
    useThreadsMock,
    messagesState,
    useMessagesMock,
    appStateState,
    useAppStateMock,
    modelProviderState,
    useModelProviderMock,
    chatSessionsState,
    useChatSessionsMock,
    removeChatSession,
    attachmentsState,
    useChatAttachmentsMock,
    toolAvailableState,
    useToolAvailableMock,
    messageQueueState,
    useMessageQueueMock,
  }
})

// -----------------------------------------------------------------------------
// Module mocks
// -----------------------------------------------------------------------------

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: any) => ({ ...config, id: '/threads/$threadId' }),
  useParams: () => ({ threadId: h.routeParams.threadId }),
  useSearch: () => ({ threadModel: undefined }),
}))

vi.mock('@/containers/HeaderPage', () => ({
  default: ({ children }: any) => <div data-testid="header-page">{children}</div>,
}))

vi.mock('@/containers/DropdownModelProvider', () => ({
  default: ({ model }: any) => (
    <div data-testid="model-dropdown">{model ? model.id : 'no-model'}</div>
  ),
}))

vi.mock('@/containers/work/WorkPanel', () => ({ WorkPanel: () => null }))
vi.mock('@/containers/work/InteractionCards', () => ({ InteractionCards: () => null }))

vi.mock('@/containers/ChatInput', () => ({
  default: ({ onSubmit, onStop, chatStatus }: any) => (
    <div data-testid="chat-input">
      <span data-testid="chat-status">{chatStatus}</span>
      <button
        data-testid="chat-send"
        onClick={() => onSubmit('hello world', undefined)}
      >
        send
      </button>
      <button
        data-testid="chat-send-ref"
        onClick={() =>
          onSubmit(
            'summarise\n\n---\nReferenced file contents:\n\nbody',
            undefined,
            undefined,
            'summarise @notes.md'
          )
        }
      >
        send with reference
      </button>
      <button data-testid="chat-stop" onClick={() => onStop()}>
        stop
      </button>
    </div>
  ),
}))

vi.mock('@/containers/MessageItem', () => ({
  MessageItem: ({
    message,
    onRegenerate,
    onEdit,
    onDelete,
    versionInfo,
    onSwitchVersion,
  }: any) => (
    <div data-testid={`message-${message.id}`} data-role={message.role}>
      <span>{message.id}</span>
      {versionInfo && (
        <span data-testid={`version-${message.id}`}>
          {versionInfo.index}/{versionInfo.count}
        </span>
      )}
      <button
        data-testid={`prev-${message.id}`}
        onClick={() => onSwitchVersion?.(message.id, -1)}
      >
        prev
      </button>
      <button
        data-testid={`regen-${message.id}`}
        onClick={() => onRegenerate(message.id)}
      >
        regen
      </button>
      <button
        data-testid={`edit-${message.id}`}
        onClick={() => onEdit(message.id, 'edited text')}
      >
        edit
      </button>
      <button
        data-testid={`del-${message.id}`}
        onClick={() => onDelete(message.id)}
      >
        del
      </button>
    </div>
  ),
}))

vi.mock('@/components/ai-elements/conversation', () => ({
  Conversation: ({ children }: any) => <div>{children}</div>,
  ConversationContent: ({ children }: any) => <div>{children}</div>,
  ConversationScrollButton: () => <div data-testid="scroll-btn" />,
}))

vi.mock('@/components/ai-elements/shimmer', () => ({
  Shimmer: ({ children }: any) => <div data-testid="shimmer">{children}</div>,
}))

vi.mock('@/components/PromptProgress', () => ({
  PromptProgress: () => <div data-testid="prompt-progress" />,
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick }: any) => (
    <button onClick={onClick}>{children}</button>
  ),
}))

vi.mock('@tabler/icons-react', () => ({
  IconAlertCircle: () => <span />,
  IconRefresh: () => <span />,
  IconLayoutSidebarRight: () => <span />,
}))

vi.mock('@/lib/utils', () => ({
  cn: (...classes: any[]) => classes.filter(Boolean).join(' '),
}))

vi.mock('@/lib/instructionTemplate', () => ({
  renderInstructions: (i: string) => `rendered:${i}`,
}))

vi.mock('@/lib/messages', () => ({
  convertThreadMessagesToUIMessages: (msgs: any[]) =>
    msgs.map((m) => ({
      id: m.id,
      role: m.role,
      parts: [{ type: 'text', text: m.content?.[0]?.text?.value ?? '' }],
    })),
  extractContentPartsFromUIMessage: (msg: any) =>
    msg.parts.flatMap((p: any) =>
      p.type === 'text'
        ? [{ type: 'text', text: { value: p.text, annotations: [] } }]
        : p.type?.startsWith('tool-')
          ? [{ type: 'tool_call', tool_call_id: p.toolCallId, output: p.output }]
          : []
    ),
  uiMessageHasMeaningfulContent: (msg: any) =>
    !!msg?.parts?.some((p: any) => p.type === 'text' && p.text?.trim()),
  toolErrorsOf: (msg: any) => {
    const errors: Record<string, string> = {}
    for (const p of msg.parts ?? []) {
      if (p.state === 'output-error') errors[p.toolCallId] = p.errorText
    }
    return Object.keys(errors).length ? errors : undefined
  },
}))

// The chat runs MCP tools through the cancellable API so Stop can end the call.
const cancellable = (run: (args: any) => Promise<unknown>) => (args: any) => ({
  promise: run(args),
  cancel: vi.fn().mockResolvedValue(undefined),
  token: 'test-token',
})

vi.mock('@/lib/completion', () => ({
  newUserThreadContent: (threadId: string, text: string, _a: any, id: string) => ({
    id,
    thread_id: threadId,
    role: 'user',
    content: [{ type: 'text', text: { value: text, annotations: [] } }],
    metadata: {},
  }),
}))

vi.mock('@/lib/attachmentProcessing', () => ({
  processAttachmentsForSend: vi
    .fn()
    .mockResolvedValue({ processedAttachments: [], hasEmbeddedDocuments: false }),
  resolveAutoInlineBudget: vi.fn().mockResolvedValue(6144),
  needsIngestionChoice: vi.fn(
    (doc: any, pref: string) => (doc.parseMode ?? pref) === 'auto'
  ),
  promptIngestionChoices: vi.fn(),
  applyIngestionChoices: (atts: any[], choices: Map<string, string>) =>
    atts.map((a) =>
      choices.has(a.path) ? { ...a, parseMode: choices.get(a.path) } : a
    ),
}))

vi.mock('@/lib/thread-title-summarizer', () => ({
  generateThreadTitle: vi.fn().mockResolvedValue('Short title'),
}))

vi.mock('@/types/attachment', () => ({
  createImageAttachment: (x: any) => ({ type: 'image', ...x }),
}))

vi.mock('ai', () => ({
  generateId: () => 'gen-id',
  lastAssistantMessageIsCompleteWithToolCalls: () => true,
}))

vi.mock('zustand/react/shallow', () => ({
  useShallow: (fn: any) => fn,
}))

vi.mock('@/hooks/use-chat', () => ({
  useChat: (_args: any) => {
    ;(h as any).capturedOnFinish = _args?.onFinish
    ;(h as any).capturedOnToolCall = _args?.onToolCall
    ;(h as any).capturedSendAutomaticallyWhen = _args?.sendAutomaticallyWhen
    return {
      messages: h.chatState.messages,
      status: h.chatState.status,
      error: h.chatState.error,
      sendMessage: h.mockSendMessage,
      regenerate: h.mockRegenerate,
      setMessages: h.mockSetChatMessages,
      stop: h.mockStop,
      addToolOutput: h.mockAddToolOutput,
      setContinueFromContent: h.mockSetContinueFromContent,
    }
  },
}))

vi.mock('@/hooks/useThreads', () => ({ useThreads: h.useThreadsMock }))
vi.mock('@/hooks/useMessages', () => ({ useMessages: h.useMessagesMock }))
vi.mock('@/hooks/useAppState', () => ({ useAppState: h.useAppStateMock }))
vi.mock('@/hooks/useModelProvider', () => ({ useModelProvider: h.useModelProviderMock }))
vi.mock('@/stores/chat-session-store', () => ({ useChatSessions: h.useChatSessionsMock }))
vi.mock('@/hooks/useChatAttachments', () => ({
  useChatAttachments: h.useChatAttachmentsMock,
  NEW_THREAD_ATTACHMENT_KEY: '__new-thread__',
}))
vi.mock('@/hooks/useToolAvailable', () => ({ useToolAvailable: h.useToolAvailableMock }))
const shell = vi.hoisted(() => ({
  enabled: true,
  execute: vi.fn(async () => ({ output: 'ok' })),
}))
vi.mock('@/hooks/useChatShell', () => ({
  useChatShell: { getState: () => ({ shellEnabled: shell.enabled }) },
}))
vi.mock('@/lib/agentTools', () => ({
  CHAT_AGENT_TOOL_NAMES: new Set(['shell']),
  executeAgentTool: shell.execute,
}))
vi.mock('@/stores/message-queue-store', () => ({ useMessageQueue: h.useMessageQueueMock }))

vi.mock('@/hooks/useAutoScroll', () => ({
  useAutoScroll: () => ({
    containerRef: { current: null },
    isAtBottom: true,
    handleScroll: vi.fn(),
    scrollToBottom: vi.fn(),
    forceScrollToBottom: vi.fn(),
    reset: vi.fn(),
  }),
}))

vi.mock('@janhq/core', () => ({
  MessageStatus: { Ready: 'ready' },
  ChatCompletionRole: { Assistant: 'assistant', User: 'user' },
  ContentType: { Text: 'text' },
  ServiceKeys: { VectorDB: { id: 'vector-db' } },
}))

vi.mock('@/constants/chat', () => ({
  SESSION_STORAGE_PREFIX: { INITIAL_MESSAGE: 'initial-message-' },
}))

vi.mock('@/utils/error', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/error')>()),
  OUT_OF_CONTEXT_SIZE: 'OUT_OF_CONTEXT_SIZE',
}))

// -----------------------------------------------------------------------------
// Import component AFTER mocks
// -----------------------------------------------------------------------------
import { Route } from '../$threadId'
import { getServiceHub } from '@/hooks/useServiceHub'
import { useMessageErrors } from '@/stores/message-errors'
import {
  processAttachmentsForSend,
  promptIngestionChoices,
  resolveAutoInlineBudget,
} from '@/lib/attachmentProcessing'
import { usePrompt } from '@/hooks/usePrompt'

// The global setup mock is a shared object, so an overridden factory has to be
// put back or it leaks into every later test.
const hub = getServiceHub() as unknown as Record<string, unknown>
const realMcp = hub.mcp

const renderComponent = () => {
  const Component = Route.component as React.ComponentType
  return render(<Component />)
}

describe('ThreadDetail route', () => {
  beforeEach(() => {
    // Leaving a thread no longer ends its tool loop, so a loop an earlier test
    // left waiting would keep its approvals. Deleting the threads ends them.
    h.removeChatSession('thread-1')
    h.removeChatSession('thread-2')
    vi.clearAllMocks()
    h.chatState.messages = []
    h.chatState.status = 'ready'
    h.chatState.error = null
    h.threadsState.threads['thread-1'] = {
      id: 'thread-1',
      title: 'My Thread',
      metadata: {},
      assistants: [],
      model: { id: 'gpt-x', provider: 'openai' },
    }
    h.threadsState.setCurrentThreadId = vi.fn()
    h.threadsState.updateThread = vi.fn()
    h.messagesState.getMessages = vi.fn(() => [
      {
        id: 'u1',
        role: 'user',
        content: [{ type: 'text', text: { value: 'hi', annotations: [] } }],
      },
      {
        id: 'a1',
        role: 'assistant',
        content: [{ type: 'text', text: { value: 'hello', annotations: [] } }],
      },
    ])
    h.messagesState.addMessage = vi.fn()
    h.messagesState.updateMessage = vi.fn()
    h.messagesState.deleteMessage = vi.fn()
    h.messagesState.setMessages = vi.fn()
    h.chatSessionsState.getSessionData = vi.fn(() => ({ tools: [] }))
    h.messageQueueState.dequeue = vi.fn(() => null)
    h.messageQueueState.clearQueue = vi.fn()
    h.modelProviderState.selectedProvider = 'openai'
    h.appStateState.oomError = undefined
    h.appStateState.ragToolNames = new Set<string>()
    h.appStateState.extensionTools = []
    hub.mcp = realMcp
    sessionStorage.clear()
  })

  it('validateSearch returns threadModel from search params', () => {
    const searchModel = { id: 'm1', provider: 'p1' }
    const result = (Route as any).validateSearch({ threadModel: searchModel })
    expect(result.threadModel).toEqual(searchModel)
  })

  it('validateSearch handles missing threadModel', () => {
    const result = (Route as any).validateSearch({})
    expect(result.threadModel).toBeUndefined()
  })

  it('renders header, model dropdown, and chat input', () => {
    renderComponent()
    expect(screen.getByTestId('header-page')).toBeInTheDocument()
    expect(screen.getByTestId('model-dropdown')).toHaveTextContent('gpt-x')
    expect(screen.getByTestId('chat-input')).toBeInTheDocument()
    expect(screen.getByTestId('chat-status')).toHaveTextContent('ready')
  })

  it('sets current thread id on mount and resets on unmount', () => {
    const { unmount } = renderComponent()
    expect(h.threadsState.setCurrentThreadId).toHaveBeenCalledWith('thread-1')
    unmount()
    expect(h.threadsState.setCurrentThreadId).toHaveBeenLastCalledWith(undefined)
  })

  it('renders messages passed through useChat', () => {
    h.chatState.messages = [
      { id: 'm-a', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
      { id: 'm-b', role: 'assistant', parts: [{ type: 'text', text: 'yo' }] },
    ]
    renderComponent()
    expect(screen.getByTestId('message-m-a')).toBeInTheDocument()
    expect(screen.getByTestId('message-m-b')).toBeInTheDocument()
  })

  it('submits user text via ChatInput -> sendMessage', async () => {
    renderComponent()
    await act(async () => {
      screen.getByTestId('chat-send').click()
    })
    await waitFor(() => {
      expect(h.mockSendMessage).toHaveBeenCalled()
    })
    expect(h.messagesState.addMessage).toHaveBeenCalled()
  })

  it('invokes stop when ChatInput calls onStop', () => {
    renderComponent()
    screen.getByTestId('chat-stop').click()
    expect(h.mockStop).toHaveBeenCalled()
  })

  it('regenerate from a user message calls regenerate with its id', () => {
    h.chatState.messages = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
      { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'hello' }] },
    ]
    renderComponent()
    screen.getByTestId('regen-u1').click()
    expect(h.mockRegenerate).toHaveBeenCalledWith({ messageId: 'u1' })
  })

  it('regenerate from an assistant message keeps the prior version (no delete)', () => {
    h.chatState.messages = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
      { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'hello' }] },
    ]
    renderComponent()
    screen.getByTestId('regen-a1').click()
    // Versioning: the old reply is preserved, parent links are backfilled.
    expect(h.messagesState.deleteMessage).not.toHaveBeenCalled()
    expect(h.messagesState.updateMessage).toHaveBeenCalled()
    expect(h.mockRegenerate).toHaveBeenCalledWith({ messageId: 'a1' })
  })

  it('edit on a user message forks a new version and regenerates', () => {
    h.chatState.messages = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
      { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'hello' }] },
    ]
    renderComponent()
    screen.getByTestId('edit-u1').click()
    // A new sibling version is added; the original branch is not deleted.
    expect(h.messagesState.addMessage).toHaveBeenCalled()
    expect(h.messagesState.updateMessage).toHaveBeenCalled()
    expect(h.mockSetChatMessages).toHaveBeenCalled()
    expect(h.messagesState.deleteMessage).not.toHaveBeenCalled()
    expect(h.mockRegenerate).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: expect.any(String) })
    )
  })

  it('edit on an assistant message updates without regenerating', () => {
    h.chatState.messages = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
      { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'hello' }] },
    ]
    renderComponent()
    screen.getByTestId('edit-a1').click()
    expect(h.messagesState.updateMessage).toHaveBeenCalled()
    expect(h.mockRegenerate).not.toHaveBeenCalled()
  })

  it('shows a version chip and switches branches without regenerating', () => {
    const branched = [
      {
        id: 'u1',
        role: 'user',
        created_at: 1,
        content: [{ type: 'text', text: { value: 'hi', annotations: [] } }],
        metadata: { parentId: null },
      },
      {
        id: 'a1a',
        role: 'assistant',
        created_at: 2,
        content: [{ type: 'text', text: { value: 'v1', annotations: [] } }],
        metadata: { parentId: 'u1' },
      },
      {
        id: 'a1b',
        role: 'assistant',
        created_at: 3,
        content: [{ type: 'text', text: { value: 'v2', annotations: [] } }],
        metadata: { parentId: 'u1' },
      },
    ]
    h.messagesState.messages = { 'thread-1': branched }
    h.messagesState.getMessages = vi.fn(() => branched)
    h.chatState.messages = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
      { id: 'a1b', role: 'assistant', parts: [{ type: 'text', text: 'v2' }] },
    ]
    renderComponent()
    // The active (newest) reply shows as version 2 of 2.
    expect(screen.getByTestId('version-a1b').textContent).toBe('2/2')
    screen.getByTestId('prev-a1b').click()
    // Switching pins the parent's active child and re-renders, no regeneration.
    expect(h.messagesState.updateMessage).toHaveBeenCalled()
    expect(h.mockSetChatMessages).toHaveBeenCalled()
    expect(h.mockRegenerate).not.toHaveBeenCalled()
  })

  it('clears an active banner error when switching versions so a healthy assistant is not hidden', () => {
    // A prior turn left a router OOM banner active. Without clearing it on
    // switch, the render filter blanks the last assistant of whatever branch we
    // land on, leaving only user messages visible.
    h.modelProviderState.selectedProvider = 'llamacpp'
    h.appStateState.oomError = 'router crashed'
    const branched = [
      {
        id: 'u1',
        role: 'user',
        created_at: 1,
        content: [{ type: 'text', text: { value: 'hi', annotations: [] } }],
        metadata: { parentId: null },
      },
      {
        id: 'a1a',
        role: 'assistant',
        created_at: 2,
        content: [{ type: 'text', text: { value: 'v1', annotations: [] } }],
        metadata: { parentId: 'u1' },
      },
      {
        id: 'a1b',
        role: 'assistant',
        created_at: 3,
        content: [{ type: 'text', text: { value: 'v2', annotations: [] } }],
        metadata: { parentId: 'u1' },
      },
    ]
    h.messagesState.messages = { 'thread-1': branched }
    h.messagesState.getMessages = vi.fn(() => branched)
    // a1b is rendered mid-list (a trailing user turn keeps it off the
    // last-message filter) so its version nav stays clickable.
    h.chatState.messages = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
      { id: 'a1b', role: 'assistant', parts: [{ type: 'text', text: 'v2' }] },
      { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'more' }] },
    ]
    renderComponent()
    screen.getByTestId('prev-a1b').click()
    expect(h.appStateState.setOomError).toHaveBeenCalledWith(undefined)
    expect(h.mockRegenerate).not.toHaveBeenCalled()
  })

  it('onFinish links a new assistant to the active user turn in a branched thread (never null parent)', () => {
    // Regression for #8357: once a thread is branched, a lost pending-parent ref
    // must not persist the assistant with parentId:null (which computeActivePath
    // drops as a phantom root, leaving "user messages in a row").
    const branched = [
      {
        id: 'u1',
        role: 'user',
        created_at: 1,
        content: [{ type: 'text', text: { value: 'hi', annotations: [] } }],
        metadata: { parentId: null },
      },
      {
        id: 'a1',
        role: 'assistant',
        created_at: 2,
        content: [{ type: 'text', text: { value: 'r1', annotations: [] } }],
        metadata: { parentId: 'u1' },
      },
      {
        id: 'u2',
        role: 'user',
        created_at: 3,
        content: [{ type: 'text', text: { value: 'again', annotations: [] } }],
        metadata: { parentId: 'a1' },
      },
    ]
    h.messagesState.getMessages = vi.fn(() => branched)
    renderComponent()

    act(() => {
      ;(h as any).capturedOnFinish({
        message: {
          id: 'a2',
          role: 'assistant',
          parts: [{ type: 'text', text: 'reply for u2' }],
          metadata: {},
        },
        isAbort: false,
      })
    })

    const added = h.messagesState.addMessage.mock.calls.map((c: any[]) => c[0])
    const persisted = added.find((m: any) => m.id === 'a2')
    expect(persisted).toBeTruthy()
    expect(persisted.metadata.parentId).toBe('u2')
    expect(persisted.metadata.parentId).not.toBeNull()
  })

  describe('finishReason length (#9228)', () => {
    const finishAtLength = () =>
      (h as any).capturedOnFinish({
        message: {
          id: 'a-len',
          role: 'assistant',
          parts: [{ type: 'text', text: 'partial answer' }],
          metadata: {
            finishReason: 'length',
            usage: { inputTokens: 30000, outputTokens: 4000 },
          },
        },
        isAbort: false,
        isError: false,
      })

    it('keeps a truncated cloud reply as stopped instead of a context banner', () => {
      h.modelProviderState.selectedProvider = 'anthropic'
      renderComponent()
      act(() => {
        finishAtLength()
      })
      const added = h.messagesState.addMessage.mock.calls.map((c: any[]) => c[0])
      const persisted = added.find((m: any) => m.id === 'a-len')
      expect(persisted).toBeTruthy()
      expect(persisted.metadata.stopped).toBe(true)
      expect(screen.queryByText('Increase Context Size')).toBeNull()
    })

    // A reply that fills a local model's context was generated; dropping it left
    // the user with only their own message and a banner.
    it('keeps the partial reply of a local model near ctx_len, with the banner', () => {
      h.modelProviderState.selectedProvider = 'llamacpp'
      renderComponent()
      act(() => {
        finishAtLength()
      })
      const added = h.messagesState.addMessage.mock.calls.map((c: any[]) => c[0])
      const persisted = added.find((m: any) => m.id === 'a-len')
      expect(persisted).toBeTruthy()
      expect(persisted.metadata.stopped).toBe(true)
      expect(screen.getByText('Increase Context Size')).toBeInTheDocument()
    })

    // Clicks Increase Context Size and lets its delayed regenerate fire. Returns
    // what the click replayed to the thread's transport as the assistant prefill.
    const increaseContext = async () => {
      const setContinueFromContent = vi.fn()
      h.chatSessionsState.sessions = {
        'thread-1': {
          transport: { getTurnModelSelection: () => null, setContinueFromContent },
        },
      }
      const realModels = hub.models as () => Record<string, unknown>
      hub.models = () => ({
        ...realModels(),
        updateModelSettings: vi.fn().mockResolvedValue(undefined),
      })
      vi.useFakeTimers()
      try {
        await act(async () => {
          screen.getByText('Increase Context Size').click()
        })
        await act(async () => {
          vi.advanceTimersByTime(1000)
        })
      } finally {
        vi.clearAllTimers()
        vi.useRealTimers()
        hub.models = realModels
        h.chatSessionsState.sessions = {}
      }
      return setContinueFromContent
    }

    // The saved partial is in memory only; after a restart the stopped reply is
    // what hydration restored. Increase Context Size resumes it in place instead
    // of regenerating from scratch and keeping the partial as another version,
    // and replays its reasoning with its text.
    it('resumes the stored partial in place after an application restart', async () => {
      h.modelProviderState.selectedProvider = 'llamacpp'
      h.chatState.status = 'error'
      h.chatState.error = new Error(
        'request (518 tokens) exceeds the available context size (512 tokens)'
      )
      h.chatState.messages = [
        { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'q' }] },
        {
          id: 'a-len',
          role: 'assistant',
          parts: [
            { type: 'reasoning', text: 'thinking' },
            { type: 'text', text: 'partial answer' },
          ],
          metadata: { stopped: true, parentId: 'u1' },
        },
      ]
      const stored = [
        { id: 'u1', role: 'user', thread_id: 'thread-1', content: [], metadata: { parentId: null } },
        { id: 'a-len', role: 'assistant', thread_id: 'thread-1', content: [], metadata: { stopped: true, parentId: 'u1' } },
      ]
      h.messagesState.getMessages = vi.fn(() => stored)
      renderComponent()
      const onFinish = (h as any).capturedOnFinish

      const prefill = await increaseContext()
      expect(h.mockRegenerate).toHaveBeenCalledWith({ messageId: 'a-len' })
      expect(prefill).toHaveBeenCalledWith({
        text: 'partial answer',
        reasoning: 'thinking',
      })

      act(() => {
        onFinish({
          message: {
            id: 'a-new',
            role: 'assistant',
            parts: [{ type: 'text', text: 'partial answer, done' }],
            metadata: {},
          },
          isAbort: false,
          isError: false,
        })
      })
      expect(h.messagesState.deleteMessage).toHaveBeenCalledWith('thread-1', 'a-len')
    })

    // A thinking model can fill the context while still reasoning: there is no
    // text yet, but the reasoning is what to resume from.
    it('resumes a reply that filled the context while still reasoning', async () => {
      h.modelProviderState.selectedProvider = 'llamacpp'
      renderComponent()
      act(() => {
        ;(h as any).capturedOnFinish({
          message: {
            id: 'a-len',
            role: 'assistant',
            parts: [{ type: 'reasoning', text: 'still thinking' }],
            metadata: {
              finishReason: 'length',
              usage: { inputTokens: 30000, outputTokens: 4000 },
            },
          },
          isAbort: false,
          isError: false,
        })
      })

      const prefill = await increaseContext()
      expect(h.mockRegenerate).toHaveBeenCalledWith({ messageId: 'a-len' })
      expect(prefill).toHaveBeenCalledWith({
        text: '',
        reasoning: 'still thinking',
      })
    })
  })

  // #9311: a turn keeps running after the user opens another thread, and its
  // onFinish is a closure of the render that created its chat. What the open
  // thread set up for its own next reply, and its banners, must not be taken
  // or shown by the background thread's turn.
  describe('a turn finishing behind another thread', () => {
    const Component = () => Route.component as React.ComponentType
    const text = (value: string) => [
      { type: 'text', text: { value, annotations: [] } },
    ]
    const threadB = [
      { id: 'b-u1', role: 'user', created_at: 1, content: text('q'), metadata: { parentId: null } },
      { id: 'b-a1', role: 'assistant', created_at: 2, content: text('r'), metadata: { parentId: 'b-u1' } },
    ]
    const openThreadB = (rerender: (ui: React.ReactElement) => void) => {
      const C = Component()
      h.routeParams.threadId = 'thread-2'
      h.threadsState.threads['thread-2'] = {
        id: 'thread-2',
        title: 'Other',
        metadata: {},
        assistants: [],
        model: { id: 'gpt-x', provider: 'openai' },
      }
      const threadA = h.messagesState.getMessages()
      h.messagesState.getMessages = vi.fn((id?: string) =>
        id === 'thread-2' ? threadB : threadA
      )
      h.chatState.messages = [
        { id: 'b-u1', role: 'user', parts: [{ type: 'text', text: 'q' }] },
        { id: 'b-a1', role: 'assistant', parts: [{ type: 'text', text: 'r' }] },
      ]
      rerender(<C />)
    }
    const persisted = (id: string) =>
      h.messagesState.addMessage.mock.calls
        .map((c: any[]) => c[0])
        .find((m: any) => m.id === id)

    afterEach(() => {
      h.routeParams.threadId = 'thread-1'
      delete h.threadsState.threads['thread-2']
    })

    it("leaves the open thread's pending reply parent for its own reply", () => {
      const { rerender } = renderComponent()
      const onFinishA = (h as any).capturedOnFinish
      openThreadB(rerender)
      // The open thread starts a new version of its reply.
      act(() => {
        screen.getByTestId('regen-b-a1').click()
      })

      act(() => {
        onFinishA({
          message: { id: 'a-bg', role: 'assistant', parts: [{ type: 'text', text: 'A' }], metadata: {} },
          isAbort: false,
        })
      })
      expect(persisted('a-bg').thread_id).toBe('thread-1')
      expect(persisted('a-bg').metadata.parentId).not.toBe('b-u1')

      act(() => {
        ;(h as any).capturedOnFinish({
          message: { id: 'b-a2', role: 'assistant', parts: [{ type: 'text', text: 'B' }], metadata: {} },
          isAbort: false,
        })
      })
      expect(persisted('b-a2').metadata.parentId).toBe('b-u1')
    })

    // The partial shown while the model reloads after "Increase Context Size"
    // belongs to its thread: never shown in another, and cleared by its own
    // turn finishing even while another thread is open.
    it("keeps the reload placeholder to its own thread", async () => {
      h.modelProviderState.selectedProvider = 'llamacpp'
      const C = Route.component as React.ComponentType
      const { rerender } = renderComponent()
      const onFinishA = (h as any).capturedOnFinish
      act(() => {
        onFinishA({
          message: {
            id: 'a-len',
            role: 'assistant',
            parts: [{ type: 'text', text: 'partial answer' }],
            metadata: {
              finishReason: 'length',
              usage: { inputTokens: 30000, outputTokens: 4000 },
            },
          },
          isAbort: false,
          isError: false,
        })
      })
      const realModels = hub.models as () => Record<string, unknown>
      hub.models = () => ({
        ...realModels(),
        updateModelSettings: vi.fn().mockResolvedValue(undefined),
      })
      // The click regenerates after a delay; it must not fire in a later test.
      vi.useFakeTimers()
      try {
        await act(async () => {
          screen.getByText('Increase Context Size').click()
        })
      } finally {
        vi.clearAllTimers()
        vi.useRealTimers()
        hub.models = realModels
      }
      // In front, its own thread shows the partial while the model reloads.
      h.chatState.status = 'submitted'
      rerender(<C />)
      expect(screen.getByTestId('message-a-len')).toBeInTheDocument()

      openThreadB(rerender)
      expect(screen.queryByTestId('message-a-len')).toBeNull()

      // A's resumed reply finishes behind B.
      act(() => {
        onFinishA({
          message: { id: 'a-len', role: 'assistant', parts: [{ type: 'text', text: 'partial answer, done' }], metadata: {} },
          isAbort: false,
        })
      })
      h.routeParams.threadId = 'thread-1'
      h.chatState.messages = []
      rerender(<C />)
      expect(screen.queryByTestId('message-a-len')).toBeNull()
    })

    it("does not show its context-limit banner on the open thread", () => {
      h.modelProviderState.selectedProvider = 'llamacpp'
      const { rerender } = renderComponent()
      const onFinishA = (h as any).capturedOnFinish
      openThreadB(rerender)

      act(() => {
        onFinishA({
          message: {
            id: 'a-len',
            role: 'assistant',
            parts: [{ type: 'text', text: 'partial answer' }],
            metadata: {
              finishReason: 'length',
              usage: { inputTokens: 30000, outputTokens: 4000 },
            },
          },
          isAbort: false,
          isError: false,
        })
      })

      expect(screen.queryByText('Increase Context Size')).toBeNull()
      // Stamped on its own thread instead, which shows it on return.
      const stamped = h.messagesState.updateMessage.mock.calls
        .map((c: any[]) => c[0])
        .find((m: any) => m.metadata?.contextError)
      expect(stamped?.id).toBe('u1')
    })
  })

  describe('empty replies (#9228)', () => {
    beforeEach(() => {
      useMessageErrors.getState().clearAll()
    })

    const finishEmpty = (extra: Record<string, unknown> = {}) =>
      (h as any).capturedOnFinish({
        message: {
          id: 'a-empty',
          role: 'assistant',
          parts: [],
          metadata: { finishReason: 'stop' },
        },
        isAbort: false,
        isError: false,
        ...extra,
      })

    it('pins the error on the user turn, which is persisted', () => {
      // The empty assistant reply is never saved, so an error keyed to it
      // would vanish on reload; the user message survives and is hydrated.
      renderComponent()
      act(() => {
        finishEmpty()
      })
      const err = useMessageErrors.getState().errors['u1']
      expect(err).toBeTruthy()
      expect(err).not.toContain(':')
      expect(useMessageErrors.getState().errors['a-empty']).toBeUndefined()
    })

    it('persists the empty-reply error into the user turn metadata', () => {
      const u1 = {
        id: 'u1',
        role: 'user',
        content: [{ type: 'text', text: { value: 'hi', annotations: [] } }],
        metadata: {},
      }
      h.messagesState.messages = { 'thread-1': [u1] }
      h.messagesState.getMessages = vi.fn(() => [u1])
      renderComponent()
      act(() => {
        finishEmpty()
      })
      const persisted = h.messagesState.updateMessage.mock.calls
        .map((c: any[]) => c[0])
        .find((m: any) => m.id === 'u1' && m.metadata?.error)
      expect(persisted?.metadata.error).toBe(
        useMessageErrors.getState().errors['u1']
      )
    })

    it('does not flag a reply the user stopped', () => {
      renderComponent()
      act(() => {
        finishEmpty({ isAbort: true })
      })
      expect(useMessageErrors.getState().errors['a-empty']).toBeUndefined()
    })

    // Stopped right after the tool call started, before any input arrived: the
    // turn has nothing worth persisting, but its live card must not stay
    // "Running".
    it('settles a live tool call stopped before it had any input', () => {
      renderComponent()
      h.mockSetChatMessages.mockClear()
      act(() => {
        ;(h as any).capturedOnFinish({
          message: {
            id: 'a-early',
            role: 'assistant',
            parts: [{ type: 'tool-fetch', toolCallId: 'tcE', state: 'input-streaming' }],
            metadata: {},
          },
          isAbort: true,
          isError: false,
        })
      })
      const updater = h.mockSetChatMessages.mock.calls
        .map((c: any[]) => c[0])
        .find((a: unknown) => typeof a === 'function')
      // The open thread's own last message is still mid-call; it is not the
      // aborted turn, so it must be left alone.
      const other = {
        id: 'a-other',
        role: 'assistant',
        parts: [{ type: 'tool-fetch', toolCallId: 'tcO', state: 'input-available' }],
      }
      const live = [
        {
          id: 'a-early',
          role: 'assistant',
          parts: [{ type: 'tool-fetch', toolCallId: 'tcE', state: 'input-streaming' }],
        },
        other,
      ]
      const out = updater(live)
      expect(out[0].parts[0]).toMatchObject({ state: 'output-error' })
      expect(out[1]).toBe(other)
    })
  })

  describe('context overflow banner (#9228)', () => {
    it('does not offer a no-op Increase Context Size for a cloud overflow', () => {
      h.modelProviderState.selectedProvider = 'anthropic'
      h.chatState.status = 'error'
      h.chatState.error = new Error(
        'input length and `max_tokens` exceed context limit: 188240 + 21333 > 200000'
      )
      h.chatState.messages = [
        { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
      ]
      renderComponent()
      expect(screen.getByText('Model ran out of context size')).toBeInTheDocument()
      expect(screen.queryByText('Increase Context Size')).toBeNull()
      // The provider's own text says what to cut; the generic string hid it.
      expect(
        screen.getByText(/188240 \+ 21333 > 200000/)
      ).toBeInTheDocument()
      // Regenerate would re-send the same oversized prompt.
      expect(screen.queryByText('Regenerate')).toBeNull()
    })

    it('offers Increase Context Size for a llamacpp overflow', () => {
      h.modelProviderState.selectedProvider = 'llamacpp'
      h.chatState.status = 'error'
      h.chatState.error = new Error(
        'request (518 tokens) exceeds the available context size (512 tokens)'
      )
      h.chatState.messages = [
        { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
      ]
      renderComponent()
      expect(screen.getByText('Increase Context Size')).toBeInTheDocument()
    })
  })

  it('delete removes message from store and chat list', () => {
    h.chatState.messages = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
    ]
    renderComponent()
    screen.getByTestId('del-u1').click()
    expect(h.messagesState.deleteMessage).toHaveBeenCalledWith('thread-1', 'u1')
    expect(h.mockSetChatMessages).toHaveBeenCalled()
  })

  it('shows PromptProgress while status is submitted', () => {
    h.chatState.status = 'submitted'
    renderComponent()
    expect(screen.getByTestId('prompt-progress')).toBeInTheDocument()
  })

  it('processes an initial message from sessionStorage on mount', async () => {
    sessionStorage.setItem(
      'initial-message-thread-1',
      JSON.stringify({ text: 'hello from storage' })
    )
    renderComponent()
    await waitFor(() => {
      expect(h.mockSendMessage).toHaveBeenCalled()
    })
    expect(sessionStorage.getItem('initial-message-thread-1')).toBeNull()
  })

  it('clears queue on unmount', () => {
    const { unmount } = renderComponent()
    unmount()
    expect(h.messageQueueState.clearQueue).toHaveBeenCalledWith('thread-1')
  })
})
