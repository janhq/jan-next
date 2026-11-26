import type { } from '@janhq/jan-client-ui-context-menu/client'
/** Registers the target-neutral Conversation assembly, shell, input, and docks. */
import type { } from '@janhq/jan-client-product-analytics/client'
import type { Context } from '@janhq/cordis'
import z from '@janhq/schemastery'
import type { ISessions, SessionBinding } from '@janhq/jan-api-session-controller/client'
import { IconCompareSplitOutlineRegular, IconPaperclipOutlineRegular, IconPlusOutlineRegular } from '@janhq/jan-client-ui-primitives'
import { createSnapshotStore, type BoundActions } from '@janhq/jan-client-store'
import { resolveSlotLabel } from '@janhq/jan-client-ui-slots'
import type { SessionId } from '@janhq/jan-session/types'
// Type-only service and declaration merges used by this assembly.
import type { } from '@janhq/jan-client-locale/client'
import type { } from '@janhq/jan-client-ui-renderer/client'
import type { } from '@janhq/jan-client-ui-session/client'
import type { } from '@janhq/jan-client-ui-settings/client'
import type { ShortcutCommandId, ShortcutFixedCommand } from '@janhq/jan-client-shortcuts/client'
import { UiConversation } from './conversation/assembly.ts'
import { UserText, PlainUserText, SessionReference } from './user-text/UserText.tsx'
import { sessionReferenceRule } from './user-text/session-reference-rule.ts'
import { collapseWhitespaceRule, trimWhitespaceRule } from './user-text/whitespace-rules.ts'
import type { ViewTab } from './contract/views.ts'
import type {
  ComposerBarInjected, ConversationInjected, ConversationSessionHeaderInjected,
  ConversationSessionInjected, DraftFileUploads, UserTextInjected,
} from './contract/slots.ts'
import type { InputNotice } from './contract/input.ts'
import type { ReferenceInsert } from './contract/draft-editor.ts'
import { createConversationStore, readConversationViewPreference } from './stores.ts'
import { formatFileMention } from '@janhq/jan-file-reference/grammar'
import { relativizeToCwd, workspaceTitleOf } from '@janhq/jan-util-workspace-path'
import { ConversationController, UnsupportedImageMediaTypeError, isImageMediaType } from './service.ts'
import type { IConversation } from './service.ts'
import { ComposerBlockRegistry } from './input/blocks.ts'
import type { ComposerBlock } from './contract/composer-blocks.ts'
import { InputHub } from './input/hub.ts'
import { focusDraftEditor, revealDraftSelection } from './input/editor/view-binding.ts'
import { ComposerSubmissionPolicy } from './input/submission-policy.ts'
import { queueDockEntry } from './queue/QueueDock.tsx'
import { EnterBehaviorRow } from './settings/EnterBehaviorRow.tsx'
import type { EnterBehaviorRowInjected } from './settings/EnterBehaviorRow.tsx'
import { ConversationRoot } from './skeleton/ConversationRoot.tsx'
import { ConversationContent } from './skeleton/ConversationContent.tsx'
import { ConversationPanel, paneRetainer, type ConversationPanelInjected } from './skeleton/ConversationPanel.tsx'
import { ConversationLayout, MULTITASK_LAYOUT_KEY } from './skeleton/multitask-layout.ts'
import { ConversationHeader } from './skeleton/ConversationHeader.tsx'
import { ConversationSession, ConversationSessionHeader } from './skeleton/ConversationSession.tsx'
import { InputBar } from './skeleton/InputBar.tsx'
import { todoDockEntry } from './skeleton/TodoPanel.tsx'
import { installStopShortcut } from './stop-shortcut.ts'
import { TRAJECTORY_VIEW_ID, resolveActiveView } from './view-selection.ts'
import { createViewPins } from './view-pins.ts'
import { en, ja, es, fr, de, ru, pt, NS, zh, type ConversationKey } from './locales.ts'
import { CONVERSATION_SETTINGS_NAMESPACE, type ConversationSettings } from '../submission-settings.ts'

declare module '@janhq/jan-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Conversation shell, composer, queue, and dock copy. */
    conversation: ConversationKey
  }
}

