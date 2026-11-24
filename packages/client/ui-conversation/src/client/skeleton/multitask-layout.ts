/** Conversation-specific tab placement over the dockkit engine. */
import {
  applyOp, clampSizes, createIdMinter, createInitialState, dockPaneIds, findContentTab, findTabPane, getNode, getPane, getTab,
  MAX_DOCK_PANES, planAddTab, planDropTab, planPlaceTab, planSettle, replay,
} from '@janhq/jan-client-ui-dockkit'
import type {
  DockZone, HalvesFit, LayoutNode, LayoutOp, LayoutState, Mint, NodeId, PaneId, SplitAxis, SplitId, TabFactory, TabId, TabRecord,
} from '@janhq/jan-client-ui-dockkit'
import type { SessionId } from '@janhq/jan-session/types'
import { z } from 'zod'

/** The versioned manual arrangement; the old single-tab-per-pane layout is not read. */
export const MULTITASK_LAYOUT_KEY = 'jan.conversation.multitask.v2'

const CHAT = 'chat'
const makeTab = (contentId: string): TabFactory => id => ({ id, kind: CHAT, contentId, title: '' })
const blankTab = makeTab('')

interface SavedPane {
  tabs: string[]
  active: number
}

interface SavedSplit {
  axis: SplitAxis
  sizes: readonly number[]
  children: SavedNode[]
}

type SavedNode = SavedPane | SavedSplit

const savedPane = z.object({ tabs: z.array(z.string()).nonempty(), active: z.number().int().nonnegative() })
const savedNode: z.ZodType<SavedNode> = z.lazy(() => z.union([
  savedPane.refine(pane => pane.active < pane.tabs.length),
  z.object({
    axis: z.enum(['row', 'column']), sizes: z.array(z.number().positive()),
    children: z.array(savedNode).min(2).max(MAX_DOCK_PANES),
  }).refine(split => split.sizes.length === split.children.length),
]))
const savedLayout = z.object({ root: savedNode, active: z.number().int().nonnegative() })

function restoreDock(raw: string | undefined, mint: Mint): LayoutState | undefined {
  if (raw === undefined) return undefined
  let stored: z.infer<typeof savedLayout>
  try { stored = savedLayout.parse(JSON.parse(raw)) }
  catch { return undefined }
  const seed = createInitialState({ next: mint })
  const nodes: Record<NodeId, LayoutNode> = {}
  const tabs: Record<TabId, TabRecord> = {}
  const panes: PaneId[] = []
  const ids = new Set<string>()
  const restore = (node: SavedNode, depth: number): NodeId | undefined => {
    if (depth >= MAX_DOCK_PANES || panes.length >= MAX_DOCK_PANES) return undefined
    if ('axis' in node) {
      const id = mint('split')
      const children: NodeId[] = []
      for (const saved of node.children) {
        const child = restore(saved, depth + 1)
        if (child === undefined) return undefined
        children.push(child)
      }
      const sum = node.sizes.reduce((total, size) => total + size, 0)
      if (!Number.isFinite(sum) || Math.abs(1 - sum) > 1e-6) return undefined
      nodes[id] = { kind: 'split', id, axis: node.axis, children, sizes: node.sizes }
      return id
    }
    const paneId = mint('pane')
    const tabIds: TabId[] = []
    for (const session of node.tabs) {
      if (session !== '' && ids.has(session)) return undefined
      if (session !== '') ids.add(session)
      const tabId = mint('tab')
      tabs[tabId] = makeTab(session)(tabId)
      tabIds.push(tabId)
    }
    panes.push(paneId)
    nodes[paneId] = { kind: 'pane', id: paneId, host: 'dock', tabs: tabIds, activeTabId: tabIds[node.active], rect: undefined }
    return paneId
  }
  const rootId = restore(stored.root, 0)
  const activePaneId = panes[stored.active]
  return rootId === undefined || activePaneId === undefined ? undefined : { ...seed, rootId, activePaneId, nodes, tabs }
}

