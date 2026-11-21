/** Main Conversation desk; each added pane leases its own Session binding. */
import { useLayoutEffect, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { DockSurface, dockPaneIds, getPane, MAX_DOCK_PANES } from '@janhq/jan-client-ui-dockkit'
import type { DockLabels, TabRecord } from '@janhq/jan-client-ui-dockkit'
import type { ISessions, SessionReference } from '@janhq/jan-api-session-controller/client'
import type { SessionId } from '@janhq/jan-session/types'
import type { PropsLocale, PropsRenderSlots, PropsRuntime } from '@janhq/jan-client-ui-slots'
import type {} from '../contract/slots.ts'
import { ConversationDeskActions, ConversationDeskContext } from './ConversationDesk.tsx'
import type { ConversationDeskSeat, ConversationDeskToolbarProps, DeskChoice } from './ConversationDesk.tsx'
import type { ConversationLayout } from './multitask-layout.ts'
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
}

type Props = PropsRuntime<'main'> & PropsRenderSlots<'main.conversation'> & PropsLocale<'conversation'> & ConversationPanelInjected

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

/** @param props - main slot and retained-pane services. @returns the manual or Active view. */
export function ConversationPanel({ renderSlot, SessionProvider, layout, retainPane, useSessions, useWorkspaces, t }: Props) {
  const view = useSyncExternalStore(layout.subscribe, layout.getSnapshot, layout.getSnapshot)
  const { dock, active } = view
  const panes = dockPaneIds(dock)
  const leadingPane = panes[0] ?? dock.activePaneId
  const leadingTab = getPane(dock, leadingPane).activeTabId
  const list = useSessions(value => value)
  const archived = useWorkspaces(value => value.archivedSessionIds)
  const paneCount = panes.length
  const openIds = new Set(Object.values(dock.tabs).map(tab => tab.contentId))
  const limitReached = paneCount >= MAX_DOCK_PANES
  const choices: DeskChoice[] = []
  if (!active && !limitReached) {
    const archivedIds = new Set(archived)
    for (const id of list.ids) {
      const row = list.byId[id]
      if (row !== undefined && !row.blank && row.origin !== 'subagent' && !openIds.has(id) && !archivedIds.has(id)) {
        choices.push({ id, label: row.displayTitle })
      }
    }
  }
  const toolbar: ConversationDeskToolbarProps = {
    active, runningCount: view.running.length, choices, limitReached,
    overflow: view.overflow.map(id => ({ id, label: list.byId[id]?.displayTitle ?? id })),
    openBeside: layout.openBeside, toggleActive: layout.toggleActive, focusActive: layout.focusActive,
  }
  const renderTab = (tab: TabRecord): ReactNode => {
    const leading = tab.id === leadingTab
    const primary = !active && leading
    const id = tab.contentId as SessionId
    const seat: ConversationDeskSeat = {
      leading, primary, toolbar: leading ? toolbar : undefined,
      status: active ? view.running.includes(id) ? 'running' : 'done' : undefined,
      close: !active && !primary ? () => { layout.closeTab(tab.id) } : undefined,
    }
    const content = renderSlot('main.conversation', {})
    return (
      <div className={css.pane} data-desk-secondary={!leading || undefined} data-desk-multiple={paneCount > 1 || undefined}>
        <ConversationDeskContext.Provider value={seat}>
          {primary ? content : (
            <LeasedConversation key={id} id={id} retainPane={retainPane} SessionProvider={SessionProvider}>
              {content}
            </LeasedConversation>
          )}
        </ConversationDeskContext.Provider>
      </div>
    )
  }
  const empty = t('desk.empty')
  const split = t('desk.split')
  const close = t('desk.close')
  const labels: DockLabels = {
    emptyPane: empty, splitPane: split, splitPaneDisabled: t('desk.limit'), splitPaneNarrow: split,
    closeTab: close, addTab: split, dockFloat: split, closeFloat: close,
    dropZone: { top: split, bottom: split, left: split, right: split, center: split },
  }
  return (
    <div className={css.desk}>
      {view.activeEmpty ? (
        <ConversationDeskContext.Provider value={{ primary: false, leading: true, toolbar }}>
          <div className={css.emptyToolbar} data-window-drag><ConversationDeskActions t={t} /></div>
          <p className={css.empty}>{empty}</p>
        </ConversationDeskContext.Provider>
      ) : (
        <DockSurface state={dock} intents={layout} labels={labels} canSplit={false} tabStrips={false}
          dividerLabel={t('desk.resize')} renderTab={renderTab} />
      )}
    </div>
  )
}

/** @param sessions - Session controller. @returns a stable acquisition function for pane occurrences. */
export function paneRetainer(sessions: ISessions): ConversationPanelInjected['retainPane'] {
  return id => sessions.retain(id, { source: 'conversationPane' })
}
