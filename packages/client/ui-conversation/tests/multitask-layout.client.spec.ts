/** Behavior of the manual conversation layout and its temporary Active view. */
import { describe, expect, it } from 'vitest'
import type { SessionId } from '@janhq/jan-session/types'
import { dockPaneIds, getPane } from '@janhq/jan-client-ui-dockkit'
import type { SplitId } from '@janhq/jan-client-ui-dockkit'
import { ConversationLayout } from '../src/client/skeleton/multitask-layout.ts'

const a = 'amber' as SessionId
const b = 'blue' as SessionId
const c = 'copper' as SessionId
const d = 'denim' as SessionId
const e = 'emerald' as SessionId
const f = 'fuchsia' as SessionId

function chats(layout: ConversationLayout) {
  const { dock } = layout.getSnapshot()
  return dockPaneIds(dock).map((id) => {
    const tab = getPane(dock, id).activeTabId
    return tab === undefined ? undefined : dock.tabs[tab]?.contentId
  })
}

describe('conversation layout', () => {
  it('keeps side-by-side chats and their divider after reopening, then closes the added pane', () => {
    let saved: string | undefined
    const layout = new ConversationLayout(undefined, (value) => { saved = value })
    layout.sync(a, new Set([a, b]), [])
    layout.openBeside(b)
    expect(chats(layout)).toEqual([a, b])
    const initial = layout.getSnapshot().dock
    layout.resizeSplit(initial.rootId as SplitId, [0.65, 0.35])
    const reopened = new ConversationLayout(saved, () => {})
    reopened.sync(a, new Set([a, b]), [])
    expect(chats(reopened)).toEqual([a, b])
    const dock = reopened.getSnapshot().dock
    expect(dock.nodes[dock.rootId]).toMatchObject({ sizes: [0.65, 0.35] })
    reopened.closeTab(getPane(dock, dockPaneIds(dock)[1]!).activeTabId!)
    expect(chats(reopened)).toEqual([a])
  })

  it('reuses the focused tab for a new sidebar chat and reveals an already open tab in place', () => {
    const layout = new ConversationLayout(undefined, () => {})
    layout.sync(a, new Set([a, b, c]), [])
    layout.openBeside(b)
    layout.sync(b, new Set([a, b, c]), [])
    expect(chats(layout)).toEqual([a, b])
    layout.sync(c, new Set([a, b, c]), [])
    expect(chats(layout)).toEqual([a, c])
  })

  it('keeps reordered tabs and split geometry, and drops invalid chats on restoration', () => {
    let saved: string | undefined
    const layout = new ConversationLayout(undefined, (value) => { saved = value })
    layout.sync(a, new Set([a, b, c, d]), [])
    layout.openInNewTab(b)
    layout.openInNewTab(c)
    const paneId = layout.getSnapshot().dock.activePaneId
    const [, two, three] = getPane(layout.getSnapshot().dock, paneId).tabs
    layout.placeTab(three!, paneId, 0)
    layout.dropTab(two!, paneId, 'bottom')
    layout.addTab(paneId)
    const dock = layout.getSnapshot().dock
    layout.resizeSplit(dock.rootId as SplitId, [0.55, 0.45])
    const restored = new ConversationLayout(saved, () => {})
    restored.sync(undefined, new Set([a, b]), [])
    const snapshot = restored.getSnapshot().dock
    expect(snapshot.nodes[snapshot.rootId]).toMatchObject({ axis: 'column', sizes: [0.55, 0.45] })
    expect(dockPaneIds(snapshot).map(id => getPane(snapshot, id).tabs.map(tab => snapshot.tabs[tab]?.contentId)))
      .toEqual([[a, ''], [b]])
    for (const tab of Object.values(snapshot.tabs)) restored.closeTab(tab.id)
    expect(chats(restored)).toEqual([''])
    expect(Object.keys(restored.getSnapshot().dock.tabs)).toHaveLength(1)
  })

  it('keeps a tab whose chat changed while its window move was pending', () => {
    const layout = new ConversationLayout(undefined, () => {})
    layout.sync(a, new Set([a, b]), [])
    const { dock } = layout.getSnapshot()
    const tabId = getPane(dock, dock.activePaneId).activeTabId!
    // Sidebar navigation reuses the selected tab while the move of `a` is in flight.
    layout.sync(b, new Set([a, b]), [])
    layout.closeTab(tabId, a)
    expect(chats(layout)).toEqual([b])
    layout.closeTab(tabId, b)
    expect(chats(layout)).toEqual([''])
  })

  it.each([
    ['unparsable JSON', '{'],
    ['the earlier one-chat-per-pane shape', JSON.stringify({ sessions: [b], sizes: [1] })],
    ['an out-of-range active tab', JSON.stringify({ root: { tabs: [b], active: 1 }, active: 0 })],
    ['sizes that do not sum to one', JSON.stringify({
      root: { axis: 'row', sizes: [0.5, 0.2], children: [{ tabs: [a], active: 0 }, { tabs: [b], active: 0 }] }, active: 0,
    })],
    ['one chat in two panes', JSON.stringify({
      root: { axis: 'row', sizes: [0.5, 0.5], children: [{ tabs: [b], active: 0 }, { tabs: [b], active: 0 }] }, active: 0,
    })],
  ])('starts from one tab on the selected chat when the saved layout holds %s', (_, raw) => {
    const layout = new ConversationLayout(raw, () => {})
    layout.sync(a, new Set([a, b]), [])
    expect(chats(layout)).toEqual([a])
  })

  it('tiles live chats, keeps completed chats, lists overflow, and restores the exact manual layout', () => {
    const layout = new ConversationLayout(undefined, () => {})
    const known = new Set([a, b, c, d, e, f])
    layout.sync(a, known, [b, c])
    layout.openBeside(d)
    const manual = layout.getSnapshot().dock
    layout.toggleActive()
    expect(chats(layout)).toEqual([b, c])
    layout.sync(a, known, [c, a, d, e, f])
    expect(chats(layout)).toEqual([b, a, c, d])
    expect(layout.getSnapshot().overflow).toEqual([e, f])
    expect(layout.getSnapshot().running).toEqual([c, a, d, e, f])
    layout.focusActive(f)
    expect(chats(layout)).toContain(f)
    expect(layout.getSnapshot().overflow).toContain(d)
    layout.toggleActive()
    expect(layout.getSnapshot().dock).toBe(manual)
    expect(chats(layout)).toEqual([a, d])
  })
})