function saveNode(dock: LayoutState, id: NodeId): SavedNode {
  const node = getNode(dock, id)
  if (node.kind === 'split') return { axis: node.axis, sizes: node.sizes, children: node.children.map(child => saveNode(dock, child)) }
  const active = node.activeTabId === undefined ? 0 : node.tabs.indexOf(node.activeTabId)
  return { tabs: node.tabs.map(tab => getTab(dock, tab).contentId), active }
}

/**
 * Resolve the Session bound to a conversation tab.
 * @param tab - tab from the conversation layout.
 * @returns the Session id, or undefined for an unbound new chat.
 */
export function tabSessionId(tab: TabRecord): SessionId | undefined {
  return tab.contentId === '' ? undefined : tab.contentId as SessionId
}

function selectedSession(dock: LayoutState): SessionId | undefined {
  const tab = getPane(dock, dock.activePaneId).activeTabId
  return tab === undefined ? undefined : tabSessionId(getTab(dock, tab))
}

function withOp(dock: LayoutState, op: LayoutOp): LayoutState {
  return applyOp(dock, op).state
}

function openInPane(dock: LayoutState, mint: Mint, paneId: PaneId, contentId: string): LayoutState {
  return replay(dock, planAddTab(dock, mint, paneId, makeTab(contentId)))
}

function splitChat(dock: LayoutState, mint: Mint, paneId: PaneId, id: string, axis: SplitAxis): LayoutState {
  const newPaneId = mint('pane')
  return openInPane(withOp(dock, { type: 'split', paneId, axis, direction: 'after', newPaneId, newSplitId: mint('split') }), mint, newPaneId, id)
}

function replaceSelected(dock: LayoutState, id: SessionId | undefined): LayoutState {
  const tabId = getPane(dock, dock.activePaneId).activeTabId
  if (tabId === undefined) return dock
  return { ...dock, tabs: { ...dock.tabs, [tabId]: makeTab(id ?? '')(tabId) } }
}

function settled(dock: LayoutState, mint: Mint): LayoutState {
  return replay(dock, planSettle(dock, mint, blankTab))
}

function prune(dock: LayoutState, mint: Mint, known: ReadonlySet<SessionId>): LayoutState {
  let next = dock
  for (const tab of Object.values(dock.tabs)) {
    const id = tabSessionId(tab)
    if (id !== undefined && !known.has(id)) next = withOp(next, { type: 'closeTab', tabId: tab.id })
  }
  return next === dock ? dock : settled(next, mint)
}

type Navigate = (id: SessionId | undefined) => void

/** The visible desk. */
export interface ConversationLayoutSnapshot {
  readonly dock: LayoutState
}

/** Own the window's tab arrangement and keep it persisted. */
export class ConversationLayout {
  private room: ReadonlyMap<PaneId, HalvesFit> | undefined
  private readonly listeners = new Set<() => void>()
  private readonly mint = createIdMinter().next
  private manual: LayoutState
  private selected: SessionId | undefined
  private snapshot: ConversationLayoutSnapshot

  /** @param raw - persisted tab layout. @param save - persist it. @param navigate - focus the selected chat in Workspace navigation. */
  constructor(raw: string | undefined, private readonly save: (value: string) => void, private readonly navigate?: Navigate) {
    this.manual = restoreDock(raw, this.mint) ?? createInitialState({ next: this.mint }, blankTab)
    this.snapshot = { dock: this.manual }
  }

  /**
   * Read the currently published layout for an external-store subscriber.
   * @returns the same snapshot until the dock changes.
   */
  getSnapshot = (): ConversationLayoutSnapshot => this.snapshot

