/** Workspace archive and directory UI capability. */

import { Service, type Context } from '@janhq/cordis'
import type { AccessEffect, RemoteEndpoint } from '@janhq/jan-api-remote-access/client'
import type { ClientRemote, DirectoryListing, RemoteFailure } from '@janhq/jan-api-remotes/client'
import type {
  ISessions,
  SessionCreateError,
  SessionBinding,
  SessionReference,
  SessionTarget,
  SessionListState,
} from '@janhq/jan-api-session-controller/client'
// Type-only: pulls the `agentPreset` Session projection value into this program.
import type { } from '@janhq/jan-agent-preset-registry/types'
import { createSnapshotStore, type ObservableSnapshot } from '@janhq/jan-client-store'
import type { SubagentAddress } from '@janhq/jan-subagent/client'
import type {
  IWorkspaces, WorkspaceId, WorkspaceSnapshot, WorkspaceView,
} from '@janhq/jan-api-workspace-controller/client'
import type { SessionId } from '@janhq/jan-session/types'
import type { } from '@janhq/jan-client-ui-layout/client'
import type { DraftInitializationOptions } from '@janhq/jan-client-ui-conversation/client'
import type { RowToast } from './contract/slots.ts'
import { NavigationHistory, sameSession } from './history.ts'
import type { NavigationAvailability, NavigationDirection, NavigationLocation } from './history.ts'
import { pinOrderAccounts, pinOrderSource } from './pin-order.ts'
import type { SessionGroupBy, WorkspaceViewStoreActions } from './stores.ts'

interface MainSelection {
  readonly sessionId?: SessionId
  readonly subagentAddress?: SubagentAddress
}

/** Content preparation and Agent preset for the Session a Workspace flow opens. */
export interface StartSessionOptions extends DraftInitializationOptions {
  /** Agent preset the Session runs; the Host default when omitted. */
  readonly agentPreset?: string
}

