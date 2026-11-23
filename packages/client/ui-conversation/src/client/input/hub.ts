/**
 * Session-bound input registry and default-send routing for Conversation.
 * Each retained Session binding owns one shell, its input listeners, and its
 * catalog subscription. Saved drafts enter the model before the first lookup
 * returns; Session-scope disposal releases the shell and its resources.
 */
import type { } from '@janhq/jan-client-product-analytics/client'
import type { PlanProjection } from '@janhq/jan-plan-mode/types'
import type { GoalProjection } from '@janhq/jan-goal/types'
import type { Context } from '@janhq/cordis'
import type {
  ISessions, SessionBinding, SessionFace, SessionProjectionMap,
} from '@janhq/jan-api-session-controller/client'
import type { SessionId, SessionSeq } from '@janhq/jan-session/types'
import type { TranslateNS } from '@janhq/jan-client-locale/client'
import type { InboxState } from '@janhq/jan-agent/types'
import type { ModelSelectionProjection } from '@janhq/jan-agent/types'
import type { ObservableSnapshot } from '@janhq/jan-client-store'
import type {
  DraftAttachmentId, DraftAttachmentSerializationResult, DraftInitializationOptions, DraftInitializationResult, InputTriggerController,
  ContextWindowSource, SendCheck, SessionInputResolver, SessionInput, SubmitOutcome,
} from '../contract/input.ts'
import type { ComposerKeyboard } from '../contract/draft-editor.ts'
import type { ComposerBlocks } from '../contract/composer-blocks.ts'
import type { InputSubmitMode } from '../contract/composer-submission.ts'
import type { PopupDismissFace } from './facade.ts'
import { SessionInputShell } from './facade.ts'
import { reportMessageSubmission } from './submission-analytics.ts'
import { readConversationDraft } from '../stores.ts'

/** Structural command face for per-session popup resolution. */
interface CommandFace {
  popupFor(actx: Context): PopupDismissFace
}

/** Optional input-trigger service resolved without importing its implementation. */
interface InputTriggerServiceFace {
  /** @param actx - Session scope. @returns that Session's trigger provider. */
  sessionOf(actx: Context): InputTriggerController
}

/** Attachment-send face resolved lazily to keep hub/service construction acyclic. */
interface ConversationAttachmentFace {
  readonly blocks: ComposerBlocks
  sendSession(
    session: SessionFace,
    text: string,
    attachmentIds: readonly DraftAttachmentId[],
    mode: InputSubmitMode,
    signal?: AbortSignal,
    accept?: () => void,
  ): Promise<SubmitOutcome>
  serializeDraftAttachments(attachmentIds: readonly DraftAttachmentId[]): Promise<DraftAttachmentSerializationResult>
  releaseDraftAttachment(id: DraftAttachmentId): void
}

/** Session-addressed input facade registry (SessionInputResolver face + composer-layer extras). */
export class InputHub implements SessionInputResolver {
  private readonly shells = new WeakMap<SessionBinding, SessionInputShell>()
  private readonly sendChecks = new Set<SendCheck>()
  private windowSource: ContextWindowSource | undefined
  private readonly windows = new Map<SessionId, ObservableSnapshot<number | undefined> & { refresh(): void }>()
  /** Sessions with a draft-preserving retry prompt still in flight. */
  private readonly retrying = new WeakSet<SessionBinding>()

  /**
   * @param ctx - client root context (services resolved lazily per call — boot order stays free).
   * @param t - conversation-namespace translate thunk (reads the active locale at call time).
   */
  constructor(
    private readonly rootCtx: Context,
    private readonly t: TranslateNS<'conversation'>,
  ) { }

  /**
   * Resolve the facade for one session-scope ctx (SessionInputResolver face).
   * @param actx - session-scope context.
   * @returns the resident per-session facade.
   */
  for(actx: Context): SessionInput {
    const sessions = this.sessions()
    const session = sessions.sessionOf(actx)
    const binding = session === undefined ? undefined : sessions.binding(session.sessionId)
    if (binding === undefined || binding.session !== session) {
      throw new Error('conversation.input.for requires a retained Session scope')
    }
    return this.shellFor(binding)
  }

  requestDraftInitialization(binding: SessionBinding, options: DraftInitializationOptions): DraftInitializationResult {
    if (this.sessions().binding(binding.sessionId) !== binding) {
      throw new Error('conversation.input.requestDraftInitialization requires a retained Session binding')
    }
    return this.shellFor(binding).requestDraftInitialization(options)
  }

  addSendCheck(check: SendCheck): () => void {
    this.sendChecks.add(check)
    return () => { this.sendChecks.delete(check) }
  }