  /**
   * Subscribe to published dock changes.
   * @param listener - callback run after a new snapshot is available.
   * @returns the unsubscribe function.
   */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * Apply Workspace navigation and live catalog membership without replacing an already open tab.
   * @param selected - current Workspace selection.
   * @param catalog - complete set of openable Sessions, or undefined while loading.
   */
  sync(selected: SessionId | undefined, catalog: ReadonlySet<SessionId> | undefined): void {
    const previous = this.selected
    const was = this.manual
    this.selected = selected
    const openable = selected !== undefined ? catalog?.has(selected) !== false : previous === undefined || catalog?.has(previous) !== false
    if (previous !== selected && openable && selected !== selectedSession(this.manual)) {
      const open = selected === undefined ? undefined : findContentTab(this.manual, selected, CHAT)
      if (open !== undefined) this.manual = withOp(this.manual, { type: 'focusTab', tabId: open })
      else this.manual = replaceSelected(this.manual, selected)
    }
    if (catalog !== undefined) this.manual = prune(this.manual, this.mint, catalog)
    if (was !== this.manual) this.persist()
    this.publish()
    // A catalog update can arrive while Workspace is still clearing an archived selection.
    // Wait for that transaction, then navigate only if the layout still requests it.
    const current = selectedSession(this.manual)
    if (was !== this.manual && catalog !== undefined && current !== selected) {
      queueMicrotask(() => {
        if (this.selected !== selected) return
        if (selectedSession(this.manual) === current) this.navigate?.(current)
      })
    }
  }

  /**
   * Check whether a Session can open beside the focused pane.
   * @param id - Session to move or open.
   * @returns true when the Session is not selected and the dock has room for another pane.
   */
  canOpenBeside(id: SessionId): boolean {
    return id !== selectedSession(this.manual) && dockPaneIds(this.manual).length < MAX_DOCK_PANES
      && this.room?.get(this.manual.activePaneId)?.row !== false
  }

  /**
   * Open a Session beside the focused pane, moving its existing tab if it has one.
   * @param id - Session to show; ignored if opening beside is unavailable.
   */
  openBeside = (id: SessionId): void => {
    if (!this.canOpenBeside(id)) return
    const pane = this.manual.activePaneId
    const existing = findContentTab(this.manual, id, CHAT)
    const dock = existing === undefined
      ? splitChat(this.manual, this.mint, pane, id, 'row')
      : settled(replay(this.manual, planDropTab(this.manual, this.mint, existing, pane, 'right', blankTab)), this.mint)
    this.commitManual(dock)
  }

  /** Keep menu and keyboard splits on the same measured room rule as edge drops. */
  setRoom = (room: ReadonlyMap<PaneId, HalvesFit>): void => { this.room = room }

  /** Check the pane limit and any available room measurement before splitting an existing tab's pane. */
  canSplitTab = (tabId: TabId, axis: SplitAxis): boolean => this.manual.tabs[tabId] !== undefined
    && dockPaneIds(this.manual).length < MAX_DOCK_PANES
    && this.room?.get(findTabPane(this.manual, tabId).id)?.[axis] !== false

  /**
   * Resolve a focused control to its chat pane without relying on window selection.
   * @param target - focused element, or null when there is no target.
   * @returns the containing pane id if it is still in the layout, otherwise undefined.
   */
  paneForTarget(target: Element | null): PaneId | undefined {
    const element = target?.closest<HTMLElement>('[data-chat-tabs] [data-dockkit-pane]')
    if (element === null || element === undefined) return undefined
    const id = element.dataset.dockkitPane as PaneId | undefined
    return id !== undefined && this.manual.nodes[id]?.kind === 'pane' ? id : undefined
  }

  /**
   * Resolve focus to a tab in the current chat layout.
   * @param target - focused element, or null when there is no target.
   * @returns the focused tab chip's id, the pane's active tab id as a fallback,
   * or undefined if focus is outside the current chat layout.
   */
  tabForTarget(target: Element | null): TabId | undefined {
    const paneId = this.paneForTarget(target)
    if (paneId === undefined) return undefined
    const pane = getPane(this.manual, paneId)
    const tab = target?.closest<HTMLElement>('[data-dockkit-tab]')?.dataset.dockkitTab as TabId | undefined
    return tab !== undefined && pane.tabs.includes(tab) ? tab : pane.activeTabId
  }

  /** Check whether the window can close a tab without removing its last tab. */
  canCloseTab = (): boolean => Object.keys(this.manual.tabs).length > 1

  /** Split the tab's pane and focus a new blank chat without moving the original tab. */
  splitTab = (tabId: TabId, axis: SplitAxis): void => {
    if (!this.canSplitTab(tabId, axis)) return
    const pane = findTabPane(this.manual, tabId)
    this.commitManual(splitChat(this.manual, this.mint, pane.id, '', axis))
  }