/** Workspace archive and directory operations consumed by Client UI domains. */
export interface UiWorkspace {
  /**
   * Change the browser's grouping through its existing persisted view store.
   * @param mode - grouping the session list switches to and keeps.
   */
  setSessionGrouping(mode: SessionGroupBy): void
  /**
   * Select a Session and show its Conversation as one UI navigation action.
   * @param target - known Session identity or durable direct-parent subagent address to display.
   */
  openSession(target: SessionTarget): void
  /**
   * Return to the previous main-view location: the Session and global panel the user
   * left last. Entries whose Session was archived or deleted are skipped; does nothing
   * when no entry remains.
   */
  goBack(): void
  /**
   * Undo the latest {@link UiWorkspace.goBack}. A new navigation clears the Forward entries.
   * Entries whose Session was archived or deleted are skipped; does nothing when none remain.
   */
  goForward(): void
  /** Whether Back and Forward have an entry; republished only when a flag changes. */
  readonly navigationHistory: ObservableSnapshot<NavigationAvailability>
  /**
   * Connect a Workspace and open its Session unless a later navigation supersedes it.
   * @param workspaceId - target Workspace.
   * @param beforeOpen - optional synchronous preparation for the selected Session,
   * skipped after supersession; a throw aborts the open and releases the retained reference.
   * @param options - choices for the Session the connection creates or reuses.
   * @returns completion; a superseded request may create a Session but does not open it.
   * @throws on failure; a refused creation is also shown through the Workspace
   * notice unless a later navigation or disposal superseded the request.
   */
  openWorkspace(
    workspaceId: WorkspaceId,
    beforeOpen?: (sessionId: SessionId) => void,
    options?: Pick<StartSessionOptions, 'agentPreset'>,
  ): Promise<void>
  /**
   * Fork a Session without changing the current selection.
   * @param sessionId - source Session.
   * @param onCreated - observer before the optional child-title update.
   * @param options - optional permission to start source migration; omission preserves the Host default.
   * @returns the child SessionId after creation and inherited-title increment.
   */
  forkSession(
    sessionId: SessionId,
    onCreated?: (childId: SessionId) => void,
    options?: Pick<Parameters<ISessions['fork']>[0], 'allowMigration'>,
  ): Promise<SessionId>
  /**
   * Resolve the Session for a new conversation in a Workspace: navigation names the first reusable
   * blank member — listed in the Workspace, not archived, and listing no preset or the requested one —
   * and the Host reuses it under the requested preset or its default, creating another Session when it
   * reuses none. Concurrent calls for the same Workspace and preset share one attempt.
   * @param workspaceId - target Workspace.
   * @param options - choices for the created or reused Session.
   * @returns a Session already addressable through the Session Controller.
   */
  connectWorkspace(workspaceId: WorkspaceId, options?: Pick<StartSessionOptions, 'agentPreset'>): Promise<SessionId>
  /**
   * Open the Workspace blank `connectWorkspace` resolves, so New Session returns to that blank's
   * unsent draft. A creation the Host refuses is shown through the Workspace notice and leaves the
   * selection as it was.
   * @param workspaceId - explicit target; absent inherits the current or most recent Workspace.
   * @param options - initial content, the blank's preset, and `whenDraftExists`, which decides
   * whether existing text or attachments are kept, replaced, or followed by the prompt.
   */
  startSession(workspaceId?: WorkspaceId, options?: StartSessionOptions): void
  /**
   * Archive a Session and clear it when it is the current selection.
   * @param sessionId - Session to archive.
   * @param options - `stopActivity` asks the Host to stop the Session's running work instead of refusing.
   */
  archiveSession(sessionId: SessionId, options?: { readonly stopActivity?: boolean }): Promise<void>
  /**
   * Unarchive a Session, restoring it to its recorded Workspace position.
   * @param sessionId - Session to unarchive.
   */
  unarchiveSession(sessionId: SessionId): Promise<void>
  /**
   * Pin a Session on the Host, then lead it in its accounts' saved orders
   * (its Workspace group or Ungrouped, and the flat list). The order write
   * reads the memberships current at completion, so reorders that landed
   * while the Host call was pending keep their positions.
   * @param sessionId - Session to pin.
   */
  pinSession(sessionId: SessionId): Promise<void>
  /**
   * Unpin a Session on the Host; saved positions stay as they are.
   * @param sessionId - Session to unpin.
   */
  unpinSession(sessionId: SessionId): Promise<void>
  /**
   * Open the Host-native directory picker.
   * @returns the selected directory, or null when cancelled.
   */
  pickDirectory(): Promise<string | null>
  /**
   * List one Host directory level.
   * @param path - directory path; absent selects the Host home.
   * @param signal - cancellation for a superseded scan.
   * @returns directory entries and breadcrumb ancestry.
   */
  listDirectory(path?: string, signal?: AbortSignal): Promise<DirectoryListing>
  /**
   * Create a child directory.
   * @param path - existing parent directory.
   * @param name - child directory name.
   * @returns created absolute path.
   */
  createDirectory(path: string, name: string): Promise<string>
  /**
   * Keep `callback`'s effects installed while the current Peer may call
   * `action` on one Workspace resource, with the semantics of
   * `ctx.remoteAccess.whenAccess`: `useWorkspaceAccess` answers the same
   * question during render.
   * @param workspaceId - the Workspace resource the guarded effects depend on.
   * @param action - endpoint action the guarded effects depend on.
   * @param callback - creates one disposer or an iterable of disposers.
   * @returns idempotent disposer owned by the caller's Cordis fiber.
   */
  whenAccess(workspaceId: WorkspaceId, action: RemoteEndpoint, callback: () => AccessEffect): () => void
  /**
   * Route every Search request (the `session.search` command and the sidebar Search controls) to a
   * replacement surface, such as an application-wide palette. Without a handler, Search expands and
   * focuses the sidebar's Session search field. The latest registration wins.
   * @param open - opens the replacement surface.
   * @returns idempotent disposer; removing the latest handler restores the previous one.
   */
  registerSearchHandler(open: () => void): () => void
  /**
   * Route a click on a sidebar Workspace row to a project surface, such as a project home page.
   * Without a handler the row click expands or collapses the Workspace's Sessions; with one, the row
   * click opens the surface and its chevron keeps expanding and collapsing. The latest registration wins.
   * @param open - opens the surface for the clicked Workspace.
   * @returns idempotent disposer; removing the latest handler restores the previous one.
   */
  registerProjectHandler(open: (workspaceId: WorkspaceId) => void): () => void
}

