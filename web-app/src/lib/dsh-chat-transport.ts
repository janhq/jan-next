/**
 * Every chat turn runs on DeepSeek Harness (DSH). DSH owns the agent loop,
 * tools, MCP and compaction; this transport sends the user's turn over DSH's
 * SDK JSON-RPC and maps its session events onto AI SDK UI chunks, so the chat
 * view renders the reply.
 *
 * Tools DSH runs are marked `providerExecuted`: the SDK then neither calls
 * `onToolCall` nor auto-resubmits, so the page never runs them a second time.
 */
import {
  generateId,
  type ChatTransport,
  type LanguageModelUsage,
  type UIMessage,
  type UIMessageChunk,
} from 'ai'
import type { z } from 'zod'
import { findSessionByModel } from '@janhq/tauri-plugin-llamacpp-api'
import { useServiceStore } from '@/hooks/useServiceHub'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useDshSettings } from '@/hooks/useDshSettings'
import { useThreads } from '@/hooks/useThreads'
import { useAppState } from '@/hooks/useAppState'
import { providerRemoteApiKeyChain } from '@/lib/provider-api-keys'
import { describeEngineError } from '@/lib/engineError'
import type { DshLaunch, DshService } from '@/services/dsh/types'
import {
  DshTurnMapper,
  EventParams,
  InteractionParams,
  Notification,
  PolicyParams,
  Response,
  StatusParams,
  WithdrawnParams,
} from '@/lib/dsh-protocol'
import {
  effectivePolicy,
  resolveThreadFolder,
  setThreadWork,
  threadWorkOf,
  type EditPolicy,
} from '@/lib/threadWork'
import {
  useDshInteractions,
  type AskAnswer,
} from '@/stores/dsh-interaction-store'

/** The provider and model a turn runs on. */
export type ModelSelection = {
  selectedProvider: string
  selectedModel: Model | null
}

/** Partial assistant output a stopped turn resumes from. */
export type ContinuationContent = {
  text?: string
  reasoning?: string
}

export type TokenUsageCallback = (
  usage: LanguageModelUsage,
  messageId: string
) => void

type HistoryTurn = { role: 'user' | 'assistant'; text: string }
type PromptBlock =
  | { type: 'text'; text: string }
  | { type: 'image-data'; mediaType: string; data: string; name?: string }

const IMAGE_TYPES: Record<string, true> = {
  'image/png': true,
  'image/jpeg': true,
  'image/webp': true,
  'image/gif': true,
}

function textOf(message: UIMessage): string {
  return message.parts
    .map((p) => (p.type === 'text' ? p.text : ''))
    .join('')
    .trim()
}

/** The user turn as DSH content blocks; images ride along as base64. */
function promptBlocks(message: UIMessage): PromptBlock[] {
  const blocks: PromptBlock[] = []
  const text = textOf(message)
  if (text) blocks.push({ type: 'text', text })
  for (const part of message.parts) {
    if (part.type !== 'file') continue
    if (!IMAGE_TYPES[part.mediaType]) {
      throw new Error(
        `DeepSeek Harness takes images only; ${part.mediaType} cannot be sent.`
      )
    }
    const data = part.url.slice(part.url.indexOf(',') + 1)
    blocks.push({
      type: 'image-data',
      mediaType: part.mediaType,
      data,
      ...(part.filename ? { name: part.filename } : {}),
    })
  }
  return blocks
}

/** Earlier turns as plain text, for seeding a fresh DSH session. */
function historyOf(messages: UIMessage[]): HistoryTurn[] {
  return messages.flatMap((m): HistoryTurn[] => {
    if (m.role !== 'user' && m.role !== 'assistant') return []
    const text = textOf(m)
    return text ? [{ role: m.role, text }] : []
  })
}

/** Sampling the thread's assistant asks for, in DSH's option names. */
function samplingOf(threadId: string | undefined) {
  const thread = threadId ? useThreads.getState().threads[threadId] : undefined
  const assistant = thread?.assistants?.[0]
  const params =
    assistant && assistant.id !== 'model-only' ? (assistant.parameters ?? {}) : {}
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
  const options = {
    temperature: num(params.temperature),
    topP: num(params.top_p),
    maxTokens: num(params.max_tokens),
  }
  return Object.values(options).some((v) => v !== undefined) ? options : undefined
}

