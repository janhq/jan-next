/** Main Conversation desk; each added pane leases its own Session binding. */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { Dispatch, ReactNode, SetStateAction } from 'react'
import { DockSurface, dockPaneIds, getPane, MAX_DOCK_PANES } from '@janhq/jan-client-ui-dockkit'
import type { DockLabels, PaneId, TabId, TabRecord } from '@janhq/jan-client-ui-dockkit'
import type { ISessions, SessionReference } from '@janhq/jan-api-session-controller/client'
import type { SessionId } from '@janhq/jan-session/types'
import type { PropsLocale, PropsRenderSlots, PropsRuntime } from '@janhq/jan-client-ui-slots'
import { IconChatOutlineRegular, MenuItemButton, useTitleMarquee } from '@janhq/jan-client-ui-primitives'
import type {} from '../contract/slots.ts'
import { ConversationDeskContext } from './ConversationDesk.tsx'
import type { ConversationDeskSeat } from './ConversationDesk.tsx'
import { tabSessionId, type ConversationLayout } from './multitask-layout.ts'
import css from './ConversationDesk.module.css'

declare module '@janhq/jan-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    /** An explicit Session in the main split or Active view. */
    conversationPane: unknown
  }
}

/** Per-window layout and Session lease factory closed over by the main registration. */
export interface ConversationPanelInjected {
  readonly layout: ConversationLayout
  readonly retainPane: (id: SessionId) => SessionReference
  /** Desktop window bridge; the main window has no id. */
  readonly desktop?: {
    readonly id?: string | undefined
    readonly moveSession: (sessionId: SessionId) => Promise<void>
  } | undefined
}

type Props = PropsRuntime<'main'> & PropsRenderSlots<'main.conversation' | 'conversation.desk.new-tab.item'>
  & PropsLocale<'conversation'> & ConversationPanelInjected

/**
 * Chat tab label. Clipped, it ends in an ellipsis; while the pointer rests on
 * its chip it crawls to its last character and returns on leave, like a sidebar
 * chat row (the stylesheet drops the ellipsis and fades the cut edges).
 */
function ChatTabTitle({ label }: { readonly label: string }) {
  const titleRef = useRef<HTMLSpanElement>(null)
  const marquee = useTitleMarquee(titleRef)
  useEffect(() => {
    const chip = titleRef.current?.closest<HTMLElement>('[data-dockkit-tab]')
    /* v8 ignore next -- defensive: dockkit always renders the title inside its chip. */
    if (chip == null) return
    chip.addEventListener('pointerenter', marquee.enter)
    chip.addEventListener('pointerleave', marquee.leave)
    return () => {
      chip.removeEventListener('pointerenter', marquee.enter)
      chip.removeEventListener('pointerleave', marquee.leave)
    }
  }, [marquee])
  return <span ref={titleRef} className={css.chatTitle} title={label}>{label}</span>
}

function LeasedConversation({ id, retainPane, SessionProvider, children }: {
  readonly id: SessionId
  readonly retainPane: ConversationPanelInjected['retainPane']
  readonly SessionProvider: Props['SessionProvider']
  readonly children: ReactNode
}) {
  const [reference, setReference] = useState<SessionReference>()
  useLayoutEffect(() => {
    const next = retainPane(id)
    setReference(next)
    return () => { next.release() }
  }, [id, retainPane])
  return reference === undefined ? null : <SessionProvider session={reference}>{children}</SessionProvider>
}

type StripTargets = Partial<Record<TabId, HTMLElement>>

function StripTarget({ id, setTargets }: {
  readonly id: TabId
  readonly setTargets: Dispatch<SetStateAction<StripTargets>>
}) {
  const ref = useCallback((element: HTMLDivElement | null) => {
    setTargets((targets) => {
      if (element !== null) return { ...targets, [id]: element }
      return Object.fromEntries(Object.entries(targets).filter(([key]) => key !== id)) as StripTargets
    })
  }, [id, setTargets])
  return <div className={css.stripTarget} ref={ref} />
}