declare module '@janhq/cordis' {
  interface Context {
    /** Cross-Controller Workspace navigation and directory UI capability. */
    uiWorkspace: UiWorkspace
  }
}

/** Structured directory failure exposed to directory UI consumers. */
export class DirectoryBrowseError extends Error {
  override readonly name = 'DirectoryBrowseError'

  /** @param rpcError - Host directory business failure. */
  constructor(readonly rpcError: RemoteFailure) {
    super(`directory browse failed: ${rpcError.code}: ${rpcError.message}`)
  }
}

/** Implements Workspace archive and directory UI operations. */
class UiWorkspaceService extends Service implements UiWorkspace {
  /** The latest in-flight connection per Workspace; a request joins it only when both name the same preset. */
  private readonly connecting = new Map<WorkspaceId, {
    readonly agentPreset: string | undefined
    readonly attempt: Promise<SessionId>
  }>()
  private readonly lifetime = new AbortController()
  private readonly history = new NavigationHistory()
  readonly navigationHistory = this.history.availability
  /** True while Back/Forward replays a location: the replay must not record itself. */
  private replaying = false
  /** True while a navigation writes the Session and the panel as one location. */
  private batching = false
  private readonly selection = createSnapshotStore<MainSelection>(
    {}, { persist: { name: 'jan.sessions.current' } },
  )
  private mainReference: SessionReference | undefined
  private restorationNavigation: AbortSignal | undefined
  /** Replacement search surfaces in registration order; the last one receives Search. */
  private readonly searchHandlers: { readonly open: () => void }[] = []
  /** Project surfaces in registration order; the last one receives Workspace row clicks. */
  private readonly projectHandlers: { readonly open: (workspaceId: WorkspaceId) => void }[] = []
  /** Whether a project surface is registered, for row components choosing click behavior. */
  readonly projectSurface = createSnapshotStore(false)

  /**
   * @param ctx - Client root Context.
   * @param directoryPicker - the directory-picking Remote namespace.
   * @param workspaces - pure Workspace Controller.
   * @param sessions - pure Session Controller.
   * @param view - the browser's viewing-store write set (one instance shared with its registration).
   * @param notify - show one notice through the Workspace notice channel.
   */
  constructor(
    ctx: Context,
    private readonly directoryPicker: ClientRemote['directoryPicker'],
    private readonly workspaces: IWorkspaces,
    private readonly sessions: ISessions,
    private readonly view: Pick<WorkspaceViewStoreActions, 'pinSessionOrder' | 'setGroupBy'>,
    private readonly notify: (toast: RowToast) => void,
  ) {
    super(ctx, 'uiWorkspace')
    ctx.effect(() => {
      const stop = this.watchNavigation()
      return () => {
        stop()
        this.lifetime.abort()
        const reference = this.mainReference
        this.mainReference = undefined
        reference?.release()
      }
    }, 'ui-workspace: Workspace navigation policy')
  }

  setSessionGrouping(mode: SessionGroupBy): void {
    this.view.setGroupBy(mode)
  }

  connectWorkspace(workspaceId: WorkspaceId, options: Pick<StartSessionOptions, 'agentPreset'> = {}): Promise<SessionId> {
    return this.connectBlank(workspaceId, options)
  }

