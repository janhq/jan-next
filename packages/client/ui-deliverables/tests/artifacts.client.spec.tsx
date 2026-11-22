// @vitest-environment jsdom
/**
 * Artifacts library: the model derived from Session-list projection values, the
 * controller that fills legacy rows and checks files on disk, the page's
 * grouping, search, unavailable files, the Links tab, and chat navigation, and
 * the panel and sidebar registrations.
 */
import { cleanup, fireEvent, render, within } from '@testing-library/react'
import { Context } from '@janhq/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionListState } from '@janhq/jan-api-session-controller/client'
import { LocaleRuntime } from '@janhq/jan-client-locale/client'
import { SlotRegistry } from '@janhq/jan-client-ui-renderer/client'
import { resolveSlotLabel } from '@janhq/jan-client-ui-slots'
import { createSnapshotStore } from '@janhq/jan-client-store'
import { bindSnapshotSelector, makeTranslate, usePinnedBrowserLanguages } from '@janhq/jan-client-test-runtime'
import type { SessionId } from '@janhq/jan-session/types'
import type { PresentedFileEntry } from '@janhq/jan-tool-present/types'
import {
  ArtifactsController, artifactGroup, artifactRows, filterArtifacts, filterLinks, linkRows, unindexedChats,
  type ArtifactAvailabilityMap,
} from '../src/client/artifacts.ts'
import type { SharedLinkEntry } from '../src/links.ts'
import { ArtifactsPage, type ArtifactsInjected } from '../src/client/ArtifactsPage.tsx'
import { ARTIFACTS_PANEL_ID, registerArtifacts } from '../src/client/artifacts-plugin.ts'
import { PresentedOpenController } from '../src/client/present-open.ts'
import { NS, de, en, es, fr, ja, pt, ru, zh } from '../src/client/locales.ts'

usePinnedBrowserLanguages('en')
afterEach(cleanup)

const sid = (value: string): SessionId => value as SessionId
const file = (path: string, seq: number, time: number, description?: string): PresentedFileEntry => ({
  path, turn: 1, seq, index: 0, time, ...description === undefined ? {} : { description },
})
const link = (url: string, time: number, title?: string, from: SharedLinkEntry['from'] = 'assistant'): SharedLinkEntry => ({
  url, from, seq: time / 1_000, time, ...title === undefined ? {} : { title },
})

interface Chat {
  readonly title: string
  readonly files?: readonly PresentedFileEntry[]
  /** Shared links; a chat with files and no links listed has an empty links index. */
  readonly links?: readonly SharedLinkEntry[]
  /** A row checkpointed before the links index existed. */
  readonly noLinksIndex?: boolean
  readonly blank?: boolean
  readonly parentId?: string
  readonly state?: 'idle' | 'loading' | 'ready'
  /** Whether the row's summary values, not the projection store, carry the files. */
  readonly summaryOnly?: boolean
}

function listOf(chats: Readonly<Record<string, Chat>>): SessionListState {
  const byId: Record<string, unknown> = {}
  const projectionsBySession: Record<string, unknown> = {}
  for (const [id, chat] of Object.entries(chats)) {
    const links = chat.links ?? (chat.files === undefined || chat.noLinksIndex === true ? undefined : [])
    const values = {
      ...chat.files === undefined ? {} : { presentedFiles: chat.files },
      ...links === undefined ? {} : { sharedLinks: links },
    }
    byId[id] = {
      id, displayTitle: chat.title, running: false, retainedBy: [], blank: chat.blank ?? false, updatedAt: 0,
      ...chat.summaryOnly === true ? { projectionValues: values } : {},
      ...chat.parentId === undefined ? {} : { parentId: chat.parentId, origin: 'subagent' },
    }
    if (chat.summaryOnly !== true) projectionsBySession[id] = { values, state: chat.state ?? 'idle', error: null }
  }
  return { ids: Object.keys(chats), byId, phase: 'ready', projectionsBySession } as never
}