/** @param props - main slot and retained-pane services. @returns the tabbed desk. */
export function ConversationPanel({ renderSlot, SessionProvider, layout, retainPane, desktop, useSessions, t }: Props) {
  const view = useSyncExternalStore(layout.subscribe, layout.getSnapshot, layout.getSnapshot)
  const [targets, setTargets] = useState<StripTargets>({})
  const moving = useRef(new Set<TabId>())
  const { dock } = view
  const panes = dockPaneIds(dock)
  const leadingTab = getPane(dock, panes[0] ?? dock.activePaneId).activeTabId
  const selected = getPane(dock, dock.activePaneId).activeTabId
  const list = useSessions(value => value)
  const renderTab = (tab: TabRecord): ReactNode => {
    const leading = tab.id === leadingTab
    const id = tabSessionId(tab)
    const seat: ConversationDeskSeat = { leading, primary: tab.id === selected, stripTarget: targets[tab.id] }
    const content = renderSlot('main.conversation', {})
    // The selected tab is the Workspace selection: it inherits the window's
    // Session binding, so the Hero tree survives its first Session. Any other
    // blank tab is an explicitly absent binding, whose body is the Hero. A
    // restored tab waits for the catalog to list its Session before leasing it.
    return (
      <div className={css.pane} data-desk-secondary={!leading || undefined} data-desk-multiple={panes.length > 1 || undefined}>
        <ConversationDeskContext.Provider value={seat}>
          {seat.primary ? content
            : id === undefined ? <SessionProvider session={undefined} empty={() => content}>{content}</SessionProvider>
              : list.byId[id] === undefined ? null : (
                <LeasedConversation key={id} id={id} retainPane={retainPane} SessionProvider={SessionProvider}>
                  {content}
                </LeasedConversation>
              )}
        </ConversationDeskContext.Provider>
      </div>
    )
  }
  const moveToWindow = (tabId: TabId): void => {
    const tab = layout.getSnapshot().dock.tabs[tabId]
    const id = tab === undefined ? undefined : tabSessionId(tab)
    if (desktop === undefined || id === undefined || list.byId[id]?.origin === 'subagent' || moving.current.has(tabId)) return
    moving.current.add(tabId)
    void desktop.moveSession(id).then(() => { layout.closeTab(tabId, id) }, (error: unknown) => {
      console.error('Could not move chat to a new window:', error)
    }).finally(() => { moving.current.delete(tabId) })
  }
  const split = t('desk.split')
  const close = t('desk.closeTab')
  const labels: DockLabels = {
    emptyPane: t('desk.empty'), splitPane: split, splitPaneDisabled: t('desk.limit'), splitPaneNarrow: split,
    closeTab: close, addTab: t('desk.addTab'), dockFloat: split, closeFloat: close,
    dropZone: { top: split, bottom: split, left: split, right: split, center: split },
  }
  // The `+` opens a menu: a blank chat first, then whatever plugins open for the pane's chat.
  const renderAddTabMenu = (paneId: PaneId, dismiss: () => void): ReactNode => {
    const tabId = getPane(dock, paneId).activeTabId
    const tab = tabId === undefined ? undefined : dock.tabs[tabId]
    return (
      <>
        <MenuItemButton icon={<IconChatOutlineRegular size={16} />} onSelect={() => { dismiss(); layout.addTab(paneId) }}>
          {t('desk.newChat')}
        </MenuItemButton>
        {renderSlot('conversation.desk.new-tab.item', { sessionId: tab === undefined ? undefined : tabSessionId(tab), dismiss })}
      </>
    )
  }
  // `data-chat-tabs` scopes the desk's strip overrides above ui-dockkit's own tab rules.
  return (
    <div className={css.desk} data-chat-tabs="">
      <DockSurface state={dock} intents={layout} labels={labels} canSplit={panes.length < MAX_DOCK_PANES}
        showSplitControl={false} tabListLabel={t('desk.chatTabs')} dividerLabel={t('desk.resize')} renderTab={renderTab}
        renderAddTabMenu={renderAddTabMenu}
        renderTabTitle={(tab) => {
          const id = tabSessionId(tab)
          const row = id === undefined ? undefined : list.byId[id]
          // An untitled chat reads "New chat", not its project folder's name; a subagent keeps its label.
          const label = (row?.title ?? (row?.origin === 'subagent' ? row.displayTitle : undefined)) || t('desk.newChat')
          return <ChatTabTitle label={label} />
        }}
        renderTabActions={tab => <StripTarget id={tab.id} setTargets={setTargets} />}
        {...desktop === undefined ? {} : {
          onTabReleasedOutsideViewport: moveToWindow,
          renderTabMenuItems: (tab, dismiss) => {
            const id = tabSessionId(tab)
            return id === undefined || list.byId[id]?.origin === 'subagent' ? null : (
              <MenuItemButton onSelect={() => { dismiss(); moveToWindow(tab.id) }}>{t('desk.moveToNewWindow')}</MenuItemButton>
            )
          },
        }} />
    </div>
  )
}

/** @param sessions - Session controller. @returns a stable acquisition function for pane occurrences. */
export function paneRetainer(sessions: ISessions): ConversationPanelInjected['retainPane'] {
  return id => sessions.retain(id, { source: 'conversationPane' })
}