/**
 * The endpoint a model is served at, as DSH needs it: an OpenAI-compatible
 * base URL plus key. A local model is started first.
 */
export async function resolveEndpoint(
  selection: ModelSelection,
  threadId: string
): Promise<Pick<DshLaunch, 'baseUrl' | 'apiKey' | 'model'>> {
  const modelId = selection.selectedModel?.id
  if (!modelId) throw new Error('Pick a model before chatting.')
  const provider = useModelProvider
    .getState()
    .getProviderByName(selection.selectedProvider)
  if (!provider) throw new Error(`Provider ${selection.selectedProvider} is not set up.`)

  if (provider.provider === 'llamacpp') {
    const app = useAppState.getState()
    app.updateLoadingModel(true)
    app.updateThreadLoadingModel(threadId, true)
    try {
      await useServiceStore.getState().serviceHub?.models().startModel(provider, modelId)
    } catch (error) {
      // The engine rejects with a structured object, which the chat would
      // otherwise print as "[object Object]". The wrapper keeps it as `cause`
      // so the load report can still read its diagnostics.
      const wrapped = new Error(describeEngineError(error)) as Error & { cause?: unknown }
      wrapped.cause = error
      throw wrapped
    } finally {
      app.updateLoadingModel(false)
      app.updateThreadLoadingModel(threadId, false)
    }
    const session = await findSessionByModel(modelId)
    if (!session) throw new Error(`${modelId} did not start.`)
    return {
      baseUrl: `http://127.0.0.1:${session.port}/v1`,
      apiKey: session.api_key,
      model: modelId,
    }
  }
  if (!provider.base_url) throw new Error(`${provider.provider} has no base URL.`)
  return {
    baseUrl: provider.base_url,
    apiKey: providerRemoteApiKeyChain(provider)[0] ?? '',
    model: modelId,
  }
}

/**
 * One runtime process serves every chat, so frames are demultiplexed here by
 * session id. Requests are matched to responses by JSON-RPC id.
 */
class DshConnection {
  private nextId = 1
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >()
  private sessionListeners = new Map<
    string,
    (note: z.infer<typeof Notification>) => void
  >()
  private exitListeners = new Set<(stderr: string) => void>()
  private initialized: Promise<void> | null = null
  private launch: DshLaunch | null = null
  private subscribed: Promise<void> | null = null

  constructor(private readonly service: () => DshService) { }

  private subscribe(): Promise<void> {
    this.subscribed ??= (async () => {
      await this.service().onFrame((frame) => this.onFrame(frame))
      await this.service().onExit((stderr) => this.onExit(stderr))
    })()
    return this.subscribed
  }

  private onFrame(frame: Record<string, unknown>) {
    if (!('method' in frame)) {
      const response = Response.safeParse(frame)
      if (!response.success) return
      const waiter = this.pending.get(response.data.id)
      if (!waiter) return
      this.pending.delete(response.data.id)
      const { error, result } = response.data
      if (error) waiter.reject(new Error(error.message ?? 'DSH request failed'))
      else waiter.resolve(result)
      return
    }
    const note = Notification.safeParse(frame)
    const sessionId = note.success ? note.data.params.sessionId : undefined
    if (!note.success || !sessionId) return
    if (this.onInteraction(note.data.method, sessionId, note.data.params)) return
    this.sessionListeners.get(sessionId)?.(note.data)
  }

  /** Questions, approvals and policy changes belong to the thread, not one turn. */
  private onInteraction(method: string, sessionId: string, params: unknown) {
    const threadId = threadOfSession(sessionId)
    if (method === 'interaction.request') {
      const parsed = InteractionParams.safeParse(params)
      if (parsed.success) useDshInteractions.getState().add(threadId, parsed.data)
      return true
    }
    if (method === 'interaction.withdrawn') {
      const parsed = WithdrawnParams.safeParse(params)
      if (parsed.success) useDshInteractions.getState().remove(parsed.data.requestId)
      return true
    }
    if (method === 'session.policy') {
      const parsed = PolicyParams.safeParse(params)
      if (parsed.success) setThreadWork(threadId, { editPolicy: parsed.data.policy })
      return true
    }
    return false
  }