  /**
   * @param reuse - preset for the reused or created blank.
   */
  private async connectBlank(
    workspaceId: WorkspaceId,
    reuse: Pick<StartSessionOptions, 'agentPreset'>,
  ): Promise<SessionId> {
    const workspace = this.workspaces.list.getSnapshot().items
      .find(item => item.workspaceId === workspaceId)
    if (workspace === undefined) {
      throw new Error(`uiWorkspace.connectWorkspace: unknown workspace ${workspaceId}`)
    }
    const inflight = this.connecting.get(workspaceId)
    if (inflight !== undefined && inflight.agentPreset === reuse.agentPreset) return inflight.attempt

    const attempt = this.createInWorkspace(workspace, reuse).finally(() => {
      if (this.connecting.get(workspaceId)?.attempt === attempt) this.connecting.delete(workspaceId)
    })
    this.connecting.set(workspaceId, { agentPreset: reuse.agentPreset, attempt })
    return attempt
  }

  /** Name the first reusable member blank; a requested preset also skips blanks listing another preset. */
  private createInWorkspace(workspace: WorkspaceView, options: Pick<StartSessionOptions, 'agentPreset'>): Promise<SessionId> {
    const archived = this.workspaces.list.getSnapshot().archivedSessionIds
    const sessions = this.sessions.list.getSnapshot()
    const blank = sessions.ids.find((id) => {
      const summary = sessions.byId[id]
      const listed = summary?.projectionValues?.agentPreset
      return summary !== undefined && summary.blank && summary.cwd === workspace.path
        && workspace.sessionIds.includes(id) && !archived.includes(id)
        && (options.agentPreset === undefined || typeof listed !== 'string' || listed === options.agentPreset)
    })
    return this.createNamed({
      workspaceId: workspace.workspaceId,
      ...(blank === undefined ? {} : { sessionId: blank }),
      ...(options.agentPreset === undefined ? {} : { agentPreset: options.agentPreset }),
    })
  }

  /**
   * Create through the Host. A named blank the Host declined may still read as
   * blank from stale cached list metadata, which hides it from the Session tree;
   * its projections are reloaded so the row reflects its log.
   */
  private async createNamed(request: {
    readonly workspaceId: WorkspaceId
    readonly sessionId?: SessionId
    readonly agentPreset?: string
  }): Promise<SessionId> {
    const sessionId = await this.sessions.create(request)
    const named = request.sessionId
    if (named !== undefined && named !== sessionId) {
      void this.sessions.refreshProjections(named).catch((reason: unknown) => {
        console.warn('declined blank Session projection reload failed:', reason)
      })
    }
    return sessionId
  }

  /**
   * Reopen a saved blank Session under the preset its log recorded, or under
   * the Host default once that preset no longer activates. Listed values are
   * cached hints that can lag the log after an unclean Host exit, so the
   * Session's projections are reloaded before the preset is read; a Session
   * that still awaits a format migration reloads only those cached hints.
   */
  private async restoreBlank(workspaceId: WorkspaceId, sessionId: SessionId): Promise<SessionId> {
    await this.sessions.refreshProjections(sessionId)
    const recorded = this.sessions.list.getSnapshot().byId[sessionId]?.projectionValues?.agentPreset
    const request = { workspaceId, sessionId }
    if (typeof recorded !== 'string') return this.createNamed(request)
    try {
      return await this.createNamed({ ...request, agentPreset: recorded })
    } catch (error: unknown) {
      const code = sessionCreateErrorOf(error)?.rpcError.code
      if (code !== 'agent-preset/not-found' && code !== 'agent-preset/invalid') throw error
      return this.createNamed(request)
    }
  }

  openSession(target: SessionTarget): void {
    this.replaceMain(target, this.lifetime.signal, 'reveal')
  }

  goBack(): void {
    this.step('back')
  }

  goForward(): void {
    this.step('forward')
  }

  openWorkspace(
    workspaceId: WorkspaceId,
    beforeOpen?: (sessionId: SessionId) => void,
    options: Pick<StartSessionOptions, 'agentPreset'> = {},
  ): Promise<void> {
    return this.openWorkspaceSession(workspaceId, beforeOpen, options)
  }

