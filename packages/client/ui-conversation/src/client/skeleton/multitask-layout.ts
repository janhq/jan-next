/** Conversation-specific placement and temporary Active view over the dockkit engine. */
import {
  applyOp, clampSizes, createIdMinter, createInitialState, dockPaneIds, getPane, MAX_DOCK_PANES, planSettle,
} from '@janhq/jan-client-ui-dockkit'
import type { LayoutState, Mint, PaneId, SplitAxis, SplitId, TabFactory, TabId } from '@janhq/jan-client-ui-dockkit'
import type { SessionId } from '@janhq/jan-session/types'
import { z } from 'zod'

const persisted = z.object({
  sessions: z.array(z.string().min(1).transform(value => value as SessionId)).max(MAX_DOCK_PANES - 1),
  sizes: z.array(z.number().positive()).max(MAX_DOCK_PANES),
})

/** Storage namespace for the manual arrangement. Active never writes this preference. */
export const MULTITASK_LAYOUT_KEY = 'jan.conversation.multitask.v1'

const PRIMARY = 'primary'
const CHAT = 'chat'
const NO_SESSIONS: readonly SessionId[] = []

function tabFactory(kind: string, contentId: string): TabFactory {
  return id => ({ id, kind, contentId, title: '' })
}

function sameIds(a: readonly SessionId[], b: readonly SessionId[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index])
}

function initialTab(dock: LayoutState): TabId {
  const id = getPane(dock, dock.activePaneId).activeTabId
  if (id === undefined) throw new Error('ui-conversation: initial dock missing its primary tab')
  return id
}

function sessionInPane(dock: LayoutState, paneId: PaneId): SessionId | undefined {
  const tabId = getPane(dock, paneId).activeTabId
  const tab = tabId === undefined ? undefined : dock.tabs[tabId]
  return tab?.kind === CHAT && tab.contentId !== '' ? tab.contentId as SessionId : undefined
}

function splitChat(
  dock: LayoutState, mint: Mint, paneId: PaneId, value: SessionId, axis: SplitAxis,
): LayoutState {
  const newPaneId = mint('pane')
  const split = applyOp(dock, { type: 'split', paneId, axis, direction: 'after', newPaneId, newSplitId: mint('split') }).state
  const tab = tabFactory(CHAT, value)(mint('tab'))
  return applyOp(split, { type: 'openTab', paneId: newPaneId, tab, index: 0 }).state
}