  /**
   * Focus an existing Session tab or append a new one to the active pane.
   * @param id - Session to show in this window.
   */
  openInNewTab = (id: SessionId): void => {
    const existing = findContentTab(this.manual, id, CHAT)
    this.commitManual(existing === undefined ? openInPane(this.manual, this.mint, this.manual.activePaneId, id)
      : withOp(this.manual, { type: 'focusTab', tabId: existing }))
  }

  /**
   * Add an independent blank chat tab to an existing pane.
   * @param paneId - pane receiving the new tab.
   */
  addTab = (paneId: PaneId): void => {
    if (this.manual.nodes[paneId]?.kind !== 'pane') return
    this.commitManual(openInPane(this.manual, this.mint, paneId, ''))
  }

  /**
   * Focus a tab and its containing pane if the tab still exists.
   * @param tabId - tab to reveal.
   */
  focusTab = (tabId: TabId): void => {
    if (this.manual.tabs[tabId] === undefined) return
    this.commitManual(withOp(this.manual, { type: 'focusTab', tabId }))
  }

  /**
   * Move a tab to a strip insertion slot, settling any empty pane it leaves behind.
   * @param tabId - dragged tab.
   * @param paneId - destination pane.
   * @param index - strip insertion slot.
   */
  placeTab = (tabId: TabId, paneId: PaneId, index: number): void => {
    if (this.manual.tabs[tabId] === undefined || this.manual.nodes[paneId]?.kind !== 'pane') return
    this.commitManual(settled(replay(this.manual, planPlaceTab(this.manual, tabId, paneId, index)), this.mint))
  }

  /**
   * Move a tab into a pane or split it beside the pane according to the drop zone.
   * @param tabId - dragged tab.
   * @param paneId - destination pane.
   * @param zone - body drop zone.
   */
  dropTab = (tabId: TabId, paneId: PaneId, zone: DockZone): void => {
    if (this.manual.tabs[tabId] === undefined || this.manual.nodes[paneId]?.kind !== 'pane') return
    this.commitManual(settled(replay(this.manual, planDropTab(this.manual, this.mint, tabId, paneId, zone, blankTab)), this.mint))
  }

  /**
   * Close a tab and settle the dock without closing a tab rebound during a window move.
   * @param tabId - tab to close.
   * @param expected - when supplied, close only if the tab is still bound to this Session.
   */
  closeTab = (tabId: TabId, expected?: SessionId): void => {
    const tab = this.manual.tabs[tabId]
    if (tab === undefined || (expected !== undefined && tab.contentId !== expected)) return
    this.commitManual(settled(withOp(this.manual, { type: 'closeTab', tabId }), this.mint))
  }

  /**
   * Make an existing pane active without changing its selected tab.
   * @param paneId - pane the user interacted with.
   */
  focusPane = (paneId: PaneId): void => {
    if (paneId === this.manual.activePaneId || this.manual.nodes[paneId]?.kind !== 'pane') return
    this.commitManual(withOp(this.manual, { type: 'focusPane', paneId }))
  }

  /**
   * Clamp and save the sizes for an existing split.
   * @param id - splitter id.
   * @param sizes - measured fractional pane sizes.
   */
  resizeSplit = (id: SplitId, sizes: readonly number[]): void => {
    if (this.manual.nodes[id]?.kind !== 'split') return
    this.commitManual(withOp(this.manual, { type: 'resize', splitId: id, sizes: clampSizes(sizes) }))
  }

  private commitManual(next: LayoutState): void {
    if (this.manual !== next) {
      this.manual = next
      this.persist()
    }
    this.publish()
    const id = selectedSession(this.manual)
    if (id !== this.selected) this.navigate?.(id)
  }

  private persist(): void {
    this.save(JSON.stringify({
      root: saveNode(this.manual, this.manual.rootId),
      active: dockPaneIds(this.manual).indexOf(this.manual.activePaneId),
    }))
  }

  private publish(): void {
    if (this.snapshot.dock === this.manual) return
    this.snapshot = { dock: this.manual }
    for (const listener of this.listeners) listener()
  }
}