  private async openWorkspaceSession(
    workspaceId: WorkspaceId,
    beforeOpen: ((sessionId: SessionId) => void) | undefined,
    reuse: Pick<StartSessionOptions, 'agentPreset'>,
  ): Promise<void> {
    const navigation = AbortSignal.any([this.ctx.layout.beginNavigation(), this.lifetime.signal])
    let sessionId: SessionId
    try {
      sessionId = await this.connectBlank(workspaceId, reuse)
    } catch (error: unknown) {
      // Reported here, not in connectWorkspace: startup restoration calls that
      // directly and stays console-only.
      if (!navigation.aborted) this.notify({ kind: 'createFailed', message: creationFailureMessage(error) })
      throw error
    }
    if (navigation.aborted) return
    this.replaceMain(sessionId, navigation, 'reveal', beforeOpen)
  }

  async forkSession(
    sessionId: SessionId,
    onCreated?: (childId: SessionId) => void,
    options?: Pick<Parameters<ISessions['fork']>[0], 'allowMigration'>,
  ): Promise<SessionId> {
    return this.sessions.fork({
      sessionId,
      increaseTitle: true,
      ...onCreated === undefined ? {} : { onCreated },
      ...options?.allowMigration === undefined ? {} : { allowMigration: options.allowMigration },
    })
  }

  startSession(workspaceId?: WorkspaceId, options?: StartSessionOptions): void {
    const { agentPreset, ...draft } = options ?? {}
    const draftOptions = options === undefined ? undefined : draft
    const initializeDraft = draftOptions !== undefined && (draftOptions.prompt !== undefined
      || (draftOptions.whenDraftExists ?? (draftOptions.clearPreviousDraft === true ? 'replace' : 'keep')) === 'replace')
    const workspace = this.workspaces.list.getSnapshot()
    const sessions = this.sessions.list.getSnapshot()
    const current = this.mainReference?.sessionId
    const currentWorkspaceId = current === undefined
      ? undefined
      : workspace.items.find(item => item.sessionIds.includes(current))?.workspaceId
    const recent = workspace.phase === 'ready' && sessions.phase === 'ready'
      ? recentWorkspace(workspace.items, sessions.byId)
      : undefined
    const target = workspaceId ?? currentWorkspaceId ?? recent
    if (target === undefined) {
      if (initializeDraft) {
        this.notify({ kind: 'createFailed', message: this.ctx.locale.bind('workspace')('draft.workspaceRequired') })
        return
      }
      this.clearMain()
      return
    }
    const opening = this.openWorkspace(target, initializeDraft ? (id) => {
      const binding = this.sessions.binding(id)
      if (binding === undefined) this.draftPreparationFailed()
      this.prepareDraft(binding, draftOptions)
    } : undefined, agentPreset === undefined ? {} : { agentPreset })
    void opening.catch(
      (reason: unknown) => { console.warn('new session failed:', reason) },
    )
  }

  private prepareDraft(binding: SessionBinding, options: DraftInitializationOptions): void {
    const conversation = this.ctx.get('conversation')
    if (conversation === undefined) this.draftPreparationFailed()
    if (conversation.input.requestDraftInitialization(binding, options) === 'blocked') this.draftPreparationFailed()
  }

  private draftPreparationFailed(): never {
    const message = this.ctx.locale.bind('workspace')('draft.initializationFailed')
    this.notify({ kind: 'createFailed', message })
    throw new Error(message)
  }

  async archiveSession(sessionId: SessionId, options: { readonly stopActivity?: boolean } = {}): Promise<void> {
    await this.workspaces.archiveSession(sessionId, options)
    if (this.mainReference?.sessionId === sessionId) this.clearMain('replace')
  }

  async unarchiveSession(sessionId: SessionId): Promise<void> {
    await this.workspaces.unarchiveSession(sessionId)
  }

  async pinSession(sessionId: SessionId): Promise<void> {
    await this.workspaces.pinSession(sessionId)
    const { items, pinnedSessionIds, archivedSessionIds } = this.workspaces.list.getSnapshot()
    this.view.pinSessionOrder(
      sessionId,
      pinOrderAccounts(items, sessionId),
      pinOrderSource(items, this.sessions.list.getSnapshot(), { pinnedSessionIds, archivedSessionIds }),
    )
  }

  async unpinSession(sessionId: SessionId): Promise<void> {
    await this.workspaces.unpinSession(sessionId)
  }

