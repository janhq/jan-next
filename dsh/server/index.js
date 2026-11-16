/**
 * open-waifu's replacement for `@deepseek-ai/dsh-sdk-jsonrpc-server`.
 * Same wire for initialize / session/prompt / shutdown and every notification
 * (it subclasses the upstream server), plus session resume from disk,
 * `session/cancel`, `plugins/list`, per-session `instructions`, image blocks,
 * `history` seeding and `options.maxTokens`.
 *
 * Bare imports resolve through `<data>/dsh/node_modules`, a junction to the
 * deepseek-harness checkout's `examples/node_modules`, so this folder is
 * copied to `<data>/dsh/plugins/ow-server/` by the app.
 * stdout is the protocol channel: never log to it.
 */
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { HarnessSdkJsonRpcServer } from '@deepseek-ai/dsh-sdk-jsonrpc-server'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'

// dsh-sdk-protocol is a private dependency of the upstream server package, so
// resolve it from that package's own location rather than from ours.
const here = createRequire(import.meta.url)
const upstream = createRequire(here.resolve('@deepseek-ai/dsh-sdk-jsonrpc-server/package.json'))
const { JsonRpcLineTransport } = await import(pathToFileURL(upstream.resolve('@deepseek-ai/dsh-sdk-protocol')).href)

export const name = 'ow-server'
export const inject = ['agents']

// Mirror of cordis FiberState (const enum, not importable at runtime).
const PHASES = { 0: 'pending', 1: 'loading', 2: 'active', 3: 'failed', 5: 'unloading' }
const PERSONA_SECTION = 'deployment:persona'
const PERSONA_ORDER = 0

/** @typedef {{ role: 'user' | 'assistant', text: string }} HistoryTurn */

/** Tools that change files or run commands: gated by the edit policy and plan mode. */
// The shell tool is `pwsh` on Windows and `bash` elsewhere.
const MUTATING = new Set(['write', 'edit', 'bash', 'pwsh'])
const POLICIES = new Set(['ask', 'auto'])

class OpenWaifuServer extends HarnessSdkJsonRpcServer {
  /** Per-session creation inputs, read by createSession (which the base class calls with only the id). */
  #pending = new Map()
  /** Edit policy per root session id; absent means `ask`. */
  #policy = new Map()
  /** Questions and approvals waiting on the app, by request id. */
  #waiting = new Map()
  #nextRequest = 1

  async handleRequest(method, params) {
    switch (method) {
      case 'session/prompt':
        return this.#prompt(params)
      case 'session/cancel':
        return this.#cancel(params)
      case 'session/plan':
        return this.#plan(params)
      case 'session/policy':
        return this.#setPolicy(params)
      case 'interaction/answer':
        return this.#answer(params)
      case 'plugins/list':
        return this.#plugins()
      default:
        return super.handleRequest(method, params)
    }
  }

  /**
   * The chat a session belongs to. A subagent's session is a child of the
   * chat's session; its tool calls follow the chat's policy and its approvals
   * show in the chat.
   */
  rootOf(session) {
    const id = String(session.id)
    if (this.sessions.has(id)) return id
    const parent = session.header?.parentSession
    return parent === undefined ? id : String(parent)
  }

  policyOf(sessionId) {
    return this.#policy.get(sessionId) ?? 'ask'
  }

  planActive(agent) {
    const plan = this.ctx.get('planMode')
    if (!plan) return false
    const state = plan.get(agent)
    return state.pending ?? state.active
  }