const LIBRARY = listOf({
  alpha: {
    title: 'Quarterly review', files: [file('/w/report.docx', 4, 5_000), file('/w/figures.xlsx', 6, 9_000, 'Revenue by region')],
    links: [link('https://www.example.com/q3', 3_000, 'Q3 filing', 'user'), link('https://jan.ai/docs', 8_000)],
  },
  beta: { title: 'Launch deck', files: [file('/w/deck.pptx', 3, 7_000), file('/w/hero.png', 5, 2_000)] },
  gamma: { title: 'Prototype', summaryOnly: true, files: [file('/w/app.ts', 8, 12_000)], links: [link('https://github.com/janhq/jan', 11_000, 'Jan repo')] },
  child: { title: 'Helper', files: [file('/w/hidden.md', 2, 99_000)], links: [link('https://hidden.example/', 99_000)], parentId: 'alpha' },
})

describe('artifact model', () => {
  it('groups files by extension', () => {
    const groups = Object.fromEntries(['report.docx', 'notes.md', 'paper.pdf', 'data.xlsx', 'rows.csv', 'deck.pptx', 'pic.png', 'main.ts', 'index.html', 'clip.mp4', 'README']
      .map(path => [path, artifactGroup(path)]))
    expect(groups).toEqual({
      'report.docx': 'documents', 'notes.md': 'documents', 'paper.pdf': 'documents',
      'data.xlsx': 'spreadsheets', 'rows.csv': 'spreadsheets', 'deck.pptx': 'presentations',
      'pic.png': 'images', 'main.ts': 'code', 'index.html': 'code', 'clip.mp4': 'other', README: 'documents',
    })
  })

  it('lists every chat\'s files newest first, from the store or the row summary, without subagent chats', () => {
    const rows = artifactRows(LIBRARY)
    expect(rows.map(row => [row.name, row.chatTitle, row.group])).toEqual([
      ['app.ts', 'Prototype', 'code'],
      ['figures.xlsx', 'Quarterly review', 'spreadsheets'],
      ['deck.pptx', 'Launch deck', 'presentations'],
      ['report.docx', 'Quarterly review', 'documents'],
      ['hero.png', 'Launch deck', 'images'],
    ])
    expect(rows[1]).toMatchObject({ sessionId: 'alpha', seq: 6, index: 0, description: 'Revenue by region', key: 'alpha:6:0' })
  })

  it('names the chats whose list row holds no presented-files or shared-links value yet', () => {
    const list = listOf({
      legacy: { title: 'Old' },
      linkless: { title: 'Files only', files: [], noLinksIndex: true },
      empty: { title: 'Indexed', files: [] },
      fresh: { title: 'Blank', blank: true },
      loading: { title: 'Loading', state: 'loading' },
      read: { title: 'Read', state: 'ready' },
      sub: { title: 'Sub', parentId: 'legacy' },
    })
    expect(unindexedChats(list)).toEqual(['legacy', 'linkless'])
  })

  it('lists every chat\'s links newest first with a title or the site name, without subagent chats', () => {
    const rows = linkRows(LIBRARY)
    expect(rows.map(row => [row.title, row.site, row.chatTitle, row.from])).toEqual([
      ['Jan repo', 'github.com', 'Prototype', 'assistant'],
      ['jan.ai', 'jan.ai', 'Quarterly review', 'assistant'],
      ['Q3 filing', 'example.com', 'Quarterly review', 'user'],
    ])
    const titles = (query: string) => filterLinks(rows, query).map(row => row.title)
    expect(titles(' QUARTERLY ')).toEqual(['jan.ai', 'Q3 filing'])
    expect(titles('janhq')).toEqual(['Jan repo'])
    expect(titles('filing')).toEqual(['Q3 filing'])
    expect(titles('nothing')).toEqual([])
  })

  it('filters by search text across name, path, description, and chat title, and by kind', () => {
    const rows = artifactRows(LIBRARY)
    type Group = Parameters<typeof filterArtifacts>[2]
    const names = (query: string, group: Group = null) => filterArtifacts(rows, query, group).map(row => row.name)
    expect(names('')).toHaveLength(5)
    expect(names('  DECK.pptx ')).toEqual(['deck.pptx'])
    expect(names('launch')).toEqual(['deck.pptx', 'hero.png'])
    expect(names('revenue')).toEqual(['figures.xlsx'])
    expect(names('quarterly')).toEqual(['figures.xlsx', 'report.docx'])
    expect(names('', 'images')).toEqual(['hero.png'])
    expect(names('quarterly', 'documents')).toEqual(['report.docx'])
    expect(names('nothing')).toEqual([])
  })
})

