/**
 * Runs a chat turn on DeepSeek Harness (DSH) instead of the built-in agent
 * loop. DSH owns the loop, tools and compaction; this transport sends the new
 * user text over DSH's SDK JSON-RPC and maps its session events onto AI SDK UI
 * chunks, so the normal chat view renders the reply.
 *
 * Tools DSH runs are marked `providerExecuted`: the SDK then neither calls
 * `onToolCall` nor auto-resubmits, so the page never runs them a second time.
 */
import type { UIMessage, UIMessageChunk } from 'ai'
import type { z } from 'zod'
import { findSessionByModel } from '@janhq/tauri-plugin-llamacpp-api'
import { useServiceStore } from '@/hooks/useServiceHub'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useDshSettings } from '@/hooks/useDshSettings'
import { providerRemoteApiKeyChain } from '@/lib/provider-api-keys'
import type { DshLaunch, DshService } from '@/services/dsh/types'
import { CustomChatTransport } from '@/lib/custom-chat-transport'
import {
  DshTurnMapper,
  EventParams,
  Notification,
  Response,
  StatusParams,
} from '@/lib/dsh-protocol'

/** Text the user typed in the last message, which is all DSH needs: it keeps the history. */
function lastUserText(messages: UIMessage[]): string {
  const last = [...messages].reverse().find((m) => m.role === 'user')
  return (last?.parts ?? [])
    .map((p) => (p.type === 'text' ? p.text : ''))
    .join('')
    .trim()
}

/**
 * The endpoint the thread's selected model is served at, as DSH needs it: an
 * OpenAI-compatible base URL plus key. A local model is started first.
 */
async function resolveEndpoint(): Promise<
  Pick<DshLaunch, 'baseUrl' | 'apiKey' | 'model'>
> {
  const { selectedModel, selectedProvider, getProviderByName } =
    useModelProvider.getState()
  const modelId = selectedModel?.id
  if (!modelId) throw new Error('Pick a model before chatting with DeepSeek Harness.')
  const provider = getProviderByName(selectedProvider)
  if (!provider) throw new Error(`Provider ${selectedProvider} is not set up.`)

  if (provider.provider === 'llamacpp') {
    const hub = useServiceStore.getState().serviceHub
    await hub?.models().startModel(provider, modelId)
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
 * One runtime process serves every DSH chat, so frames are demultiplexed here
 * by session id. Requests are matched to responses by JSON-RPC id.
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
  /**
   * Fresh per runtime: DSH refuses a session id that already has a log on disk
   * from an earlier process ("id collision"), so each run gets its own ids.
   */
  epoch = ''
  private subscribed: Promise<void> | null = null

  constructor(private readonly service: () => DshService) {}

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
    if (note.success && sessionId)
      this.sessionListeners.get(sessionId)?.(note.data)
  }

  private onExit(stderr: string) {
    const error = new Error(
      `DeepSeek Harness stopped.${stderr ? `\n${stderr.split('\n').slice(-6).join('\n')}` : ''}`
    )
    for (const waiter of this.pending.values()) waiter.reject(error)
    this.pending.clear()
    this.initialized = null
    this.launch = null
    for (const listener of this.exitListeners) listener(stderr)
  }

  private request(method: string, params?: unknown): Promise<unknown> {
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
      this.launch !== null &&
      JSON.stringify(this.launch) === JSON.stringify(launch)
    if (!same) {
      this.initialized = null
      await this.service().start(launch)
      this.launch = launch
    }
    this.initialized ??= (async () => {
      this.epoch = Date.now().toString(36)
      await this.request('initialize', {
        cwd: launch.cwd,
        provider: 'deepseek-official',
        model: launch.model,
      })
    })().catch((e) => {
      this.initialized = null
      throw e
    })
    return this.initialized
  }

  prompt(sessionId: string, text: string): Promise<unknown> {
    return this.request('session/prompt', {
      sessionId,
      contentBlocks: [{ type: 'text', text }],
    })
  }

  listen(
    sessionId: string,
    cb: (note: z.infer<typeof Notification>) => void
  ): () => void {
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

  async stop(): Promise<void> {
    await this.service().stop()
  }
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

/**
 * Extends the built-in transport only so the chat hooks keep their API
 * (instructions, tool refresh, token usage); every turn goes to DSH.
 */
export class DshChatTransport extends CustomChatTransport {
  /** DSH keeps one session per thread for the life of its runtime. */
  private dshSessionId(chatId: string, epoch: string) {
    return `${this.threadId ?? chatId}~${epoch}`
  }

  override async sendMessages(
    options: Parameters<CustomChatTransport['sendMessages']>[0]
  ): Promise<ReadableStream<UIMessageChunk>> {
    const text = lastUserText(options.messages)
    if (!text) throw new Error('DeepSeek Harness needs a text message.')
    const settings = useDshSettings.getState()
    if (!settings.root.trim())
      throw new Error('Set the harness folder in Settings › DeepSeek Harness.')

    const endpoint = await resolveEndpoint()
    const conn = getConnection()
    await conn.ensure({
      root: settings.root.trim(),
      cwd: settings.workspace.trim(),
      systemPrompt: this.systemMessage ?? '',
      ...endpoint,
    })
    const sessionId = this.dshSessionId(options.chatId, conn.epoch)

    let unlisten = () => {}
    let unexit = () => {}
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
        const mapper = new DshTurnMapper((chunk) => {
          if (!closed) controller.enqueue(chunk)
        })
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
          if (
            note.method !== 'session.status' ||
            !status.success ||
            status.data.status !== 'idle'
          )
            return
          if (turnError && !mapper.hasStarted) return fail(turnError)
          if (turnError) controller.enqueue({ type: 'error', errorText: turnError })
          if (!closed)
            controller.enqueue({
              type: 'finish',
              messageMetadata: { usage: mapper.usage },
            })
          close()
        })
        unexit = conn.onRuntimeExit((stderr) =>
          fail(`DeepSeek Harness stopped.${stderr ? `\n${stderr.split('\n').slice(-6).join('\n')}` : ''}`)
        )

        // The SDK wire has no cancel: stopping a turn stops the runtime. The
        // next message starts a fresh one.
        options.abortSignal?.addEventListener('abort', () => {
          if (closed) return
          closed = true
          cleanup()
          void conn.stop()
          controller.close()
        })

        conn.prompt(sessionId, text).catch((e) =>
          fail(e instanceof Error ? e.message : String(e))
        )
      },
      cancel: () => cleanup(),
    })
  }

}
