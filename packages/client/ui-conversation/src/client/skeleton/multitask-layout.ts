/** Conversation-specific tab placement over the dockkit engine. */
import {
  applyOp, clampSizes, createIdMinter, createInitialState, dockPaneIds, findContentTab, getNode, getPane, getTab, MAX_DOCK_PANES,
  planAddTab, planDropTab, planPlaceTab, planSettle, replay,
} from '@janhq/jan-client-ui-dockkit'
import type {
  DockZone, LayoutNode, LayoutOp, LayoutState, Mint, NodeId, PaneId, SplitAxis, SplitId, TabFactory, TabId, TabRecord,
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

/** @param tab - a desk tab. @returns its Session, or undefined for an unbound new chat. */
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

function splitChat(dock: LayoutState, mint: Mint, paneId: PaneId, id: SessionId, axis: SplitAxis): LayoutState {
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

  /** @returns the stable visible layout snapshot. */
  getSnapshot = (): ConversationLayoutSnapshot => this.snapshot

  /** @param listener - layout observer. @returns its disposer. */
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

  /** @param id - Session to move or open beside the focused pane. @returns whether that action is available. */
  canOpenBeside(id: SessionId): boolean {
    return id !== selectedSession(this.manual) && dockPaneIds(this.manual).length < MAX_DOCK_PANES
  }

  /** @param id - Session to reveal in a new pane, keeping one tab per Session. */
  openBeside = (id: SessionId): void => {
    if (!this.canOpenBeside(id)) return
    const pane = this.manual.activePaneId
    const existing = findContentTab(this.manual, id, CHAT)
    const dock = existing === undefined
      ? splitChat(this.manual, this.mint, pane, id, 'row')
      : settled(replay(this.manual, planDropTab(this.manual, this.mint, existing, pane, 'right', blankTab)), this.mint)
    this.commitManual(dock)
  }

  /** @param id - Session to append, or reveal if already open in this window. */
  openInNewTab = (id: SessionId): void => {
    const existing = findContentTab(this.manual, id, CHAT)
    this.commitManual(existing === undefined ? openInPane(this.manual, this.mint, this.manual.activePaneId, id)
      : withOp(this.manual, { type: 'focusTab', tabId: existing }))
  }

  /** @param paneId - pane receiving an independent blank tab. */
  addTab = (paneId: PaneId): void => {
    if (this.manual.nodes[paneId]?.kind !== 'pane') return
    this.commitManual(openInPane(this.manual, this.mint, paneId, ''))
  }

  /** @param tabId - Session tab to reveal. */
  focusTab = (tabId: TabId): void => {
    if (this.manual.tabs[tabId] === undefined) return
    this.commitManual(withOp(this.manual, { type: 'focusTab', tabId }))
  }

  /** @param tabId - dragged tab. @param paneId - destination pane. @param index - strip insertion slot. */
  placeTab = (tabId: TabId, paneId: PaneId, index: number): void => {
    if (this.manual.tabs[tabId] === undefined || this.manual.nodes[paneId]?.kind !== 'pane') return
    this.commitManual(settled(replay(this.manual, planPlaceTab(this.manual, tabId, paneId, index)), this.mint))
  }

  /** @param tabId - dragged tab. @param paneId - destination pane. @param zone - body drop zone. */
  dropTab = (tabId: TabId, paneId: PaneId, zone: DockZone): void => {
    if (this.manual.tabs[tabId] === undefined || this.manual.nodes[paneId]?.kind !== 'pane') return
    this.commitManual(settled(replay(this.manual, planDropTab(this.manual, this.mint, tabId, paneId, zone, blankTab)), this.mint))
  }

  /** @param tabId - tab to close. @param expected - Session identity for an asynchronous window move. */
  closeTab = (tabId: TabId, expected?: SessionId): void => {
    const tab = this.manual.tabs[tabId]
    if (tab === undefined || (expected !== undefined && tab.contentId !== expected)) return
    this.commitManual(settled(withOp(this.manual, { type: 'closeTab', tabId }), this.mint))
  }

  /** @param paneId - pane the user interacted with. */
  focusPane = (paneId: PaneId): void => {
    if (paneId === this.manual.activePaneId || this.manual.nodes[paneId]?.kind !== 'pane') return
    this.commitManual(withOp(this.manual, { type: 'focusPane', paneId }))
  }

  /** @param id - splitter id. @param sizes - measured fractional pane sizes. */
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