  /**
   * Sends one question or approval to the app and waits for `interaction/answer`.
   * The tool call's signal withdraws it, so a stopped turn never leaves a card
   * that answers nothing.
   */
  ask(kind, sessionId, payload, signal) {
    const requestId = String(this.#nextRequest++)
    return new Promise((resolve, reject) => {
      const withdraw = () => {
        this.#waiting.delete(requestId)
        this.transport.notify('interaction.withdrawn', { sessionId, requestId })
        reject(new Error('withdrawn'))
      }
      if (signal?.aborted) return withdraw()
      signal?.addEventListener('abort', withdraw, { once: true })
      this.#waiting.set(requestId, (answer) => {
        signal?.removeEventListener('abort', withdraw)
        this.#waiting.delete(requestId)
        resolve(answer)
      })
      this.transport.notify('interaction.request', { sessionId, requestId, kind, ...payload })
    })
  }

  #answer(params) {
    const settle = this.#waiting.get(String(params.requestId))
    if (!settle) throw new Error(`no question is waiting under ${params.requestId}`)
    settle(params.answer)
    return {}
  }

  #plan(params) {
    const sessionId = String(params.sessionId)
    const plan = this.ctx.get('planMode')
    if (!plan) throw new Error('plan mode needs the plan-mode plugin enabled')
    const rec = this.sessions.get(sessionId)
    // The session starts with the next prompt, which carries `plan` itself.
    if (!rec) return { outcome: 'deferred' }
    return { outcome: plan.set(rec.handle.agent, params.active === true) }
  }

  #setPolicy(params) {
    const policy = String(params.policy)
    if (!POLICIES.has(policy)) throw new Error(`unknown edit policy ${policy}`)
    this.#policy.set(String(params.sessionId), policy)
    return {}
  }

  async #prompt(params) {
    const sessionId = String(params.sessionId)
    if (POLICIES.has(params.editPolicy)) this.#policy.set(sessionId, params.editPolicy)
    this.#pending.set(sessionId, {
      instructions: typeof params.instructions === 'string' ? params.instructions : '',
      history: Array.isArray(params.history) ? params.history : [],
      options: params.options ?? {},
      cwd: typeof params.cwd === 'string' && params.cwd !== '' ? params.cwd : undefined,
    })
    try {
      const rec = await this.getOrCreateSession(sessionId)
      if (this.ctx.agents.get(rec.handle.agent.id) !== rec.handle.agent) {
        throw new Error(`session agent was disposed outside the server: ${sessionId}`)
      }
      // A fresh session takes the thread's plan state before its first step.
      if (typeof params.plan === 'boolean') this.ctx.get('planMode')?.set(rec.handle.agent, params.plan)
      const content = await this.#blocks(params.contentBlocks ?? [])
      const message = createUserMessage({ content, source: { kind: 'user' } })
      rec.handle.agent.followup(message)
      return { messageId: message.id }
    } finally {
      this.#pending.delete(sessionId)
    }
  }

  async #blocks(blocks) {
    const out = []
    for (const block of blocks) {
      if (block?.type !== 'image-data') {
        out.push(block)
        continue
      }
      // ctx.get: the store is optional in a user's composition.
      const store = this.ctx.get('attachments')
      if (!store) throw new Error('image input needs the attachment-local plugin enabled')
      const attachment = await store.saveImage({
        data: Buffer.from(String(block.data), 'base64'),
        mediaType: block.mediaType,
        ...(block.name ? { name: String(block.name) } : {}),
      })
      out.push({ type: 'image', attachment })
    }
    return out
  }

  #cancel(params) {
    const rec = this.sessions.get(String(params.sessionId))
    // A session that is not live has nothing running; cancelling it is a no-op.
    if (rec) rec.handle.agent.cancel({ kind: 'user' })
    return {}
  }

  #plugins() {
    const loader = this.ctx.get('loader')
    const entries = []
    for (const entry of loader?.entries() ?? []) {
      // Loader-internal rows (the root include) are not user plugins.
      if (entry.options.group || entry.options.name.startsWith('cordis:')) continue
      entries.push({
        // Rows from cordis.yml are namespaced by the root include entry.
        id: entry.id.replace(/^include:/, ''),
        name: entry.options.name,
        enabled: !entry.disabled,
        phase: entry.fiber === undefined ? null : (PHASES[entry.fiber.state] ?? null),
      })
    }
    return { entries }
  }

  async createSession(sessionId) {
    const input = this.#pending.get(sessionId) ?? { instructions: '', history: [], options: {} }
    const cwd = input.cwd ?? this.cwd
    const agentOptions = {
      provider: this.provider,
      model: this.model,
      ...(input.options.maxTokens ?? this.maxTokens) === undefined
        ? {}
        : { maxTokens: input.options.maxTokens ?? this.maxTokens },
    }
    // Scoped section shadows the composition's global persona for this agent only.
    const setup = input.instructions.trim() === ''
      ? undefined
      : (agentCtx) => {
        agentCtx.systemPrompt.section({
          name: PERSONA_SECTION,
          order: PERSONA_ORDER,
          text: input.instructions,
        })
      }
    const persistence = this.ctx.get('sessionPersistence')
    const onDisk = persistence !== undefined
      && (await persistence.list()).some(header => String(header.id) === sessionId)
    const handle = onDisk
      ? await this.ctx.agents.resume({
        resumeSessionId: SessionId(sessionId),
        agentOptions,
        ...(setup ? { setup } : {}),
      })
      : await this.ctx.agents.create({
        sessionId: SessionId(sessionId),
        meta: { cwd },
        ...(input.history.length > 0 ? { seed: this.#seed(input.history) } : {}),
        agentOptions,
        ...(setup ? { setup } : {}),
      })
    const rec = { handle }
    this.sessions.set(sessionId, rec)
    return rec
  }

  /** Prior turns as completed turns, so the model sees them as real history. */
  #seed(history) {
    const events = []
    const time = Date.now()
    // Message events must carry the surface marker or the session rejects the seed.
    const surface = new Set(['user/message', 'assistant/message'])
    const push = (type, data) => events.push({
      type,
      seq: events.length,
      time,
      data,
      ...(surface.has(type) ? { surfaceOp: 'append' } : {}),
    })
    let turn = 0
    for (let i = 0; i < history.length; i++) {
      const item = history[i]
      if (item.role !== 'user') continue
      const reply = history[i + 1]?.role === 'assistant' ? history[i + 1] : undefined
      turn += 1
      push('turn/start', { turn })
      push('user/message', createUserMessage({ content: [{ type: 'text', text: item.text }], source: { kind: 'user' } }))
      if (reply) {
        push('step/start', { turn, step: 1 })
        push('assistant/message', {
          turn,
          step: 1,
          message: createAssistantMessage({
            content: [{ type: 'text', text: reply.text }],
            source: { provider: this.provider, model: this.model },
          }),
        })
        push('step/end', { turn, step: 1 })
        i += 1
      }
      push('turn/end', { turn, reason: { kind: 'completed' } })
    }
    return events
  }
}

