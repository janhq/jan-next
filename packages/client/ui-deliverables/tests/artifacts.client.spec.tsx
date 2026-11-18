// @vitest-environment jsdom
/**
 * Artifacts library: the model derived from Session-list projection values, the
 * controller that fills legacy rows and checks files on disk, the page's
 * grouping, search, unavailable files, and chat navigation, and the panel and
 * sidebar registrations.
 */
import { cleanup, fireEvent, render, within } from '@testing-library/react'
import { Context } from '@janhq/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionListState } from '@janhq/jan-api-session-controller/client'
import { LocaleRuntime } from '@janhq/jan-client-locale/client'
import { SlotRegistry } from '@janhq/jan-client-ui-renderer/client'
import { resolveSlotLabel } from '@janhq/jan-client-ui-slots'
import { createSnapshotStore } from '@janhq/jan-client-store'
import { makeTranslate, usePinnedBrowserLanguages } from '@janhq/jan-client-test-runtime'
import type { SessionId } from '@janhq/jan-session/types'
import type { PresentedFileEntry } from '@janhq/jan-tool-present/types'
import {
  ArtifactsController, artifactGroup, artifactRows, filterArtifacts, unindexedChats, type ArtifactAvailabilityMap,
} from '../src/client/artifacts.ts'
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

interface Chat {
  readonly title: string
  readonly files?: readonly PresentedFileEntry[]
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
    const values = chat.files === undefined ? {} : { presentedFiles: chat.files }
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
  alpha: { title: 'Quarterly review', files: [file('/w/report.docx', 4, 5_000), file('/w/figures.xlsx', 6, 9_000, 'Revenue by region')] },
  beta: { title: 'Launch deck', files: [file('/w/deck.pptx', 3, 7_000), file('/w/hero.png', 5, 2_000)] },
  gamma: { title: 'Prototype', summaryOnly: true, files: [file('/w/app.ts', 8, 12_000)] },
  child: { title: 'Helper', files: [file('/w/hidden.md', 2, 99_000)], parentId: 'alpha' },
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

  it('names the chats whose list row holds no presented-files value yet', () => {
    const list = listOf({
      legacy: { title: 'Old' },
      empty: { title: 'Indexed', files: [] },
      fresh: { title: 'Blank', blank: true },
      loading: { title: 'Loading', state: 'loading' },
      read: { title: 'Read', state: 'ready' },
      sub: { title: 'Sub', parentId: 'legacy' },
    })
    expect(unindexedChats(list)).toEqual(['legacy'])
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
    const props: Parameters<typeof ArtifactsPage>[0] = {
      t: makeTranslate(en),
      useSessions: <T,>(select: (state: SessionListState) => T): T => select(list),
      usePresentedOpen: <T,>(select: (state: ReturnType<typeof open.state.getSnapshot>) => T): T => select(open.state.getSnapshot()),
      usePresentedHost: <T,>(select: (state: ReturnType<typeof open.host.getSnapshot>) => T): T => select(open.host.getSnapshot()),
      useAvailability: <T,>(select: (state: ArtifactAvailabilityMap) => T): T => select(availabilityStore.getSnapshot()),
      useScanning: <T,>(select: (state: number) => T): T => select(scanning.getSnapshot()),
      reloadPresentedHost: vi.fn(() => open.loadHost()), openPresented, checkAvailability, hydrate, openChat,
    } as never
    const view = render(<ArtifactsPage {...props} />)
    return { view, openChat, openPresented, checkAvailability, hydrate }
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
    ctx.provide('remote', { $on: () => () => {}, $host: { home: undefined, isLoopback: false }, workspaceFiles } as never)
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