describe('ArtifactsController', () => {
  const failure = (code: string) => ({ ok: false as const, error: { code, message: code } as never })

  it('checks files on disk: missing is recorded, a transport failure leaves the file unknown', async () => {
    const stat = vi.fn(async (_id: SessionId, path: string) => {
      if (path === 'ok') return { ok: true as const, value: {} }
      if (path === 'gone') return failure('workspace-file/not-found')
      if (path === 'dir') return failure('workspace-file/not-regular-file')
      if (path === 'throws') throw new Error('offline')
      return failure('gateway/internal')
    })
    const controller = new ArtifactsController({ stat, refreshProjections: vi.fn() })
    for (const path of ['ok', 'gone', 'dir', 'throws', 'flaky']) await controller.check({ key: path, sessionId: sid('s'), path })
    expect(controller.availability.getSnapshot()).toEqual({ ok: 'available', gone: 'missing', dir: 'missing' })
    // A later check sees a restored file.
    stat.mockResolvedValueOnce({ ok: true as const, value: {} })
    await controller.check({ key: 'gone', sessionId: sid('s'), path: 'gone' })
    expect(controller.availability.getSnapshot().gone).toBe('available')
  })

  it('reads each unindexed chat once, two at a time', async () => {
    const gates: Array<() => void> = []
    const started: string[] = []
    const refreshProjections = vi.fn((id: SessionId) => {
      started.push(id)
      const { promise, resolve } = Promise.withResolvers<undefined>()
      gates.push(() => { resolve(undefined) })
      return promise
    })
    const controller = new ArtifactsController({ stat: vi.fn(), refreshProjections })
    controller.hydrate([sid('a'), sid('b'), sid('c')])
    controller.hydrate([sid('a'), sid('b')])
    expect(started).toEqual(['a', 'b'])
    expect(controller.scanning.getSnapshot()).toBe(3)
    gates[0]!()
    await vi.waitFor(() => { expect(started).toEqual(['a', 'b', 'c']) })
    gates[1]!(); gates[2]!()
    await vi.waitFor(() => { expect(controller.scanning.getSnapshot()).toBe(0) })
    expect(refreshProjections).toHaveBeenCalledTimes(3)
  })

  it('survives an unreadable chat and forgets what it read on reset', async () => {
    const refreshProjections = vi.fn().mockRejectedValueOnce(new Error('gone')).mockResolvedValue(undefined)
    const controller = new ArtifactsController({ stat: vi.fn(), refreshProjections })
    controller.hydrate([sid('a'), sid('b')])
    await vi.waitFor(() => { expect(controller.scanning.getSnapshot()).toBe(0) })
    expect(refreshProjections).toHaveBeenCalledTimes(2)
    controller.reset()
    controller.hydrate([sid('a')])
    await vi.waitFor(() => { expect(refreshProjections).toHaveBeenCalledTimes(3) })
  })

  it('does not consume a new connection queued chat when an old worker settles', async () => {
    const pending = new Map<string, PromiseWithResolvers<undefined>>()
    const started: string[] = []
    const refreshProjections = vi.fn((id: SessionId) => {
      started.push(id)
      const gate = Promise.withResolvers<undefined>()
      pending.set(id, gate)
      return gate.promise
    })
    const controller = new ArtifactsController({ stat: vi.fn(), refreshProjections })
    controller.hydrate([sid('old')])
    controller.reset()
    controller.hydrate([sid('new-a'), sid('new-b'), sid('new-c')])
    expect(started).toEqual(['old', 'new-a', 'new-b'])
    pending.get('old')!.resolve(undefined)
    await vi.waitFor(() => { expect(controller.scanning.getSnapshot()).toBe(3) })
    pending.get('new-a')!.resolve(undefined)
    await vi.waitFor(() => { expect(started).toEqual(['old', 'new-a', 'new-b', 'new-c']) })
    pending.get('new-b')!.resolve(undefined)
    pending.get('new-c')!.resolve(undefined)
    await vi.waitFor(() => { expect(controller.scanning.getSnapshot()).toBe(0) })
  })

  it('advances the reset generation when clearing availability', () => {
    const controller = new ArtifactsController({ stat: vi.fn(), refreshProjections: vi.fn() })
    expect(controller.resetGeneration.getSnapshot()).toBe(0)
    controller.availability.set({ file: 'missing' })
    controller.reset()
    expect(controller.availability.getSnapshot()).toEqual({})
    expect(controller.resetGeneration.getSnapshot()).toBe(1)
  })
})