export function apply(ctx, config) {
  const maxTokensAsSuccess = config?.maxTokensAsSuccess ?? true
  const rootFiber = ctx.root.fiber
  const input = config?.input ?? process.stdin
  const output = config?.output ?? process.stdout
  const exit = config?.exit ?? ((code) => { process.exit(code) })

  const transport = new JsonRpcLineTransport(input, output)
  const server = new OpenWaifuServer(ctx, transport, { maxTokensAsSuccess })

  // Plan mode forbids changes outright; otherwise `ask` routes write, edit and
  // bash through ctx.approval (answered below), `auto` lets them run.
  ctx.on('tools/pre-execute', (exec, next) => {
    if (!MUTATING.has(exec.name) || exec.agent === undefined) return next()
    if (server.planActive(exec.agent)) {
      return Promise.resolve({ kind: 'deny', reason: `plan mode is on: ${exec.name} is not allowed until the user approves a plan with exit_plan_mode` })
    }
    if (server.policyOf(server.rootOf(exec.agent.session)) === 'auto') return next()
    return Promise.resolve({ kind: 'ask' })
  })

  // "Allow all" switches the chat to auto, and the app is told so its chip follows.
  ctx.on('approval/request', async (request) => {
    const sessionId = server.rootOf(request.agent.session)
    try {
      const answer = await server.ask('approval', sessionId, {
        toolName: request.toolName,
        ...(request.callId === undefined ? {} : { callId: request.callId }),
        ...(request.reason === undefined ? {} : { reason: request.reason }),
      }, request.signal)
      if (answer?.outcome === 'always') {
        await server.handleRequest('session/policy', { sessionId, policy: 'auto' })
        transport.notify('session.policy', { sessionId, policy: 'auto' })
        return 'allowed-once'
      }
      return answer?.outcome === 'allow' ? 'allowed-once' : 'rejected'
    } catch {
      return 'cancelled'
    }
  })

  ctx.inject(['userQuestions'], (scope) => {
    scope.userQuestions.registerProvider({
      ask: async (request) => {
        const sessionId = request.agent ? server.rootOf(request.agent.session) : undefined
        if (sessionId === undefined) throw new Error('a question needs the asking chat')
        const answer = await server.ask('question', sessionId, { questions: request.questions }, request.signal)
        return { answers: Array.isArray(answer?.answers) ? answer.answers : [] }
      },
    })
  })

  let exitTask
  const disposeAndExit = () => {
    exitTask ??= (async () => {
      await Promise.allSettled([Promise.resolve().then(() => transport.flush())])
      await Promise.allSettled([Promise.resolve().then(() => rootFiber.dispose())])
      exit(0)
    })()
    return exitTask
  }

  transport.onRequest(async (method, params) => {
    const result = await server.handleRequest(method, params)
    if (method === 'shutdown') setImmediate(() => { void disposeAndExit() })
    return result
  })

  ctx.effect(() => {
    transport.start()
    return async () => {
      await server.shutdown()
      transport.close()
    }
  }, 'jsonrpc.serve')
}
