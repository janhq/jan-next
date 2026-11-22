/** Conversation-specific placement and temporary Active view over the dockkit engine. */
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
const NO_SESSIONS: readonly SessionId[] = []
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

function sameIds(a: readonly SessionId[], b: readonly SessionId[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index])
}

type Navigate = (id: SessionId | undefined) => void

/** The visible desk, including both running IDs and Active sessions outside the tile cap. */
export interface ConversationLayoutSnapshot {
  readonly dock: LayoutState
  readonly activeEmpty: boolean
  readonly active: boolean
  readonly running: readonly SessionId[]
  readonly overflow: readonly SessionId[]
}

/** Own the manual arrangement separately from the temporary Active grid. */
export class ConversationLayout {
  private readonly listeners = new Set<() => void>()
  private readonly mint = createIdMinter().next
  private manual: LayoutState
  private selected: SessionId | undefined
  private activeOrder: readonly SessionId[] | undefined
  private activeDock: LayoutState | undefined
  private running: readonly SessionId[] = NO_SESSIONS
  private snapshot: ConversationLayoutSnapshot

  /** @param raw - persisted tab layout. @param save - persist it. @param navigate - focus the selected chat in Workspace navigation. */
  constructor(raw: string | undefined, private readonly save: (value: string) => void, private readonly navigate?: Navigate) {
    this.manual = restoreDock(raw, this.mint) ?? createInitialState({ next: this.mint }, blankTab)
    this.snapshot = { dock: this.manual, active: false, activeEmpty: false, running: this.running, overflow: NO_SESSIONS }
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
   * @param running - running top-level Sessions in catalog order.
   */
  sync(selected: SessionId | undefined, catalog: ReadonlySet<SessionId> | undefined, running: readonly SessionId[]): void {
    const previous = this.selected
    const was = this.manual
    this.selected = selected
    const openable = selected !== undefined ? catalog?.has(selected) !== false : previous === undefined || catalog?.has(previous) !== false
    if (previous !== selected && openable && selected !== selectedSession(this.manual)) {
      this.leaveActive()
      const open = selected === undefined ? undefined : findContentTab(this.manual, selected, CHAT)
      if (open !== undefined) this.manual = withOp(this.manual, { type: 'focusTab', tabId: open })
      else this.manual = replaceSelected(this.manual, selected)
    }
    if (catalog !== undefined) {
      this.manual = prune(this.manual, this.mint, catalog)
      if (this.activeOrder?.some(id => !catalog.has(id)) === true) {
        this.activeOrder = this.activeOrder.filter(id => catalog.has(id))
        this.activeDock = this.tile(this.activeOrder)
      }
    }
    if (!sameIds(this.running, running)) {
      this.running = running
      const order = this.activeOrder
      if (order !== undefined) {
        const added = running.filter(id => !order.includes(id))
        if (added.length > 0) {
          this.activeOrder = [...order, ...added]
          if (order.length < MAX_DOCK_PANES) this.activeDock = this.tile(this.activeOrder)
        }
      }
    }
    if (was !== this.manual) this.persist()
    this.publish()
    // A catalog update can arrive while Workspace is still clearing an archived selection.
    // Wait for that transaction, then navigate only if the layout still requests it.
    const current = selectedSession(this.manual)
    if (was !== this.manual && catalog !== undefined && current !== selected && this.activeOrder === undefined) {
      queueMicrotask(() => {
        if (this.selected !== selected || this.activeOrder !== undefined) return
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
    if (this.activeOrder !== undefined || this.manual.nodes[paneId]?.kind !== 'pane') return
    this.commitManual(openInPane(this.manual, this.mint, paneId, ''))
  }

  /** @param tabId - Session tab to reveal. */
  focusTab = (tabId: TabId): void => {
    if (this.activeOrder !== undefined || this.manual.tabs[tabId] === undefined) return
    this.commitManual(withOp(this.manual, { type: 'focusTab', tabId }))
  }

  /** @param tabId - dragged tab. @param paneId - destination pane. @param index - strip insertion slot. */
  placeTab = (tabId: TabId, paneId: PaneId, index: number): void => {
    if (this.activeOrder !== undefined || this.manual.tabs[tabId] === undefined || this.manual.nodes[paneId]?.kind !== 'pane') return
    this.commitManual(settled(replay(this.manual, planPlaceTab(this.manual, tabId, paneId, index)), this.mint))
  }

  /** @param tabId - dragged tab. @param paneId - destination pane. @param zone - body drop zone. */
  dropTab = (tabId: TabId, paneId: PaneId, zone: DockZone): void => {
    if (this.activeOrder !== undefined || this.manual.tabs[tabId] === undefined || this.manual.nodes[paneId]?.kind !== 'pane') return
    this.commitManual(settled(replay(this.manual, planDropTab(this.manual, this.mint, tabId, paneId, zone, blankTab)), this.mint))
  }

  /** Show the live Active tiles, or restore the prior manual arrangement. */
  toggleActive = (): void => {
    if (this.activeOrder === undefined) {
      this.activeOrder = this.running
      this.activeDock = this.tile(this.activeOrder)
    } else this.leaveActive()
    this.publish()
  }

  /** @param id - overflow session to replace the last visible Active tile. */
  focusActive = (id: SessionId): void => {
    const order = this.activeOrder
    if (order === undefined || order.indexOf(id) < MAX_DOCK_PANES) return
    this.activeOrder = [...order.slice(0, MAX_DOCK_PANES - 1), id, ...order.slice(MAX_DOCK_PANES - 1).filter(other => other !== id)]
    this.activeDock = this.tile(this.activeOrder)
    this.publish()
  }

  /** @param tabId - tab to close. @param expected - Session identity for an asynchronous window move. */
  closeTab = (tabId: TabId, expected?: SessionId): void => {
    const tab = this.manual.tabs[tabId]
    if (tab === undefined || (expected === undefined ? this.activeOrder !== undefined : tab.contentId !== expected)) return
    const next = settled(withOp(this.manual, { type: 'closeTab', tabId }), this.mint)
    if (this.activeOrder === undefined) this.commitManual(next)
    else { this.manual = next; this.persist() }
  }

  /** @param paneId - pane the user interacted with. */
  focusPane = (paneId: PaneId): void => {
    const dock = this.activeDock ?? this.manual
    if (paneId === dock.activePaneId || dock.nodes[paneId]?.kind !== 'pane') return
    const next = withOp(dock, { type: 'focusPane', paneId })
    if (this.activeOrder === undefined) this.commitManual(next)
    else { this.activeDock = next; this.publish() }
  }

  /** @param id - splitter id. @param sizes - measured fractional pane sizes. */
  resizeSplit = (id: SplitId, sizes: readonly number[]): void => {
    const dock = this.activeDock ?? this.manual
    if (dock.nodes[id]?.kind !== 'split') return
    const next = withOp(dock, { type: 'resize', splitId: id, sizes: clampSizes(sizes) })
    if (this.activeOrder === undefined) this.commitManual(next)
    else { this.activeDock = next; this.publish() }
  }

  private tile(ids: readonly SessionId[]): LayoutState | undefined {
    const first = ids[0]
    if (first === undefined) return undefined
    const firstPane = createInitialState({ next: this.mint }, makeTab(first))
    const left = firstPane.activePaneId
    const second = ids[1]
    if (second === undefined) return firstPane
    const top = splitChat(firstPane, this.mint, left, second, 'row')
    const third = ids[2]
    if (third === undefined) return top
    const bottom = splitChat(top, this.mint, left, third, 'column')
    const fourth = ids[3]
    return fourth === undefined ? bottom : splitChat(bottom, this.mint, top.activePaneId, fourth, 'column')
  }

  private leaveActive(): void {
    this.activeOrder = undefined
    this.activeDock = undefined
  }

  private commitManual(next: LayoutState): void {
    this.leaveActive()
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
    const dock = this.activeDock ?? this.manual
    const active = this.activeOrder !== undefined
    const activeEmpty = active && this.activeDock === undefined
    const overflow = this.activeOrder?.slice(MAX_DOCK_PANES) ?? NO_SESSIONS
    const old = this.snapshot
    if (old.dock === dock && old.active === active && old.activeEmpty === activeEmpty
      && old.running === this.running && sameIds(old.overflow, overflow)) return
    this.snapshot = { dock, active, activeEmpty, running: this.running, overflow }
    for (const listener of this.listeners) listener()
  }
}