describe('ArtifactsPage', () => {
  function setup(list: SessionListState, availability: ArtifactAvailabilityMap = {}) {
    const open = new PresentedOpenController()
    open.host.set({ name: 'desktop', available: true, fileManager: 'finder' })
    const openChat = vi.fn<ArtifactsInjected['openChat']>()
    const openPresented = vi.fn<ArtifactsInjected['openPresented']>(() => Promise.resolve({ kind: 'opened' }))
    const checkAvailability = vi.fn<ArtifactsInjected['checkAvailability']>(() => Promise.resolve())
    const hydrate = vi.fn<ArtifactsInjected['hydrate']>()
    const availabilityStore = createSnapshotStore(availability)
    const scanning = createSnapshotStore(0)
    const resetGeneration = createSnapshotStore(0)
    const props: Parameters<typeof ArtifactsPage>[0] = {
      t: makeTranslate(en),
      useSessions: <T,>(select: (state: SessionListState) => T): T => select(list),
      usePresentedOpen: <T,>(select: (state: ReturnType<typeof open.state.getSnapshot>) => T): T => select(open.state.getSnapshot()),
      usePresentedHost: <T,>(select: (state: ReturnType<typeof open.host.getSnapshot>) => T): T => select(open.host.getSnapshot()),
      useAvailability: <T,>(select: (state: ArtifactAvailabilityMap) => T): T => select(availabilityStore.getSnapshot()),
      useScanning: <T,>(select: (state: number) => T): T => select(scanning.getSnapshot()),
      useResetGeneration: bindSnapshotSelector(resetGeneration),
      reloadPresentedHost: vi.fn(() => open.loadHost()), openPresented, checkAvailability, hydrate, openChat,
    } as never
    const view = render(<ArtifactsPage {...props} />)
    return { view, props, openChat, openPresented, checkAvailability, hydrate, availabilityStore, resetGeneration }
  }

  const names = (view: ReturnType<typeof render>) =>
    [...view.container.querySelectorAll('[data-artifact-row]')].map(row => row.querySelector('span[title]')?.textContent)

  it('lists files newest first with kind filters and a total', () => {
    const { view, checkAvailability, hydrate } = setup(LIBRARY)
    expect(names(view)).toEqual(['app.ts', 'figures.xlsx', 'deck.pptx', 'report.docx', 'hero.png'])
    expect(view.container.querySelector('[data-artifacts-count]')?.textContent).toBe('Total: 5')
    const chips = [...view.container.querySelectorAll('[data-artifacts-group]')].map(chip => chip.getAttribute('data-artifacts-group'))
    expect(chips).toEqual(['documents', 'spreadsheets', 'presentations', 'images', 'code'])
    expect(checkAvailability).toHaveBeenCalledTimes(5)
    expect(hydrate).toHaveBeenCalledWith([])

    fireEvent.click(view.getByRole('button', { name: /^Presentations/ }))
    expect(names(view)).toEqual(['deck.pptx'])
    fireEvent.click(view.getByRole('button', { name: 'All' }))
    expect(names(view)).toHaveLength(5)
  })

  it('checks visible files again after availability is cleared on connection reset', () => {
    const b = setup(LIBRARY, { 'alpha:4:0': 'missing' })
    expect(b.checkAvailability).toHaveBeenCalledTimes(5)
    b.checkAvailability.mockClear()
    b.availabilityStore.set({})
    b.resetGeneration.set(1)
    b.view.rerender(<ArtifactsPage {...b.props} />)
    expect(b.checkAvailability).toHaveBeenCalledTimes(5)
  })

  it('filters rows by the search text and explains an empty result', () => {
    const { view } = setup(LIBRARY)
    const search = view.getByRole('searchbox', { name: 'Search files and chats' })
    fireEvent.change(search, { target: { value: 'quarterly' } })
    expect(names(view)).toEqual(['figures.xlsx', 'report.docx'])
    fireEvent.change(search, { target: { value: 'zzz' } })
    expect(view.getByText('No files match your search.')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Clear filters' }))
    expect(names(view)).toHaveLength(5)
  })

  it('shows the empty state when no chat presented a file', () => {
    const { view } = setup(listOf({ one: { title: 'Chat', files: [] } }))
    expect(view.getByText('No files yet. Files the assistant presents in a chat will appear here.')).toBeTruthy()
    expect(view.queryByRole('button', { name: 'All' })).toBeNull()
  })

  it('keeps a deleted file listed as unavailable with only chat navigation enabled', () => {
    const { view, openChat, openPresented } = setup(LIBRARY, { 'alpha:4:0': 'missing' })
    const row = view.container.querySelector('[data-artifact-row="alpha:4:0"]') as HTMLElement
    expect(row.getAttribute('data-missing')).toBe('true')
    expect(within(row).getByText('File not found on disk')).toBeTruthy()
    const open = within(row).getByRole('button', { name: 'Open report.docx' }) as HTMLButtonElement
    const reveal = within(row).getByRole('button', { name: 'Show report.docx in folder' }) as HTMLButtonElement
    expect(open.disabled).toBe(true)
    expect(reveal.disabled).toBe(true)
    fireEvent.click(open)
    expect(openPresented).not.toHaveBeenCalled()
    fireEvent.click(within(row).getByRole('button', { name: 'Go to chat Quarterly review' }))
    expect(openChat).toHaveBeenCalledWith('alpha')
  })

  it('opens, reveals, and returns to the chat of the row it was clicked on', () => {
    const { view, openChat, openPresented } = setup(LIBRARY)
    const row = view.container.querySelector('[data-artifact-row="alpha:6:0"]') as HTMLElement
    fireEvent.click(within(row).getByRole('button', { name: 'Open figures.xlsx' }))
    fireEvent.click(within(row).getByRole('button', { name: 'Show figures.xlsx in folder' }))
    expect(openPresented.mock.calls).toEqual([['alpha', 6, 0, 'open'], ['alpha', 6, 0, 'reveal']])
    fireEvent.click(within(row).getByRole('button', { name: 'Go to chat Quarterly review' }))
    expect(openChat).toHaveBeenCalledTimes(1)
    expect(openChat).toHaveBeenCalledWith('alpha')
    const other = view.container.querySelector('[data-artifact-row="beta:3:0"]') as HTMLElement
    fireEvent.click(within(other).getByRole('button', { name: 'Go to chat Launch deck' }))
    expect(openChat).toHaveBeenLastCalledWith('beta')
  })

  it('pages long libraries and reads legacy chats it has no files for', () => {
    const many = Object.fromEntries(Array.from({ length: 30 }, (_, index) =>
      [`c${index}`, { title: `Chat ${index}`, files: [file(`/w/f${index}.md`, 2, 1_000 + index)] }]))
    const list = listOf({ ...many, legacy: { title: 'Legacy' } })
    const { view, hydrate } = setup(list)
    expect(names(view)).toHaveLength(24)
    expect(hydrate).toHaveBeenCalledWith(['legacy'])
    fireEvent.click(view.getByRole('button', { name: 'Show 6 more' }))
    expect(names(view)).toHaveLength(30)
  })

  it('switches to the Links tab, which opens links in the browser, copies them, and returns to their chat', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const { view, openChat, checkAvailability } = setup(LIBRARY)
    checkAvailability.mockClear()
    fireEvent.click(view.getByRole('tab', { name: 'Links' }))
    expect(view.getByRole('tabpanel').id).toBe('artifacts-panel-links')
    expect(view.container.querySelector('[data-artifacts-count]')?.textContent).toBe('Total: 3')
    expect(view.queryByRole('button', { name: 'All' })).toBeNull()
    expect(checkAvailability).not.toHaveBeenCalled()
    const rows = [...view.container.querySelectorAll<HTMLElement>('[data-link-row]')]
    expect(rows.map(row => row.getAttribute('data-link-row'))).toEqual(['https://github.com/janhq/jan', 'https://jan.ai/docs', 'https://www.example.com/q3'])

    const anchor = within(rows[2] as HTMLElement).getByRole('link', { name: 'Open Q3 filing in your browser' })
    expect([anchor.getAttribute('href'), anchor.getAttribute('target'), anchor.getAttribute('rel')])
      .toEqual(['https://www.example.com/q3', '_blank', 'noopener noreferrer'])
    expect(within(rows[2] as HTMLElement).getByText('You shared')).toBeTruthy()

    fireEvent.click(within(rows[0] as HTMLElement).getByRole('button', { name: 'Copy link Jan repo' }))
    await vi.waitFor(() => { expect(within(rows[0] as HTMLElement).getByText('Copied')).toBeTruthy() })
    expect(writeText).toHaveBeenCalledWith('https://github.com/janhq/jan')
    fireEvent.click(within(rows[0] as HTMLElement).getByRole('button', { name: 'Go to chat Prototype' }))
    expect(openChat).toHaveBeenCalledWith('gamma')

    fireEvent.change(view.getByRole('searchbox', { name: 'Search links and chats' }), { target: { value: 'zzz' } })
    expect(view.getByText('No links match your search.')).toBeTruthy()
  })

  it('explains an empty Links tab', () => {
    const { view } = setup(listOf({ one: { title: 'Chat', files: [file('/w/a.md', 2, 1_000)] } }))
    fireEvent.click(view.getByRole('tab', { name: 'Links' }))
    expect(view.getByText('No links yet. Web links you or the assistant share in a chat will appear here.')).toBeTruthy()
    expect(view.queryByRole('button', { name: 'Clear filters' })).toBeNull()
  })
})