  private onExit(stderr: string) {
    const error = new Error(`DeepSeek Harness stopped.${stderrTail(stderr)}`)
    for (const waiter of this.pending.values()) waiter.reject(error)
    this.pending.clear()
    this.initialized = null
    this.launch = null
    useDshInteractions.getState().clearAll()
    for (const listener of this.exitListeners) listener(stderr)
  }

  get running() {
    return this.initialized !== null
  }

  request(method: string, params?: unknown): Promise<unknown> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.service()
        .send({ jsonrpc: '2.0', id, method, params })
        .catch((e) => {
          this.pending.delete(id)
          reject(e instanceof Error ? e : new Error(String(e)))
        })
    })
  }

  /** Starts (or reuses) the runtime for `launch` and completes the handshake. */
  async ensure(launch: DshLaunch): Promise<void> {
    await this.subscribe()
    const same =
      this.launch !== null && JSON.stringify(this.launch) === JSON.stringify(launch)
    if (!same) {
      this.initialized = null
      await this.service().start(launch)
      this.launch = launch
    }
    this.initialized ??= (async () => {
      await this.request('initialize', {
        cwd: launch.cwd,
        provider: 'app',
        model: launch.model,
      })
    })().catch((e) => {
      this.initialized = null
      throw e
    })
    return this.initialized
  }

  listen(sessionId: string, cb: (note: z.infer<typeof Notification>) => void) {
    this.sessionListeners.set(sessionId, cb)
    return () => {
      if (this.sessionListeners.get(sessionId) === cb)
        this.sessionListeners.delete(sessionId)
    }
  }

  onRuntimeExit(cb: (stderr: string) => void): () => void {
    this.exitListeners.add(cb)
    return () => this.exitListeners.delete(cb)
  }
}

function stderrTail(stderr: string) {
  return stderr ? `\n${stderr.split('\n').slice(-6).join('\n')}` : ''
}

let connection: DshConnection | null = null
function getConnection(): DshConnection {
  connection ??= new DshConnection(() => {
    const hub = useServiceStore.getState().serviceHub
    if (!hub) throw new Error('Services are not ready yet.')
    return hub.dsh()
  })
  return connection
}

/** Session ids are `<threadId>~<suffix>`; the thread owns its cards. */
function threadOfSession(sessionId: string) {
  const cut = sessionId.indexOf('~')
  return cut === -1 ? sessionId : sessionId.slice(0, cut)
}

/** The live DSH session of a thread, when its runtime is up. */
function liveSessionOf(threadId: string): string | undefined {
  return connection?.running ? linkOf(threadId)?.id : undefined
}

/** Answers a question card; DSH resumes the waiting tool call. */
export function answerQuestion(requestId: string, answers: AskAnswer[]) {
  useDshInteractions.getState().remove(requestId)
  return dshRequest('interaction/answer', { requestId, answer: { answers } })
}

/** `always` also switches the thread to auto, which DSH reports back. */
export function answerApproval(requestId: string, outcome: 'allow' | 'deny' | 'always') {
  useDshInteractions.getState().remove(requestId)
  return dshRequest('interaction/answer', { requestId, answer: { outcome } })
}

/** Saves the thread's policy and applies it to a live session at once. */
export function setThreadPolicy(threadId: string, policy: EditPolicy) {
  setThreadWork(threadId, { editPolicy: policy })
  const sessionId = liveSessionOf(threadId)
  if (sessionId) void dshRequest('session/policy', { sessionId, policy }).catch(() => { })
}

/** Saves plan mode; a live session switches at its next step. */
export function setThreadPlanMode(threadId: string, active: boolean) {
  setThreadWork(threadId, { planMode: active })
  const sessionId = liveSessionOf(threadId)
  if (sessionId) void dshRequest('session/plan', { sessionId, active }).catch(() => { })
}