/** Services required by the Conversation plugin. */
export const inject = [
  'slots', 'sessions', 'fileUpload', 'uiSession', 'uiWorkspace', 'workspaces', 'locale', 'configForms',
]

/** Conversation runtime configuration. */
export interface Config {
  /** Maximum generic-file uploads allowed to run concurrently in browser Workers. */
  maxConcurrentFileUploads?: number
}

/** Validated Conversation runtime configuration. */
export const Config: z<Config> = z.object({
  maxConcurrentFileUploads: z.natural().min(1).default(2),
})

// Stable no-session sources keep the renderer's observable-hook cache and
// hook order unchanged across current-Session transitions.
const ABSENT_NOTICES = {
  getSnapshot: (): InputNotice | null => null,
  subscribe: () => () => { },
}
const ABSENT_BLOCK = {
  getSnapshot: (): ComposerBlock | undefined => undefined,
  subscribe: () => () => { },
}
const EMPTY_LEXICON: ReadonlyMap<'/' | '@', readonly string[]> = new Map()
const ABSENT_LEXICON = {
  getSnapshot: () => EMPTY_LEXICON,
  subscribe: () => () => { },
}
const ABSENT_MENU_LAUNCHER = {
  getSnapshot: (): string | null => null,
  subscribe: () => () => { },
}
const ABSENT_CONTEXT_WINDOW = {
  getSnapshot: (): number | undefined => undefined,
  subscribe: () => () => { },
}
const EMPTY_FILE_UPLOADS: DraftFileUploads = {}
const ABSENT_FILE_UPLOADS = {
  getSnapshot: () => EMPTY_FILE_UPLOADS,
  subscribe: () => () => { },
}

/**
 * Browser-shell bridge reporting the harness-host path of a picked file. The
 * Desktop preload exposes it on the application document; a served Web page
 * has none, so every non-image file uploads there.
 */
interface HostPathBridge {
  /** Absolute harness-host path of one picked file, or empty when the shell has none for it. */
  pathFor(file: File): string
}

/** The shell-installed bridge, when this document runs inside the Desktop application. */
function hostPathBridge(): HostPathBridge | undefined {
  return (globalThis as { __JAN_HOST_PATHS__?: HostPathBridge }).__JAN_HOST_PATHS__
}

interface WorkspaceNavigation {
  openSession(sessionId: SessionId): void
  showEmptyConversation?(): void
  registerSessionTabOpener?(open: (sessionId: SessionId) => void): () => void
  openWorkspace(
    workspaceId: Parameters<ConversationInjected['selectWorkspace']>[0] | undefined,
    beforeOpen: (sessionId: SessionId) => void,
    options?: { readonly reuseBlank: boolean },
  ): Promise<void>
}

/** Action registration used by the composer without importing its command-UI consumer. */
interface FileCommandRegistry {
  register(contribution: {
    name: string
    label(): string
    icon: typeof IconPaperclipOutlineRegular
    available(session: { sessionId: SessionId }): boolean
    ui: { kind: 'action'; run(session: { sessionId: SessionId }): void }
  }): () => void
}

/** Resolve the session-scoped Conversation action face, failing loud. */
function scopedConversation(sessions: ISessions, id: SessionId): IConversation {
  const scoped = sessions.scope(id)
  if (scoped === undefined) throw new Error(`ui-conversation: session "${id}" resolved no scope`)
  const conversation = scoped.get('conversation')
  if (conversation === undefined) {
    throw new Error('ui-conversation: conversation service unavailable through the session scope')
  }
  return conversation
}

/** Resolve package-internal attachment operations from the public service. */
function concreteConversation(ctx: Context): ConversationController {
  const conversation = ctx.get('conversation') as ConversationController | undefined
  if (conversation === undefined) throw new Error('ui-conversation: conversation service unavailable')
  return conversation
}

/**
 * Mount the Conversation core and target-neutral presentation.
 * @param ctx - Client root context.
 */