  async pickDirectory(): Promise<string | null> {
    const result = await this.directoryPicker.pick()
    if (!result.ok) throw new Error(`directory picker failed: ${result.error.message}`)
    return result.value
  }

  async listDirectory(path?: string, signal?: AbortSignal): Promise<DirectoryListing> {
    const result = await this.directoryPicker.list(path, signal)
    if (!result.ok) throw new DirectoryBrowseError(result.error)
    return result.value
  }

  async createDirectory(path: string, name: string): Promise<string> {
    const result = await this.directoryPicker.createDirectory(path, name)
    if (!result.ok) throw new DirectoryBrowseError(result.error)
    return result.value
  }

  whenAccess(workspaceId: WorkspaceId, action: RemoteEndpoint, callback: () => AccessEffect): () => void {
    // `ctx.get` traces the service to the caller's Context, which then owns the controller.
    const access = this.ctx.get('remoteAccess')
    /* v8 ignore next -- this plugin injects remoteAccess, so the service is active while uiWorkspace is reachable. */
    if (access === undefined) throw new Error('ui-workspace: whenAccess requires the remoteAccess service')
    return access.whenResourceAccess('workspace', workspaceId, action, callback)
  }

  registerSearchHandler(open: () => void): () => void {
    // A fresh wrapper keeps two registrations of one function independently removable.
    const entry = { open }
    this.searchHandlers.push(entry)
    return () => {
      const at = this.searchHandlers.indexOf(entry)
      if (at !== -1) this.searchHandlers.splice(at, 1)
    }
  }

  registerProjectHandler(open: (workspaceId: WorkspaceId) => void): () => void {
    const entry = { open }
    this.projectHandlers.push(entry)
    this.projectSurface.set(true)
    return () => {
      const at = this.projectHandlers.indexOf(entry)
      if (at !== -1) this.projectHandlers.splice(at, 1)
      this.projectSurface.set(this.projectHandlers.length > 0)
    }
  }

  /**
   * Open the latest registered project surface for one Workspace.
   * @param workspaceId - the clicked Workspace.
   * @returns whether a handler took the request; false leaves the row to expand or collapse.
   */
  openProjectSurface(workspaceId: WorkspaceId): boolean {
    const handler = this.projectHandlers.at(-1)
    if (handler === undefined) return false
    handler.open(workspaceId)
    return true
  }

  /**
   * Open the latest registered search surface.
   * @returns whether a handler took the request; false leaves it to the sidebar field.
   */
  openSearchSurface(): boolean {
    const handler = this.searchHandlers.at(-1)
    if (handler === undefined) return false
    handler.open()
    return true
  }

  private watchNavigation(): () => void {
    let initial: 'waiting' | 'connecting' | 'done' = 'waiting'
    const reconcile = (): void => {
      if (this.lifetime.signal.aborted) return
      this.history.prune(this.reachable)
      if (this.clearArchivedCurrent()) return
      if (initial !== 'waiting' || this.restorationNavigation?.aborted === true) return
      const workspace = this.workspaces.list.getSnapshot()
      const sessions = this.sessions.list.getSnapshot()
      if (workspace.phase !== 'ready' || sessions.phase !== 'ready') return
      if (this.mainReference !== undefined) {
        initial = 'done'
        return
      }
      initial = 'connecting'
      void this.restoreSelection(workspace, sessions).then(
        () => { initial = 'done' },
        (reason: unknown) => {
          if (this.lifetime.signal.aborted) return
          initial = 'waiting'
          console.warn('initial Session restoration failed:', reason)
        },
      )
    }

    const disposeWorkspaces = this.workspaces.list.subscribe(reconcile)
    const disposeSessions = this.sessions.list.subscribe(reconcile)
    // Global panels are opened by their own owners through ctx.layout; the panel is part of the location.
    const disposePanels = this.ctx.layout.panelInfo.subscribe(() => {
      if (!this.batching) this.settle('push')
    })
    reconcile()
    return () => {
      this.lifetime.abort()
      disposePanels()
      disposeSessions()
      disposeWorkspaces()
    }
  }