/** One JSON-RPC request to the running runtime; rejects when none runs. */
export function dshRequest(method: string, params?: unknown): Promise<unknown> {
  const conn = getConnection()
  if (!conn.running) return Promise.reject(new Error('DeepSeek Harness is not running.'))
  return conn.request(method, params)
}

/**
 * What a thread's DSH session already holds: the UI message ids it has seen,
 * in order. Kept in thread metadata so a restart resumes the same session.
 */
type DshSessionLink = { id: string; messageIds: string[] }

function linkOf(threadId: string): DshSessionLink | undefined {
  const link = useThreads.getState().threads[threadId]?.metadata?.dshSession
  return link && typeof link === 'object' ? (link as DshSessionLink) : undefined
}

function saveLink(threadId: string, link: DshSessionLink) {
  const thread = useThreads.getState().threads[threadId]
  if (!thread) return
  useThreads.getState().updateThread(threadId, {
    metadata: { ...(thread.metadata ?? {}), dshSession: link },
  })
}

const sameIds = (a: string[], b: string[]) =>
  a.length === b.length && a.every((id, i) => id === b[i])

export class DshChatTransport implements ChatTransport<UIMessage> {
  private systemMessage?: string
  private readonly threadId?: string
  private onTokenUsage?: TokenUsageCallback
  private continueFrom: ContinuationContent | null = null
  private turnModelSelection: ModelSelection | null = null

  constructor(systemMessage?: string, threadId?: string) {
    this.systemMessage = systemMessage
    this.threadId = threadId
  }

  updateSystemMessage(systemMessage: string | undefined) {
    this.systemMessage = systemMessage
  }

  setOnTokenUsage(callback: TokenUsageCallback | undefined) {
    this.onTokenUsage = callback
  }

  /** The model of this transport's current (or last) turn, if one has run. */
  getTurnModelSelection(): ModelSelection | null {
    return this.turnModelSelection
  }

  /** The next turn continues this partial reply instead of answering anew. */
  setContinueFromContent(content: string | ContinuationContent) {
    const normalized = typeof content === 'string' ? { text: content } : content
    this.continueFrom = normalized.text || normalized.reasoning ? normalized : null
  }