export function apply(ctx: Context, config: Config = Config({})): void {
  const sessions = ctx.sessions
  const slots = ctx.slots
  // Schemastery's field default is materialized before Cordis calls apply.
  const maxConcurrentFileUploads = config.maxConcurrentFileUploads as number
  const workspaceNavigation = ctx.get('uiWorkspace') as WorkspaceNavigation
  const uiConversation = new UiConversation(ctx, sessions)
  uiConversation.userText.register(sessionReferenceRule)
  uiConversation.userText.register(collapseWhitespaceRule)
  uiConversation.userText.register(trimWhitespaceRule)
  slots.registerFactory({
    name: 'conversation.user.text',
    scope: 'session',
    children: {
      'conversation.user.text.node': { kind: 'keyed', scope: 'session', inline: true },
    },
    inject: (): UserTextInjected => ({
      hooks: {
        userTextRevision: {
          getSnapshot: () => uiConversation.userText.getSnapshot(),
          subscribe: listener => uiConversation.userText.subscribe(listener),
        },
      },
      createUserTextEvaluator: () => uiConversation.userText.createEvaluator(),
      reportTransformFailure: (error) => { console.error('[ui-conversation] user-text transformation failed:', error) },
    }),
  }, UserText)
  slots.inject('conversation.user.text.node', function*() {
    yield slots.register({ name: 'conversation.user.text.node', key: 'text', priority: 100 }, PlainUserText)
    yield slots.register({ name: 'conversation.user.text.node', key: 'session', priority: 100 }, SessionReference)
  })

  ctx.effect(() => ctx.locale.register(NS, { zh, en, ja, es, fr, de, ru, pt }), 'ui-conversation: dictionaries')
  const t = ctx.locale.bind(NS)
  const desktop = (globalThis as { janConversationWindow?: ConversationPanelInjected['desktop'] }).janConversationWindow
  const storageKey = desktop?.id === undefined ? MULTITASK_LAYOUT_KEY : `${MULTITASK_LAYOUT_KEY}.${desktop.id}`
  const layout = new ConversationLayout(globalThis.localStorage.getItem(storageKey) ?? undefined,
    (value) => { globalThis.localStorage.setItem(storageKey, value) },
    (id) => {
      if (id === undefined) workspaceNavigation.showEmptyConversation?.()
      else workspaceNavigation.openSession(id)
    })
  const retainPane = paneRetainer(sessions)
  const mainBinding = ctx.uiSession.adapter.current
  const workspaces = ctx.workspaces.list
  ctx.effect(() => {
    const syncLayout = (): void => {
      const list = sessions.list.getSnapshot()
      const workspace = workspaces.getSnapshot()
      const archived = new Set(workspace.archivedSessionIds)
      layout.sync(mainBinding.getSnapshot().key as SessionId | undefined,
        list.phase === 'ready' && workspace.phase === 'ready' ? new Set(list.ids.filter(id => !archived.has(id))) : undefined)
    }
    syncLayout()
    const disposeTabOpener = workspaceNavigation.registerSessionTabOpener?.(layout.openInNewTab)
    const unsubscribers = [sessions.list, mainBinding, workspaces].map(source => source.subscribe(syncLayout))
    return () => {
      disposeTabOpener?.()
      for (const unsubscribe of unsubscribers) unsubscribe()
    }
  }, 'ui-conversation: synchronize multitask layout')
  ctx.inject(['contextMenus', 'layout'], (scope) => {
    scope.slots.inject('contextMenu.icon', function* () {
      yield scope.slots.register({ name: 'contextMenu.icon', key: 'conversation.newTab' }, IconPlusOutlineRegular)
      yield scope.slots.register({ name: 'contextMenu.icon', key: 'conversation.openBeside' }, IconCompareSplitOutlineRegular)
    })
    scope.effect(() => scope.contextMenus.register({
      id: 'session.tabs', target: 'session', order: 350,
      observe: () => [layout, sessions.list, workspaces, ctx.locale],
      resolve: ({ sessionId }) => {
        const row = sessions.list.getSnapshot().byId[sessionId]
        if (row === undefined || row.blank || row.origin === 'subagent'
          || workspaces.getSnapshot().archivedSessionIds.includes(sessionId)) return []
        const openTab = { id: 'new-tab', label: t('desk.openInNewTab'), icon: { key: 'conversation.newTab' }, run: () => {
          scope.layout.selectPanel(null)
          layout.openInNewTab(sessionId)
        } }
        return !layout.canOpenBeside(sessionId) ? [openTab] : [openTab, {
          id: 'split', label: t('desk.openBeside'), icon: { key: 'conversation.openBeside' }, run: () => {
            scope.layout.selectPanel(null)
            layout.openBeside(sessionId)
          },
        }]
      },
    }), 'ui-conversation: session tab menu')
  })
  const conversationStore = createConversationStore()
  const conversationForm = ctx.configForms.get<ConversationSettings & { heroPlaceholder?: string }>(CONVERSATION_SETTINGS_NAMESPACE)
  const submissionPolicy = new ComposerSubmissionPolicy(conversationForm)
  const heroPlaceholder = {
    getSnapshot: (): string | undefined => conversationForm.getSnapshot().value?.heroPlaceholder || undefined,
    subscribe: (listener: () => void) => conversationForm.subscribe(listener),
  }

  ctx.effect(() => () => { submissionPolicy.dispose() })

  ctx.slots.inject('settings.agentLoop.item', () => ctx.slots.register({
    name: 'settings.agentLoop.item',
    id: 'composer-enter',
    order: 20,
    locale: NS,
    inject: (): EnterBehaviorRowInjected => ({
      hooks: { busyEnter: submissionPolicy.busyEnter },
      setBusyEnter: (behavior) => { submissionPolicy.setBusyEnter(behavior) },
    }),
  }, EnterBehaviorRow))

  const viewTabs = (): ViewTab[] => {
    const tabs: ViewTab[] = []
    for (const entry of slots.entries('conversation.view')) {
      /* v8 ignore next -- list registration validates id at load. */
      if (entry.options.id === undefined) continue
      if (!ctx.configForms.developerTools.enabled.getSnapshot() && entry.options.id === TRAJECTORY_VIEW_ID) continue
      tabs.push({
        id: entry.options.id,
        label: resolveSlotLabel(entry.options.label) ?? entry.options.id,
      })
    }
    return tabs
  }
  const activateView = (sessionId: SessionId, preferred: string | null): void => {
    const active = resolveActiveView(viewTabs(), preferred)
    if (active !== undefined) uiConversation.binding(sessionId).activate(active.id)
  }
  const restoreView = (sessionId: SessionId): void => {
    activateView(sessionId, readConversationViewPreference(sessionId))
  }
  const conversationViews = createSnapshotStore<readonly ViewTab[]>(viewTabs())
  const viewPins = createViewPins()
  const viewActions = {
    getSnapshot: () => slots.entriesOfSlot('conversation.session.header.views.actions').length > 0,
    subscribe: (listener: () => void) => slots.subscribe('conversation.session.header.views.actions', listener),
  }
  const bindings = new Set<SessionBinding>()
  const trackedBindings = new WeakSet<SessionBinding>()
  const trackBinding = (binding: SessionBinding): void => {
    if (trackedBindings.has(binding)) return
    trackedBindings.add(binding)
    bindings.add(binding)
    binding.ctx.effect(() => () => { bindings.delete(binding) }, 'ui-conversation: active Provider binding')
  }
  const refreshViews = (): void => {
    const current = conversationViews.getSnapshot()
    const next = viewTabs()
    const unchanged = current.length === next.length
      && current.every((tab, index) => {
        const candidate = next.at(index)
        return candidate !== undefined && tab.id === candidate.id && tab.label === candidate.label
      })
    if (!unchanged) conversationViews.set(next)
    for (const binding of bindings) restoreView(binding.sessionId)
  }
  ctx.effect(() => {
    const disposeViews = slots.subscribe('conversation.view', refreshViews)
    const disposeLocale = ctx.locale.subscribe(refreshViews)
    const disposeDeveloperTools = ctx.configForms.developerTools.enabled.subscribe(refreshViews)
    return () => {
      disposeDeveloperTools()
      disposeLocale()
      disposeViews()
    }
  }, 'ui-conversation: View selection')

  const stop = (sessionId: SessionId): void => {
    scopedConversation(sessions, sessionId).cancel().catch((_error: unknown) => {
      // Stop failure is published through Session promptError.
    })
  }
  const stopShortcut = createSnapshotStore<readonly string[]>([])
  ctx.inject(['shortcuts'], (scope) => {
    const fixedInputs: readonly ShortcutFixedCommand[] = [
      {
        id: 'fixed.send' as ShortcutCommandId, label: () => t('input.send'), keys: ['Enter'],
        bindings: [{ code: 'Enter', modifiers: [] }], group: 'input',
      },
      {
        id: 'fixed.newline' as ShortcutCommandId, label: () => t('shortcut.newline'),
        keys: scope.shortcuts.describeBinding({ code: 'Enter', modifiers: ['shift'] }).keys,
        bindings: [{ code: 'Enter', modifiers: ['shift'] }], group: 'input',
      },
      {
        id: 'fixed.complementary' as ShortcutCommandId, label: () => t('shortcut.complementary'),
        keys: scope.shortcuts.describeBinding({ code: 'Enter', modifiers: ['primary'] }).keys,
        bindings: [{ code: 'Enter', modifiers: ['control'] }, { code: 'Enter', modifiers: ['meta'] }], group: 'input',
      },
      {
        id: 'fixed.slash' as ShortcutCommandId, label: () => t('shortcut.slash'), keys: ['/'],
        bindings: [{ code: 'Slash', modifiers: [] }], group: 'input',
      },
      {
        id: 'fixed.mention' as ShortcutCommandId, label: () => t('shortcut.mention'), keys: ['@'],
        bindings: [{ code: 'Digit2', modifiers: ['shift'] }], group: 'input',
      },
    ]
    for (const command of fixedInputs) {
      scope.effect(() => scope.shortcuts.registerFixed(command), `ui-conversation: ${command.id}`)
    }
    scope.effect(() => installStopShortcut(
      scope.shortcuts, sessions, binding => uiConversation.binding(binding).openTurn, ctx.uiSession, stop,
    ), 'ui-conversation: fixed stop input')
    scope.effect(() => {
      const command: ShortcutFixedCommand = {
        id: 'response.stop' as ShortcutCommandId, label: () => t('input.stop'), keys: ['Esc', 'Esc'], bindings: [{ code: 'Escape', modifiers: [] }], group: 'input',
      }
      const dispose = scope.shortcuts.registerFixed(command)
      stopShortcut.set(command.keys)
      return () => { stopShortcut.set([]); dispose() }
    }, 'ui-conversation: fixed stop reference')
  })

  const inputHub = new InputHub(ctx, t)
  const composerBlocks = new ComposerBlockRegistry()

  ctx.inject(['commandUi'], (scope) => {
    const commands = scope.get('commandUi') as FileCommandRegistry
    scope.effect(() => commands.register({
      name: 'file',
      label: () => t('input.file'),
      icon: IconPaperclipOutlineRegular,
      available: session => inputHub.canPickFiles(session.sessionId),
      ui: { kind: 'action', run: (session) => { inputHub.pickFiles(session.sessionId) } },
    }), 'ui-conversation: File action')
  })

  // Conversation assembly and input share the Session binding lifecycle. The
  // source roster is installed before any consuming Slot entry.
  ctx.uiSession.provide({
    hooks: ['conversation', 'input'],
    props: ['inputActions'],
    resolve: (binding) => {
      trackBinding(binding)
      const shell = inputHub.shellFor(binding)
      const conversation = uiConversation.binding(binding)
      restoreView(binding.sessionId)
      return {
        hooks: {
          conversation: conversation.snapshot,
          input: shell.state,
        },
        props: { inputActions: shell.actions },
      }
    },
  })

  const registerConversationRoot = () => slots.register({
    name: 'main.conversation',
    children: {
      'conversation.header': { kind: 'single', scope: 'session-maybe' },
    },
  }, ConversationRoot)

  const registerConversationContent = () => slots.registerFactory({
    name: 'conversation.content',
    scope: 'session-maybe',
    locale: NS,
    children: {
      'conversation.session': { kind: 'single', scope: 'session' },
      'conversation.composer': { kind: 'chain', scope: 'session' },
      'conversation.composer.bar': { kind: 'single', scope: 'session-maybe' },
      'conversation.input.dock': { kind: 'list', scope: 'session' },
      'conversation.hero.frame': { kind: 'hoc', scope: 'root' },
      'conversation.hero.headline': { kind: 'single', scope: 'root' },
      'conversation.hero.suggestions': { kind: 'single', scope: 'session-maybe' },
      'conversation.hero.brand.mark': { kind: 'single', scope: 'root' },
      'conversation.hero.workspace': { kind: 'single', scope: 'root' },
      'conversation.hero.agentPreset': { kind: 'single', scope: 'session-maybe' },
      'conversation.composer.agentPreset': { kind: 'single', scope: 'session' },
      'conversation.hero.options': { kind: 'list', scope: 'session' },
    },
    slots: {
      views: { scope: 'session' },
      widthControls: { scope: 'root' },
    },
    inject: (sessionId: SessionId | undefined): ConversationInjected => ({
      pickSuggestion: (text) => {
        if (sessionId === undefined) return
        const binding = sessions.binding(sessionId)
        const snapshot = binding?.session.getSnapshot()
        const shell = inputHub.shell(sessionId)
        if (snapshot === undefined || snapshot.removed || snapshot.subagent !== null
          || composerBlocks.storeFor(sessionId).getSnapshot() !== undefined
          || (shell.snapshot.phase !== 'plain' && shell.snapshot.phase !== 'claimed')) return
        shell.actions.setDraft(text)
        focusDraftEditor(shell.editor, () => {
          const scroll = shell.editor.getRootElement()?.closest<HTMLDivElement>('[data-input-scroll]') ?? null
          revealDraftSelection({ current: scroll })
        })
      },
      hooks: {
        composerBlock: sessionId === undefined ? ABSENT_BLOCK : composerBlocks.storeFor(sessionId),
        heroPlaceholder,
      },
      openDefaultDraft: readText => workspaceNavigation.openWorkspace(undefined, (nextId) => {
        const text = readText()
        if (text !== '') inputHub.shell(nextId).appendDraft(text, [])
      }, { reuseBlank: false }),
      selectWorkspace: (workspaceId, readText) => workspaceNavigation.openWorkspace(workspaceId, (nextId) => {
        if (sessionId === undefined) {
          const text = readText?.() ?? ''
          if (text !== '') inputHub.shell(nextId).appendDraft(text, [])
        } else if (nextId !== sessionId) {
          const from = inputHub.shell(sessionId)
          // A draft with a submission in flight stays with the Session that is admitting it.
          if (from.snapshot.phase !== 'plain' && from.snapshot.phase !== 'claimed') return
          const draft = from.draftSnapshot
          const attachmentIds = from.snapshot.attachmentIds
          const next = inputHub.shell(nextId)
          if (attachmentIds.length === 0 || next.addAttachments(attachmentIds)) {
            const binding = sessions.binding(nextId)
            if (binding === undefined) {
              throw new Error(`ui-conversation: session "${nextId}" resolved no binding`)
            }
            // The same rule as intake: only an ordinary Session stages image uploads.
            const ordinary = binding.session.getSnapshot().subagent === null
            concreteConversation(ctx).rebindDraftFiles(nextId, attachmentIds, ordinary)
            if (draft.text !== '') {
              next.setDraft(draft)
              from.setDraft('')
            }
            if (attachmentIds.length > 0) {
              for (const id of attachmentIds) from.removeAttachment(id)
            }
          }
        }
      }, { reuseBlank: sessionId !== undefined }),
    }),
  }, ConversationContent)

  const registerConversationSession = () => slots.register({
    name: 'conversation.session',
    children: {
      'conversation.view': { kind: 'list', scope: 'session' },
    },
    store: conversationStore,
    inject: (sessionId: SessionId, actions: BoundActions<typeof conversationStore>): ConversationSessionInjected => {
      const openView = (view: string, focus: string): void => {
        if (!viewTabs().some(tab => tab.id === view)) return
        activateView(sessionId, view)
        actions.openView(view, focus)
      }
      const inspectionTarget = () => uiConversation.views.entries().find(definition =>
        definition.toolCallFocus !== undefined
        && conversationViews.getSnapshot().some(view => view.id === definition.target),
      )
      const inspectCall = (callId: string): void => {
        const target = inspectionTarget()
        if (target?.toolCallFocus !== undefined) openView(target.target, target.toolCallFocus(callId))
      }
      return {
        hooks: {
          conversationViews,
          inspectCall: {
            getSnapshot: () => inspectionTarget() === undefined ? undefined : inspectCall,
            subscribe: (listener) => {
              const disposeViews = conversationViews.subscribe(listener)
              const disposeDefinitions = uiConversation.views.subscribe(listener)
              return () => { disposeViews(); disposeDefinitions() }
            },
          },
        },
        bindDraftPersistence: write => inputHub.shell(sessionId).bindDraftPersistence(write),
        openView,
      }
    },
  }, ConversationSession)

  const registerHeader = () => slots.register({
    name: 'conversation.header',
    locale: NS,
    children: {
      'conversation.header.leading': { kind: 'single', scope: 'root' },
      'conversation.session.header': { kind: 'single', scope: 'session' },
    },
  }, ConversationHeader)

  const registerSessionHeader = () => slots.register({
    name: 'conversation.session.header',
    locale: NS,
    children: {
      'conversation.session.header.lineage': { kind: 'single', scope: 'session' },
      'conversation.session.header.actions': { kind: 'list', scope: 'session' },
      'conversation.session.header.utilities': { kind: 'list', scope: 'session' },
      'conversation.session.header.identity': { kind: 'list', scope: 'session' },
      'conversation.session.header.corner': { kind: 'single', scope: 'session' },
      'conversation.session.header.views.actions': { kind: 'list', scope: 'root' },
    },
    store: conversationStore,
    inject: (sessionId: SessionId, actions: BoundActions<typeof conversationStore>): ConversationSessionHeaderInjected => ({
      hooks: { conversationViews, entryPins: viewPins.unpinned, entryActions: viewActions },
      setPinned: viewPins.setPinned,
      open: (id) => { workspaceNavigation.openSession(id) },
      selectView: (view) => {
        activateView(sessionId, view)
        actions.setView(view)
      },
    }),
  }, ConversationSessionHeader)

  const registerComposerBar = () => slots.register({
    name: 'conversation.composer.bar',
    locale: NS,
    children: {
      'conversation.input.placeholder': { kind: 'single', scope: 'session-maybe' },
      'conversation.input.attachments': { kind: 'single', scope: 'session-maybe' },
      'conversation.input.overlay': { kind: 'list', scope: 'session' },
      'conversation.input.permission': { kind: 'single', scope: 'session' },
      'conversation.input.left': { kind: 'list', scope: 'session' },
      'conversation.input.plan': { kind: 'single', scope: 'session' },
      'conversation.input.right': { kind: 'list', scope: 'session' },
      'conversation.input.model': { kind: 'single', scope: 'session' },
      'conversation.input.activity': { kind: 'single', scope: 'session' },
      'conversation.input.draftActivity': { kind: 'single', scope: 'session-maybe' },
      'conversation.composer.dock': { kind: 'list', scope: 'session' },
    },
    inject: (sessionId: SessionId | undefined): ComposerBarInjected => {
      if (sessionId === undefined) {
        return {
          keyboard: undefined,
          addFiles: undefined,
          removeAttachment: undefined,
          resolveDraftAttachments: undefined,
          retryFileUpload: undefined,
          toggleCommandMenu: undefined,
          stop: undefined,
          retry: undefined,
          previewContext: undefined,
          hooks: {
            stopShortcut,
            busyEnter: submissionPolicy.busyEnter,
            fileUploads: ABSENT_FILE_UPLOADS,
            notices: ABSENT_NOTICES,
            lexicon: ABSENT_LEXICON,
            menuLauncher: ABSENT_MENU_LAUNCHER,
            contextWindow: ABSENT_CONTEXT_WINDOW,
          },
        }
      }
      const conversation = concreteConversation(ctx)
      const shell = inputHub.shell(sessionId)
      const inputTriggers = inputHub.inputTriggers(sessionId)
      const bridge = hostPathBridge()
      return {
        keyboard: shell,
        addFiles: (files, directories = new Set()) => {
          if (sessions.binding(sessionId) === undefined) return t('file.sessionUnavailable')
          const { phase } = shell.snapshot
          if (phase === 'adjudicating' || phase === 'submitting' || phase === 'sending') {
            return t('attachment.dropBlocked')
          }
          const uploads: File[] = []
          const references: ReferenceInsert[] = []
          const cwd = sessions.list.getSnapshot().byId[sessionId]?.cwd
          for (const file of files) {
            const directory = directories.has(file)
            if (bridge === undefined && directory) return t('attachment.directoryDesktopOnly')
            const path = bridge?.pathFor(file) ?? ''
            if (directory && path === '') return t('attachment.pathUnavailable')
            if (path === '' || (!directory && isImageMediaType(file.type))) {
              uploads.push(file)
              continue
            }
            const relative = relativizeToCwd(path, cwd)
            // A completed directory chip needs closed quotes; the directory grammar keeps them open for drill.
            const mention = formatFileMention({ path: directory ? `${relative}/` : relative, kind: 'file' }, false)
            if (mention === undefined) return t('attachment.pathUnsupported')
            const label = workspaceTitleOf(path) || file.name
            references.push({
              source: 'reference', ref: mention, label: directory ? `${label}/` : label,
              appearance: directory ? 'folder' : 'file', clipboardText: mention,
            })
          }
          try {
            // The Host stages uploads for ordinary Sessions only; a subagent continuation's images travel inline.
            const ordinary = sessions.binding(sessionId)?.session.getSnapshot().subagent === null
            const drafts = conversation.createDrafts(sessionId, uploads, ordinary)
            if (!shell.addFiles(references, drafts.map(draft => draft.id))) {
              conversation.releaseDraftAttachments(drafts)
              return t('attachment.dropBlocked')
            }
            return null
          } catch (error: unknown) {
            if (error instanceof UnsupportedImageMediaTypeError) return t('image.unsupportedType')
            return error instanceof Error ? error.message : String(error)
          }
        },
        removeAttachment: (id) => {
          if (shell.removeAttachment(id)) conversation.releaseDraftAttachment(id)
        },
        resolveDraftAttachments: ids => conversation.resolveDraftAttachments(ids),
        retryFileUpload: (id) => {
          if (sessions.binding(sessionId) !== undefined) conversation.retryFileUpload(sessionId, id)
        },
        toggleCommandMenu: inputTriggers === undefined
          ? undefined
          : (selection) => {
            shell.dismissPopup()
            const snapshot = shell.snapshot
            inputTriggers.toggleSource('command', {
              trigger: '/',
              query: '',
              quoted: false,
              position: snapshot.draft.slice(0, selection.start).trim() === '' ? 'leading' : 'inline',
              span: { ...selection, draftRev: snapshot.draftRev },
            })
          },
        stop: () => { stop(sessionId) },
        retry: (failureSeq) => { inputHub.retry(sessionId, failureSeq) },
        previewContext: async () => {
          const result = await sessions.binding(sessionId)?.session.contextPreview()
          return result?.ok === true ? result.value : null
        },
        hooks: {
          stopShortcut,
          busyEnter: submissionPolicy.busyEnter,
          fileUploads: conversation.fileUploads,
          notices: shell.notices,
          lexicon: shell.lexicon,
          menuLauncher: inputTriggers?.launcher ?? ABSENT_MENU_LAUNCHER,
          contextWindow: inputHub.contextWindowOf(sessionId),
        },
      }
    },
  }, InputBar)

  slots.inject('main', function*() {
    yield slots.register({
      name: 'main',
      key: 'conversation',
      locale: NS,
      inject: () => ({ layout, retainPane, desktop }),
      children: {
        'main.conversation': { kind: 'single', scope: 'session-maybe' },
        'conversation.desk.new-tab.item': { kind: 'list', scope: 'root' },
      },
    }, ConversationPanel)
    yield registerConversationRoot()
    yield registerConversationContent()
    yield registerConversationSession()
    yield registerHeader()
    yield registerSessionHeader()
  })

  ctx.plugin(ConversationController, {
    input: inputHub,
    blocks: composerBlocks,
    maxConcurrentFileUploads,
  })
  ctx.inject(['conversation'], (scope) => {
    scope.slots.inject('conversation.composer.bar', registerComposerBar)
  })
  ctx.plugin(todoDockEntry)
  ctx.plugin(queueDockEntry)
}