  setContextWindowSource(source: ContextWindowSource): () => void {
    const previous = this.windowSource
    this.windowSource = source
    this.windowSourceChanged()
    return () => {
      if (this.windowSource !== source) return
      this.windowSource = previous
      this.windowSourceChanged()
    }
  }

  contextWindowOf(sessionId: SessionId): ObservableSnapshot<number | undefined> {
    const existing = this.windows.get(sessionId)
    if (existing !== undefined) return existing
    // The source can arrive or change after the meter subscribed, so this store follows it.
    const listeners = new Set<() => void>()
    let inner: ObservableSnapshot<number | undefined> | undefined
    let unsubscribeInner: (() => void) | undefined
    const resolve = (): void => {
      unsubscribeInner?.()
      inner = this.windowSource?.(sessionId)
      unsubscribeInner = listeners.size === 0 ? undefined : inner?.subscribe(() => { for (const fn of listeners) fn() })
    }
    const store: ObservableSnapshot<number | undefined> & { refresh(): void } = {
      getSnapshot: () => inner?.getSnapshot(),
      subscribe: (fn) => {
        if (listeners.size === 0) { listeners.add(fn); resolve() } else listeners.add(fn)
        return () => {
          listeners.delete(fn)
          if (listeners.size > 0) return
          unsubscribeInner?.(); unsubscribeInner = undefined
          // An unwatched Session's store is rebuilt on the next read, so closed Sessions are not retained.
          this.windows.delete(sessionId)
        }
      },
      refresh: () => { resolve(); for (const fn of listeners) fn() },
    }
    resolve()
    this.windows.set(sessionId, store)
    return store
  }

  private windowSourceChanged(): void {
    for (const store of this.windows.values()) store.refresh()
  }