  private async restoreSelection(workspaces: WorkspaceSnapshot, sessions: SessionListState): Promise<void> {
    const saved = this.selection.getSnapshot()
    if (saved.subagentAddress !== undefined) {
      this.replaceMain(saved.subagentAddress, this.lifetime.signal, 'preserve')
      return
    }
    const summary = saved.sessionId === undefined ? undefined : sessions.byId[saved.sessionId]
    const workspace = summary === undefined ? undefined
      : workspaces.items.find(item => item.sessionIds.includes(summary.id))
    if (summary !== undefined && (!summary.blank || workspace === undefined)) {
      this.replaceMain(summary.id, this.lifetime.signal, 'preserve')
      return
    }
    const navigation = AbortSignal.any([this.ctx.layout.beginNavigation(), this.lifetime.signal])
    this.restorationNavigation = navigation
    let sessionId: SessionId | undefined
    if (summary !== undefined && workspace !== undefined && summary.cwd === workspace.path
      && !workspaces.archivedSessionIds.includes(summary.id)) {
      sessionId = await this.restoreBlank(workspace.workspaceId, summary.id)
    }
    let target = workspace?.workspaceId ?? recentWorkspace(workspaces.items, sessions.byId)
    if (target === undefined && workspaces.items.length === 0 && sessions.ids.length === 0) {
      const prepared = await this.initializeDefaultWorkspace(navigation)
      if (navigation.aborted) return
      target = prepared?.workspaceId
    }
    if (sessionId === undefined && target !== undefined) sessionId = await this.connectWorkspace(target)
    if (sessionId !== undefined && !navigation.aborted) {
      this.replaceMain(sessionId, navigation, 'preserve')
    }
  }

  private async initializeDefaultWorkspace(signal: AbortSignal): Promise<WorkspaceView | undefined> {
    try {
      return await this.workspaces.initializeDefault(signal)
    } catch (_error: unknown) {
      if (!signal.aborted) this.notify({ kind: 'defaultWorkspaceFailed' })
      return undefined
    }
  }

  /** @returns true when an archived current selection was cleared. */
  private clearArchivedCurrent(): boolean {
    const current = this.mainReference?.sessionId
    if (current === undefined
      || !this.workspaces.list.getSnapshot().archivedSessionIds.includes(current)) return false
    this.clearMain('replace')
    return true
  }

  /**
   * @param record - `push` for a navigation the user made; `replace` when the current
   * location itself disappears (its Session was archived), which leaves no entry.
   */
  private clearMain(record: 'push' | 'replace' = 'push'): void {
    const previous = this.mainReference
    this.mainReference = undefined
    this.selection.set({})
    previous?.release()
    this.showConversation()
    this.settle(record)
  }

  private replaceMain(
    target: SessionTarget,
    signal: AbortSignal,
    panel: 'reveal' | 'preserve',
    beforeOpen?: (sessionId: SessionId) => void,
  ): void {
    signal.throwIfAborted()
    const reference = this.sessions.retain(target, { source: 'mainView' })
    try {
      signal.throwIfAborted()
      beforeOpen?.(reference.sessionId)
      if (signal.aborted) {
        reference.release()
        return
      }
      const subagentAddress = typeof target === 'string'
        ? this.sessions.subagentAddress(reference.sessionId)
        : target
      this.selection.set({
        sessionId: reference.sessionId,
        ...(subagentAddress === undefined ? {} : { subagentAddress }),
      })
    } catch (error: unknown) {
      reference.release()
      throw error
    }
    const previous = this.mainReference
    this.mainReference = reference
    previous?.release()
    if (panel === 'reveal') this.showConversation()
    // Only a user opening a Session is a navigation; restoration and replays keep the history as it is.
    this.settle(panel === 'reveal' ? 'push' : 'replace')
  }

  /** Select the Conversation panel without letting the panel observer record the half-written location. */
  private showConversation(): void {
    this.batching = true
    try {
      this.ctx.layout.selectPanel(null)
    } finally {
      this.batching = false
    }
  }