  async sendMessages(
    options: Parameters<ChatTransport<UIMessage>['sendMessages']>[0]
  ): Promise<ReadableStream<UIMessageChunk>> {
    const threadId = this.threadId ?? options.chatId
    const settings = useDshSettings.getState()
    if (!settings.root.trim())
      throw new Error('Set the harness folder in Settings › DeepSeek Harness.')

    let lastUserIndex = options.messages.length - 1
    while (lastUserIndex >= 0 && options.messages[lastUserIndex].role !== 'user') lastUserIndex--
    if (lastUserIndex === -1) throw new Error('There is no message to answer.')
    const userMessage = options.messages[lastUserIndex]
    const prior = options.messages.slice(0, lastUserIndex)

    // A continuation replays the stopped partial as the reply so far and asks
    // DSH to carry on; DSH has no assistant prefill.
    const continueFrom = this.continueFrom
    this.continueFrom = null
    const blocks = continueFrom
      ? [{ type: 'text' as const, text: 'Continue your previous reply exactly where it stopped. Do not repeat what you already wrote.' }]
      : promptBlocks(userMessage)
    if (blocks.length === 0) throw new Error('The message is empty.')

    const selection = useModelProvider.getState()
    this.turnModelSelection = {
      selectedProvider: selection.selectedProvider,
      selectedModel: selection.selectedModel,
    }
    const endpoint = await resolveEndpoint(this.turnModelSelection, threadId)
    const conn = getConnection()
    await conn.ensure({
      root: settings.root.trim(),
      cwd: settings.workspace.trim(),
      ...endpoint,
    })

    // DSH keeps the conversation itself. It is reused only while it holds
    // exactly what the UI shows before this turn; an edit, regenerate, branch
    // switch or continuation starts a fresh session seeded with the visible
    // history instead.
    const priorIds = prior.map((m) => m.id)
    const link = linkOf(threadId)
    const reuse =
      !continueFrom &&
      options.trigger === 'submit-message' &&
      link !== undefined &&
      sameIds(link.messageIds, priorIds)
    const history = continueFrom
      ? [
        ...historyOf([...prior, userMessage]),
        {
          role: 'assistant' as const,
          text: [continueFrom.reasoning, continueFrom.text].filter(Boolean).join('\n\n'),
        },
      ]
      : historyOf(prior)
    const sessionId = reuse ? link.id : `${threadId}~${generateId()}`
    const responseId = generateId()
    // A new session is created in the thread's folder; a reused one keeps its own.
    const thread = useThreads.getState().threads[threadId]
    const work = threadWorkOf(thread)
    const cwd = reuse ? undefined : await resolveThreadFolder(threadId, work)
    const editPolicy = effectivePolicy(work, settings.workspace.trim())

    let unlisten = () => { }
    let unexit = () => { }
    const cleanup = () => {
      unlisten()
      unexit()
    }

    return new ReadableStream<UIMessageChunk>({
      start: (controller) => {
        let closed = false
        const close = () => {
          if (closed) return
          closed = true
          cleanup()
          controller.close()
        }
        const fail = (message: string) => {
          if (closed) return
          controller.enqueue({ type: 'error', errorText: message })
          close()
        }
        const mapper = new DshTurnMapper(
          responseId,
          (chunk) => {
            if (!closed) controller.enqueue(chunk)
          },
          // Approving a plan turns plan mode off inside DSH; the chip follows.
          (active) => setThreadWork(threadId, { planMode: active })
        )
        // The continued reply keeps the partial in front of what follows.
        if (continueFrom) mapper.prefill(continueFrom)
        let turnError: string | undefined

        unlisten = conn.listen(sessionId, (note) => {
          if (note.method === 'session.event') {
            const parsed = EventParams.safeParse(note.params)
            if (!parsed.success) return
            const error = mapper.handle(parsed.data.event)
            if (error) turnError = error
            return
          }
          const status = StatusParams.safeParse(note.params)
          if (note.method !== 'session.status' || !status.success || status.data.status !== 'idle')
            return
          if (turnError && !mapper.hasStarted) return fail(turnError)
          if (turnError) controller.enqueue({ type: 'error', errorText: turnError })
          if (closed) return
          const usage = mapper.usage
          controller.enqueue({
            type: 'finish',
            finishReason: mapper.finishReason,
            // totalTokens is what the composer's context meter reads; without
            // it the meter stays at 0% however long the chat gets.
            messageMetadata: {
              usage: { ...usage, totalTokens: usage.inputTokens + usage.outputTokens },
              finishReason: mapper.finishReason,
            },
          })
          if (!turnError) {
            saveLink(threadId, {
              id: sessionId,
              messageIds: [...priorIds, userMessage.id, responseId],
            })
          }
          this.onTokenUsage?.(
            {
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              totalTokens: usage.inputTokens + usage.outputTokens,
              inputTokenDetails: {
                noCacheTokens: undefined,
                cacheReadTokens: undefined,
                cacheWriteTokens: undefined,
              },
              outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
            },
            responseId
          )
          close()
        })
        unexit = conn.onRuntimeExit((stderr) =>
          fail(`DeepSeek Harness stopped.${stderrTail(stderr)}`)
        )

        // Stop cancels only this thread's turn; other chats keep running. The
        // session's state is unknown after a cut, so the next turn reseeds.
        options.abortSignal?.addEventListener('abort', () => {
          if (closed) return
          closed = true
          useDshInteractions.getState().clearThread(threadId)
          cleanup()
          void conn.request('session/cancel', { sessionId }).catch(() => { })
          saveLink(threadId, { id: sessionId, messageIds: [] })
          controller.close()
        })

        conn
          .request('session/prompt', {
            sessionId,
            contentBlocks: blocks,
            ...(this.systemMessage?.trim() ? { instructions: this.systemMessage } : {}),
            ...(reuse || history.length === 0 ? {} : { history }),
            ...(cwd ? { cwd } : {}),
            editPolicy,
            plan: work.planMode === true,
            ...(samplingOf(threadId) ? { options: samplingOf(threadId) } : {}),
          })
          .catch((e) => fail(e instanceof Error ? e.message : String(e)))
      },
      cancel: () => cleanup(),
    })
  }

  async reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
    return null
  }
}
