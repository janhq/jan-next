/** Workspace command registration and browser-owned opening requests. */
import type { Context } from '@janhq/cordis'
import type { SessionForkError } from '@janhq/jan-api-session-controller/client'
import { createSnapshotStore } from '@janhq/jan-client-store'
import type { ShortcutCommand, ShortcutCommandId } from '@janhq/jan-client-shortcuts/client'
import type { SnapshotStore } from '@janhq/jan-client-store'
import type { SessionId } from '@janhq/jan-session/types'
import type { UiWorkspace } from './navigation.ts'

/** Transient requests consumed by the existing workspace browser. */
export interface WorkspaceShortcutState {
  readonly searchRequest: number
  readonly addRequested: boolean
  /** The control a surface outside the sidebar opened the new-project menu from; null anchors it to the sidebar's add button. */
  readonly addAnchor: HTMLElement | null
  readonly directoryBusy: boolean
  readonly renameTarget: { readonly sessionId: SessionId; readonly currentTitle: string } | null
}

interface WorkspaceShortcutControls {
  state: SnapshotStore<WorkspaceShortcutState>
  search: () => void
  add: (anchor?: HTMLElement) => void
  closeAdd: () => void
  directoryBusy: (busy: boolean) => void
  rename: (sessionId: SessionId, currentTitle: string) => void
  closeRename: () => void
}

/**
 * Create the private browser request source shared by commands and controls.
 * @param openSearchSurface - offers Search to a registered replacement surface; false keeps the sidebar field.
 * @returns observable state and its complete mutation callbacks.
 */
export function createWorkspaceShortcutControls(openSearchSurface: () => boolean = () => false): WorkspaceShortcutControls {
  const state = createSnapshotStore<WorkspaceShortcutState>({
    searchRequest: 0, addRequested: false, addAnchor: null, directoryBusy: false, renameTarget: null,
  })
  return {
    state,
    search: () => {
      if (openSearchSurface()) return
      state.set({ ...state.getSnapshot(), searchRequest: state.getSnapshot().searchRequest + 1 })
    },
    add: (anchor?: HTMLElement) => {
      if (state.getSnapshot().directoryBusy) return
      state.set({ ...state.getSnapshot(), addRequested: true, addAnchor: anchor ?? null })
    },
    closeAdd: () => { state.set({ ...state.getSnapshot(), addRequested: false, addAnchor: null }) },
    directoryBusy: (busy: boolean) => { state.set({ ...state.getSnapshot(), directoryBusy: busy }) },
    rename: (sessionId: SessionId, currentTitle: string) => {
      state.set({ ...state.getSnapshot(), renameTarget: { sessionId, currentTitle } })
    },
    closeRename: () => { state.set({ ...state.getSnapshot(), renameTarget: null }) },
  }
}

/**
 * Register navigation commands against the existing workspace owner.
 * Rename requires a nonblank main Conversation with no modal other than the navigation drawer obscuring it.
 * @param ctx - plugin context with the shortcut, locale, and model services.
 * @param navigation - session creation and forking from the pointer controls' navigation service.
 * @param controls - browser-owned opening requests.
 * @param archiveSession - shared archive action, including running-work confirmation and notices.
 * @param reportForkFailure - publish a classified failure through the frame-wide notice channel.
 */
export function installWorkspaceShortcuts(
  ctx: Context,
  navigation: Pick<UiWorkspace, 'startSession' | 'forkSession'>,
  controls: ReturnType<typeof createWorkspaceShortcutControls>,
  archiveSession: (sessionId: SessionId) => void,
  reportForkFailure: (reason: 'unavailable' | 'failed') => void,
): void {
  const t = ctx.locale.bind('workspace')
  const current = () => Object.values(ctx.sessions.list.getSnapshot().byId)
    .find(row => (row.retainedBy.mainView ?? 0) > 0)
  const addReason = () => ctx.slots.entries('sidebar.workspaces.directoryFlow').length === 0
    ? t('shortcut.noPicker')
    : controls.state.getSnapshot().directoryBusy ? t('shortcut.directoryBusy') : null
  const register = (id: string, label: () => string, aliases: string[], code: string,
    modifiers: ('primary' | 'alt' | 'shift')[], webModifiers: ('primary' | 'alt' | 'shift')[], resolve: ShortcutCommand['resolve']): void => {
    ctx.effect(() => ctx.shortcuts.register({
      id: id as ShortcutCommandId, label, aliases, defaults: {
        'desktop:macos': { code, modifiers }, 'desktop:windows': { code, modifiers }, 'desktop:linux': { code, modifiers },
        'web:macos': { code, modifiers: webModifiers }, 'web:windows': { code, modifiers: webModifiers },
      },
      regions: ['page', 'editable'], modals: ['sidebar'], resolve,
    }), `ui-workspace: ${id}`)
  }
  register('session.new', () => t('session.new'), ['new session', 'new chat'], 'KeyN', ['primary'], ['primary', 'alt'],
    ({ target, modal }) => {
      const desk = modal === null ? ctx.get('uiConversation')?.desk : undefined
      const pane = desk?.paneForTarget(target)
      return { status: 'handled', run: () => { if (desk !== undefined && pane !== undefined) desk.addTab(pane); else navigation.startSession() } }
    })
  register('session.search', () => t('search.sessions.aria'), ['search sessions'], 'KeyK', ['primary'], ['primary', 'alt'],
    () => ({ status: 'handled', run: controls.search }))
  register('workspace.add', () => t('workspace.add'), ['add workspace', 'open folder'], 'KeyO', ['primary'], ['primary', 'alt'],
    () => {
      const reason = addReason()
      return reason === null ? { status: 'handled', run: () => { controls.add() } } : { status: 'blocked', reason }
    })
  register('session.rename', () => t('rename.session.title'), ['rename session'], 'KeyG', ['primary', 'alt'], ['primary', 'alt'], (context) => {
    const target = current()
    return target === undefined || target.blank || (context.modal !== null && context.modal !== 'sidebar') || ctx.layout.panelInfo.getSnapshot().activePanelId !== null
      ? { status: 'blocked', reason: t('shortcut.noSession') }
      : { status: 'handled', run: () => { controls.rename(target.id, target.title?.trim() ?? '') } }
  })
  register('session.fork', () => t('menu.fork'), ['fork session'], 'KeyF', ['primary', 'alt'], ['primary', 'shift'], () => {
    const target = current()
    if (target === undefined) return { status: 'blocked', reason: t('shortcut.noSession') }
    if (target.blank) return { status: 'blocked', reason: t('shortcut.noCompletedTurn') }
    return {
      status: 'handled', run: () => {
        // The main view owns history opening for this target.
        void navigation.forkSession(target.id).catch((error: unknown) => {
          // Client plugin bundles do not share error-class identity.
          const unavailable = error instanceof Error && error.name === 'SessionForkError'
            && (error as SessionForkError).rpcError.code === 'session/fork-unavailable'
          reportForkFailure(unavailable ? 'unavailable' : 'failed')
          if (!unavailable) console.warn('session fork rejected:', error)
        })
      },
    }
  })
  register('session.archive', () => t('menu.archiveSession'), ['archive session'], 'KeyA', ['primary', 'shift'], ['primary', 'alt'], () => {
    const target = current()
    return target === undefined ? { status: 'blocked', reason: t('shortcut.noSession') }
      : {
        status: 'handled', run: () => {
          archiveSession(target.id)
        },
      }
  })
}