describe('artifacts registration', () => {
  it('registers the artifacts main panel and sidebar entry, and Go to chat opens the Session', async () => {
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    const locale = new LocaleRuntime(ctx)
    ctx.provide('locale', locale)
    locale.register(NS, { zh, en, ja, es, fr, de, ru, pt })
    ctx.slots.register({
      name: 'root',
      children: { 'main': { kind: 'keyed', scope: 'root' }, 'sidebar.panellist': { kind: 'list', scope: 'root' } },
    } as never, () => null)
    const openSession = vi.fn()
    const refreshProjections = vi.fn(() => Promise.resolve())
    const stat = vi.fn(() => Promise.resolve({ ok: true as const, value: {} }))
    const workspaceFiles = { stat }
    ctx.provide('sessions', { refreshProjections } as never)
    ctx.provide('uiWorkspace', { openSession } as never)
    ctx.provide('remote', { $on: () => () => {}, $host: { home: undefined, name: undefined, remote: false, isLoopback: false }, workspaceFiles } as never)
    ctx.provide('remote.workspaceFiles', workspaceFiles as never)
    const opener = new PresentedOpenController()
    await ctx.plugin({ inject: ['slots', 'locale'], apply: (inner: Context) => { registerArtifacts(inner, opener) } }).await()

    expect(ARTIFACTS_PANEL_ID).toBe('artifacts')
    const [main] = ctx.slots.entries('main')
    expect(main?.options.key).toBe('artifacts')
    const [panel] = ctx.slots.entries('sidebar.panellist')
    expect(panel?.options.id).toBe('artifacts')
    expect(resolveSlotLabel(panel?.options.label)).toBe('Artifacts')

    const face: ArtifactsInjected = main!.inject!() as never
    face.openChat(sid('chat-7'))
    expect(openSession).toHaveBeenCalledWith('chat-7')
    face.hydrate([sid('legacy')])
    await vi.waitFor(() => { expect(refreshProjections).toHaveBeenCalledWith('legacy') })
    await face.checkAvailability({ key: 'chat-7:2:0', sessionId: sid('chat-7'), path: '/w/a.md' })
    expect(stat).toHaveBeenCalledWith('chat-7', '/w/a.md', expect.any(AbortSignal))
    expect(face.hooks.availability.getSnapshot()).toEqual({ 'chat-7:2:0': 'available' })
    expect(face.hooks.presentedOpen).toBe(opener.state)
    ctx.emit('connection/reset')
    expect(face.hooks.availability.getSnapshot()).toEqual({})
  })
})