  /** The main view as it is now: selected Session and global panel. */
  private location(): NavigationLocation {
    const { sessionId, subagentAddress } = this.selection.getSnapshot()
    return {
      ...(sessionId === undefined ? {} : { sessionId }),
      ...(subagentAddress === undefined ? {} : { subagentAddress }),
      panelId: this.ctx.layout.panelInfo.getSnapshot().activePanelId,
    }
  }

  /** Fold the current main view into the history; replays record nothing. */
  private settle(record: 'push' | 'replace'): void {
    if (this.replaying) return
    if (record === 'push') this.history.record(this.location())
    else this.history.seed(this.location())
  }

  /** Whether the Session (or the subagent's parent) is still listed and not archived; unknown while the catalogs load. */
  private readonly reachable = (location: NavigationLocation): boolean => {
    const id = location.subagentAddress?.parentSessionId ?? location.sessionId
    if (id === undefined) return true
    const workspaces = this.workspaces.list.getSnapshot()
    const sessions = this.sessions.list.getSnapshot()
    if (workspaces.phase !== 'ready' || sessions.phase !== 'ready') return true
    return sessions.byId[id] !== undefined && !workspaces.archivedSessionIds.includes(id)
  }

  /** Replay the nearest reachable entry in `direction`; a failed replay drops its entry and tries the next. */
  private step(direction: NavigationDirection): void {
    if (this.lifetime.signal.aborted) return
    let failed = false
    for (let target = this.history.peek(direction, this.reachable); target !== undefined;
      target = this.history.peek(direction, this.reachable)) {
      this.replaying = true
      try {
        this.apply(target)
      } catch (error: unknown) {
        failed = true
        console.warn('navigation replay failed:', error)
        this.history.discard(direction)
        continue
      } finally {
        this.replaying = false
      }
      this.history.commit(direction)
      return
    }
    // A failed replay may have moved the view before it threw.
    if (failed) this.history.seed(this.location())
  }

  /** Show `location`. A global panel that is no longer registered makes `selectPanel` throw. */
  private apply(location: NavigationLocation): void {
    const target = location.subagentAddress ?? location.sessionId
    if (this.mainReference === undefined || !sameSession(this.selection.getSnapshot(), location)) {
      if (target === undefined) this.clearMain()
      else this.replaceMain(target, this.lifetime.signal, 'preserve')
    }
    this.ctx.layout.selectPanel(location.panelId)
  }

}

/**
 * `error` as the Session Controller's creation failure, or undefined when it
 * is not one. Client plugin bundles do not share error-class identity, so the
 * name decides.
 */
function sessionCreateErrorOf(error: unknown): SessionCreateError | undefined {
  return error instanceof Error && error.name === 'SessionCreateError' ? error as SessionCreateError : undefined
}

/**
 * The words a failed Session creation is reported in: a Host refusal keeps its
 * stable code and message; any other failure keeps its own message.
 */
function creationFailureMessage(error: unknown): string {
  const refused = sessionCreateErrorOf(error)
  if (refused !== undefined) return `${refused.rpcError.code}: ${refused.rpcError.message}`
  return error instanceof Error ? error.message : String(error)
}

/** Stable tie-breaking follows Host Workspace order. */
function recentWorkspace(
  workspaces: readonly WorkspaceView[],
  sessions: SessionListState['byId'],
): WorkspaceId | undefined {
  let selected: WorkspaceId | undefined
  let selectedTime = Number.NEGATIVE_INFINITY
  for (const workspace of workspaces) {
    let latest = Number.NEGATIVE_INFINITY
    for (const sessionId of workspace.sessionIds) {
      const session = sessions[sessionId]
      if (session !== undefined) latest = Math.max(latest, session.updatedAt)
    }
    if (latest === Number.NEGATIVE_INFINITY) latest = Date.parse(workspace.createdAt)
    if (selected === undefined || latest > selectedTime) {
      selected = workspace.workspaceId
      selectedTime = latest
    }
  }
  return selected
}

export { UiWorkspaceService }
