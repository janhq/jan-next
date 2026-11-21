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
    layout.sync(a, [a, b], [])
    layout.openBeside(b)
    expect(chats(layout)).toEqual([a, b])
    const initial = layout.getSnapshot().dock
    layout.resizeSplit(initial.rootId as SplitId, [0.65, 0.35])
    const reopened = new ConversationLayout(saved, () => {})
    reopened.sync(a, [a, b], [])
    expect(chats(reopened)).toEqual([a, b])
    const dock = reopened.getSnapshot().dock
    expect(dock.nodes[dock.rootId]).toMatchObject({ sizes: [0.65, 0.35] })
    reopened.closeTab(getPane(dock, dockPaneIds(dock)[1]!).activeTabId!)
    expect(chats(reopened)).toEqual([a])
  })

  it('keeps two distinct chats when sidebar navigation selects one already visible', () => {
    const layout = new ConversationLayout(undefined, () => {})
    layout.sync(a, [a, b, c], [])
    layout.openBeside(b)
    layout.sync(b, [a, b, c], [])
    expect(chats(layout)).toEqual([b, a])
    layout.sync(c, [a, b, c], [])
    expect(chats(layout)).toEqual([c, a])
  })

  it('tiles live chats, keeps completed chats, lists overflow, and restores the exact manual layout', () => {
    const layout = new ConversationLayout(undefined, () => {})
    const known = [a, b, c, d, e, f]
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