  /**
   * Resolve the resident shell for an already-retained, addressable Session binding.
   * Draft import completes before return. The Session scope owns input listeners,
   * the inject-managed catalog subscription, and shell teardown.
   * @param binding - session assembly handle.
   * @returns the shell.
   */
  shellFor(binding: SessionBinding): SessionInputShell {
    const existing = this.shells.get(binding)
    if (existing !== undefined) return existing
    const { session, ctx: actx } = binding
    const shell = new SessionInputShell({
      actx,
      submissionState: () => {
        const state = session.getSnapshot()
        const model = session.projections.faceOf('modelSelection').getSnapshot() as ModelSelectionProjection | undefined
        const plan = session.projections.faceOf('plan').getSnapshot() as PlanProjection | undefined
        const goal = session.projections.faceOf('goal').getSnapshot() as GoalProjection | null | undefined
        const agentPreset = session.projections.faceOf('agentPreset').getSnapshot()
        const selection = model?.next ?? model?.lastUsed
        return Object.freeze({
          ...state.blank ? {} : { sessionId: state.sessionId },
          ...selection == null ? {} : {
            model: Object.freeze({
              provider: selection.provider, name: selection.model,
              ...selection.reasoningEffort === undefined ? {} : { effort: selection.reasoningEffort },
            }),
          },
          runMode: plan?.active ? 'plan' : goal?.goal.phase === 'active' ? 'goal' : 'default',
          running: state.running,
          newSession: state.blank,
          ...typeof agentPreset === 'string' ? { agentPreset } : {},
        })
      },
      messageSubmitted: (submission) => { reportMessageSubmission(this.rootCtx, submission) },
      sendCheck: (text) => {
        for (const check of this.sendChecks) {
          try {
            const notice = check(session.sessionId, text)
            if (notice !== undefined) return notice
          } catch (_error) { /* A failing check is skipped; it never blocks sending. */ }
        }
        return undefined
      },
      inputTriggers: () => this.controller(actx),
      popup: () => this.popup(actx),
      inbox: session.projections.faceOf('inbox') as ObservableSnapshot<InboxState | undefined>,
      defaultSink: (text, attachmentIds, mode, signal, accept) => this.sink(session, text, attachmentIds, mode, signal, accept),
      quoteRemoveLabel: () => this.t('quote.remove'),
      contextRemoveLabel: () => this.t('context.remove'),
      quoteInsertionAllowed: () => {
        const state = session.getSnapshot()
        return !state.removed && (state.subagent === null
          || state.subagent.address.mode === 'continuable')
          && this.conversation().blocks.storeFor(session.sessionId).getSnapshot() === undefined
      },
      steerQueue: () => { void this.steerQueue(session, shell) },
      commandAttachments: {
        serialize: async (ids) => {
          const result = await this.conversation().serializeDraftAttachments(ids)
          return result.attachments
        },
        // Asymmetric with serialize on purpose: release settles AFTER the
        // submit RPC, where session teardown may already have unloaded the
        // conversation service (the same tolerance as the scope disposer
        // above); leaked preview URLs then die with the document.
        release: (ids) => {
          const conversation = this.rootCtx.get('conversation') as ConversationAttachmentFace | undefined
          for (const attachmentId of ids) conversation?.releaseDraftAttachment(attachmentId)
        },
        unsupportedNotice: token => this.t('command.attachmentsUnsupported', {
          command: token.trim().replace(/^\//u, ''),
        }),
      },
    })
    this.shells.set(binding, shell)
    // The one teardown axis: listeners, shell, and map entries all ride the
    // scope fiber (nothing here outlives the scope).
    actx.effect(() => {
      const offs = [
        actx.on('slash/input-begin-command', req =>
          shell.beginCommand(req.claim, req.span) ? true : undefined),
        actx.on('slash/input-insert-reference', req =>
          shell.insertReference(req.reference, req.span) ? true : undefined),
        actx.on('slash/input-consume-token', req =>
          shell.consumeToken(req.guard) ? true : undefined),
        actx.on('slash/input-insert-text', req =>
          shell.insertText(req.text, req.span, req.continue === true) ? true : undefined),
      ]
      return () => {
        for (const off of offs) off()
        const drafts = shell.dispose()
        this.shells.delete(binding)
        const conversation = this.rootCtx.get('conversation') as ConversationAttachmentFace | undefined
        for (const attachmentId of drafts) conversation?.releaseDraftAttachment(attachmentId)
      }
    }, 'conversation.input: session shell')
    actx.inject(['inputTriggers'], (scope) => {
      scope.effect(() => {
        shell.refreshLexiconSubscription()
        return () => { shell.refreshLexiconSubscription() }
      }, 'conversation.input: reference catalogs')
    })
    shell.setDraft(readConversationDraft(binding.sessionId))
    return shell
  }

  /**
   * Resident shell by session id (service-face path; the provide channel has
   * normally created it already — this covers direct id-addressed access).
   * @param id - session id.
   * @returns the shell.
   */
  shell(id: SessionId): SessionInputShell {
    const binding = this.sessions().binding(id)
    if (binding === undefined) throw new Error(`conversation.input: session "${id}" resolved no binding`)
    return this.shellFor(binding)
  }

  /**
   * The InputBar-exclusive keyboard command face: the shell
   * satisfies it structurally; package-internal — handed through the
   * composer-bar entry's inject, never across a plugin boundary.
   * @param id - session id.
   * @returns the shell as the keyboard face.
   */
  keyboard(id: SessionId): ComposerKeyboard {
    return this.shell(id)
  }

  /**
   * The addressed failure is current and the Session has no conflicting work. Recovery controls
   * may also address an overflow; the Host verifies the recovery before admitting the retry.
   */
  private canRetry(id: SessionId, binding: SessionBinding, failureSeq: SessionSeq, afterRecovery = false): boolean {
    const projection = binding.session.projections.faceOf('conversationContinuation')
    const ending = projection.getSnapshot() as SessionProjectionMap['conversationContinuation'] | undefined
    if (ending !== failureSeq && !(afterRecovery && typeof ending === 'object' && ending?.overflow === failureSeq)) return false
    const session = binding.session.getSnapshot()
    const inbox = binding.session.projections.faceOf('inbox').getSnapshot() as InboxState | undefined
    return !(session.running || session.removed || session.openState !== 'open' || session.subagent !== null
      || session.pendingSubmissions.length > 0
      || (inbox?.['next-turn'].length ?? 0) > 0
      || inbox?.['next-step'].some(message => message.source.kind === 'user')
      || this.conversation().blocks.storeFor(id).getSnapshot() !== undefined)
  }

  /**
   * Submit empty input to retry a failed generation through the ordinary composer. Stale
   * failures, active work, and drafts keep their current input unchanged.
   * @param id - retained ordinary Session identity.
   * @param failureSeq - failed turn/end sequence the displayed button addresses.
   */
  retry(id: SessionId, failureSeq: SessionSeq): void {
    const binding = this.sessions().binding(id)
    if (binding === undefined || !this.canRetry(id, binding, failureSeq)) return
    const shell = this.shellFor(binding)
    const input = shell.snapshot
    if (input.phase !== 'plain' || input.draft.trim() !== '' || input.attachmentIds.length > 0) return
    shell.submit('queue', 'click', true)
  }

  /**
   * Retry a failed generation for a recovery action that ran while the composer holds a draft:
   * the empty retry prompt goes straight to the Session, so the draft, its attachments, and the
   * composer phase stay exactly as they are. Stale failures and active work are ignored like
   * {@link retry}; a refused prompt lands in the Session's prompt error.
   * @param id - retained ordinary Session identity.
   * @param failureSeq - failed turn/end sequence the recovery card addresses.
   */
  retryKeepingDraft(id: SessionId, failureSeq: SessionSeq): void {
    const binding = this.sessions().binding(id)
    if (binding === undefined || this.retrying.has(binding) || !this.canRetry(id, binding, failureSeq, true)) return
    this.retrying.add(binding)
    void binding.session.prompt([], 'queue').catch(() => {
      // The Session already records the prompt error for the conversation UI.
    }).finally(() => { this.retrying.delete(binding) })
  }

  /**
   * Query file intake without creating a Session input.
   * @param id - target Session.
   * @returns whether its mounted composer currently accepts files.
   */
  canPickFiles(id: SessionId): boolean {
    const binding = this.sessions().binding(id)
    return binding !== undefined && this.shells.get(binding)?.canPickFiles() === true
  }

  /**
   * Open the target composer's file dialog under its live intake policy.
   * @param id - target Session.
   */
  pickFiles(id: SessionId): void {
    const binding = this.sessions().binding(id)
    if (binding !== undefined) this.shells.get(binding)?.pickFiles()
  }

  /**
   * Resolve the optional slash controller for composer chrome that launches
   * the shared candidate menu without typing a trigger.
   * @param id - session id.
   * @returns the resident controller, or undefined when no trigger provider is installed.
   */
  inputTriggers(id: SessionId): InputTriggerController | undefined {
    const binding = this.sessions().binding(id)
    return binding === undefined ? undefined : this.controller(binding.ctx)
  }

  /**
   * Default sink: prompt while the composer holds the sent draft. The session
   * is always a real host entity (materialized when its workspace was picked),
   * so there is exactly one path; a refused or failed prompt is an ordinary
   * prompt failure (banner via promptError, draft kept in the composer).
   */
  private sink(
    session: SessionFace,
    text: string,
    attachmentIds: readonly DraftAttachmentId[],
    mode: InputSubmitMode,
    signal: AbortSignal,
    accept: () => void,
  ): Promise<SubmitOutcome> {
    if (text === '' && attachmentIds.length === 0) {
      return session.prompt([], mode, signal).then(result => result.ok ? { kind: 'success' } : { kind: 'error' })
    }
    return this.conversation().sendSession(session, text, attachmentIds, mode, signal, accept)
  }

  /**
   * Submit every still-pending queued message through QueueDock Steer, in FIFO
   * request order — the same operation as the queue dock's per-row button.
   * An Agent stopping before a command (`session/steer-unavailable`) or a row already
   * claimed by the agent (`session/queue-item-not-found`) converges silently, while a
   * genuine failure surfaces as one composer notice. Repeated triggers
   * (e.g. two rapid empty-draft chords) rely on that `session/queue-item-not-found`
   * convergence: the snapshot may still list a row the host already steered,
   * and the duplicate Steer is a silent no-op.
   * @param session - the addressed host session.
   * @param shell - the resident shell (notice outlet).
   */
  private async steerQueue(session: SessionFace, shell: SessionInputShell): Promise<void> {
    const inbox = session.projections.faceOf('inbox').getSnapshot() as InboxState | undefined
    const queued = inbox?.['next-turn'] ?? []
    if (queued.length === 0) return
    for (const item of queued) {
      const result = await session.updateQueue(item.id, { kind: 'steer' })
      if (result.ok) continue
      if (result.error.code === 'session/steer-unavailable' || result.error.code === 'session/queue-item-not-found') return
      shell.notify('error', this.t('queue.steerFailed'))
      return
    }
  }

  private controller(actx: Context): InputTriggerController | undefined {
    if (this.sessions().sessionOf(actx) === undefined) return undefined
    const inputTriggers = this.rootCtx.get('inputTriggers') as InputTriggerServiceFace | undefined
    return inputTriggers?.sessionOf(actx)
  }

  private popup(actx: Context): PopupDismissFace | undefined {
    if (this.sessions().sessionOf(actx) === undefined) return undefined
    const command = this.rootCtx.get('commandUi') as CommandFace | undefined
    return command?.popupFor(actx)
  }

  private sessions(): ISessions {
    const sessions = this.rootCtx.get('sessions')
    if (sessions === undefined) throw new Error('conversation.input: sessions service unavailable')
    return sessions
  }

  private conversation(): ConversationAttachmentFace {
    const conversation = this.rootCtx.get('conversation') as ConversationAttachmentFace | undefined
    if (conversation === undefined) throw new Error('conversation.input: conversation service unavailable')
    return conversation
  }
}