function readManual(raw: string | undefined): { sessions: SessionId[]; sizes: number[] } | undefined {
  if (raw === undefined) return undefined
  let body: unknown
  try { body = JSON.parse(raw) }
  catch { return undefined }
  const result = persisted.safeParse(body)
  if (!result.success || new Set(result.data.sessions).size !== result.data.sessions.length
    || result.data.sizes.length !== result.data.sessions.length + 1) return undefined
  return result.data
}

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
  private manual = createInitialState({ next: this.mint }, tabFactory(PRIMARY, ''))
  private readonly primaryPane = this.manual.activePaneId
  private readonly primaryTab = initialTab(this.manual)
  private selected: SessionId | undefined
  private activeOrder: readonly SessionId[] | undefined
  private activeDock: LayoutState | undefined
  private running: readonly SessionId[] = NO_SESSIONS
  private restored: { sessions: SessionId[]; sizes: number[] } | undefined
  private snapshot: ConversationLayoutSnapshot = {
    dock: this.manual, active: false, activeEmpty: false, running: this.running, overflow: NO_SESSIONS,
  }

  /** @param raw - persisted manual arrangement. @param save - write the manual arrangement. */
  constructor(raw: string | undefined, private readonly save: (value: string) => void) {
    this.restored = readManual(raw)
  }

  /** @returns the stable visible layout snapshot. */
  getSnapshot = (): ConversationLayoutSnapshot => this.snapshot

  /** @param listener - layout observer. @returns its disposer. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * Apply the current workspace selection and running catalog facts.
   * @param selected - navigation's primary Session.
   * @param known - authoritative catalog once ready, or undefined while it is loading.
   * @param running - running top-level Sessions in catalog order.
   */
  sync(selected: SessionId | undefined, known: readonly SessionId[] | undefined, running: readonly SessionId[]): void {
    let persist = false
    if (this.selected !== selected) {
      const previous = this.selected
      this.selected = selected
      const open = selected === undefined ? undefined : this.secondaryTab(selected)
      const other = open === undefined ? undefined : this.manual.tabs[open]
      if (other !== undefined) {
        if (previous === undefined || known?.includes(previous) === false) this.removeManualTab(other.id)
        else this.manual = { ...this.manual, tabs: { ...this.manual.tabs, [other.id]: { ...other, contentId: previous } } }
        persist = true
      }
      this.manual = { ...this.manual, tabs: {
        ...this.manual.tabs, [this.primaryTab]: tabFactory(PRIMARY, selected ?? '')(this.primaryTab),
      } }
    }
    if (known !== undefined) {
      const catalog = new Set(known)
      if (this.restored !== undefined) {
        const { sessions, sizes } = this.restored
        this.restored = undefined
        for (const id of sessions) this.splitManual(id)
        const root = this.manual.nodes[this.manual.rootId]
        if (root?.kind === 'split') {
          this.manual = applyOp(this.manual, { type: 'resize', splitId: root.id, sizes: clampSizes(sizes) }).state
        }
      }
      for (const tab of Object.values(this.manual.tabs)) {
        if (tab.kind !== CHAT || (tab.contentId !== this.selected && catalog.has(tab.contentId as SessionId))) continue
        this.removeManualTab(tab.id)
        persist = true
      }
      if (this.activeOrder !== undefined && this.activeOrder.some(id => !catalog.has(id))) {
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
    if (persist) this.persist()
    this.publish()
  }

  /** @param id - target Session. @returns whether a new pane can be opened for it. */
  canOpenBeside(id: SessionId): boolean {
    return this.restored === undefined && id !== this.selected
      && (this.secondaryTab(id) !== undefined || dockPaneIds(this.manual).length < MAX_DOCK_PANES)
  }

  /** @param id - a different chat to open, or reveal if it already has a pane. */
  openBeside = (id: SessionId): void => {
    if (id === this.selected) return
    const existing = this.secondaryTab(id)
    if (existing === undefined && dockPaneIds(this.manual).length >= MAX_DOCK_PANES) return
    this.leaveActive()
    if (existing === undefined) {
      this.splitManual(id)
      this.persist()
    } else {
      const pane = dockPaneIds(this.manual).find(paneId => sessionInPane(this.manual, paneId) === id)
      if (pane !== undefined) this.manual = applyOp(this.manual, { type: 'focusPane', paneId: pane }).state
    }
    this.publish()
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

  /** @param tabId - removable tab in the manual arrangement. */
  closeTab = (tabId: TabId): void => {
    if (this.activeOrder !== undefined || tabId === this.primaryTab || this.manual.tabs[tabId] === undefined) return
    this.removeManualTab(tabId)
    this.persist()
    this.publish()
  }

  /** @param paneId - pane the user interacted with. */
  focusPane = (paneId: PaneId): void => {
    const dock = this.activeDock ?? this.manual
    if (paneId === dock.activePaneId || dock.nodes[paneId]?.kind !== 'pane') return
    this.setVisibleDock(applyOp(dock, { type: 'focusPane', paneId }).state, false)
  }

  /** @param id - splitter id. @param sizes - measured fractional pane sizes. */
  resizeSplit = (id: SplitId, sizes: readonly number[]): void => {
    const dock = this.activeDock ?? this.manual
    if (dock.nodes[id]?.kind !== 'split') return
    this.setVisibleDock(applyOp(dock, { type: 'resize', splitId: id, sizes: clampSizes(sizes) }).state, true)
  }

  private secondaryTab(id: SessionId): TabId | undefined {
    return Object.values(this.manual.tabs).find(tab => tab.kind === CHAT && tab.contentId === id)?.id
  }

  private splitManual(id: SessionId): void {
    const panes = dockPaneIds(this.manual)
    this.manual = splitChat(this.manual, this.mint, panes.at(-1) ?? this.primaryPane, id, 'row')
    const root = this.manual.nodes[this.manual.rootId]
    if (root?.kind === 'split') {
      this.manual = applyOp(this.manual, { type: 'resize', splitId: root.id, sizes: root.children.map(() => 1 / root.children.length) }).state
    }
  }

  private removeManualTab(tabId: TabId): void {
    this.manual = applyOp(this.manual, { type: 'closeTab', tabId }).state
    for (const op of planSettle(this.manual, this.mint)) this.manual = applyOp(this.manual, op).state
  }

  private tile(ids: readonly SessionId[]): LayoutState | undefined {
    const first = ids[0]
    if (first === undefined) return undefined
    const firstPane = createInitialState({ next: this.mint }, tabFactory(CHAT, first))
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

  private setVisibleDock(dock: LayoutState, persist: boolean): void {
    if (this.activeOrder !== undefined) this.activeDock = dock
    else {
      this.manual = dock
      if (persist) this.persist()
    }
    this.publish()
  }

  private persist(): void {
    const root = this.manual.nodes[this.manual.rootId]
    this.save(JSON.stringify({
      sessions: dockPaneIds(this.manual).slice(1).map(id => sessionInPane(this.manual, id)),
      sizes: root?.kind === 'split' ? root.sizes : [1],
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
