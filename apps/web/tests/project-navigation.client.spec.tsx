// @vitest-environment jsdom
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import * as React from 'react'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'

type Source<T> = { getSnapshot(): T; subscribe(listener: () => void): () => void }
type Registration = { key?: string; id?: string; inject?: () => Record<string, unknown> }
type Entry = { options: Registration; Component: React.ComponentType<Record<string, unknown>> }
type Plugin = { apply(ctx: object): void }
const rows = [
  { workspaceId: 'alpha', title: 'Alpha', path: '/work/Foo', sessionIds: ['linked'], updatedAt: '2026-01-01' },
  { workspaceId: 'beta', title: 'Beta', path: '/work/foo', sessionIds: [], updatedAt: '2026-01-02' },
  { workspaceId: 'default', title: 'default-workspace', path: '/work/default-workspace', sessionIds: [], updatedAt: '2026-01-03', isDefault: true },
  { workspaceId: 'manual', title: 'default-workspace', path: '/manual/default-workspace', sessionIds: [], updatedAt: '2026-01-04' },
]
const workspaces = { items: rows, archivedSessionIds: [] }
const source = <T,>(value: T): Source<T> => ({ getSnapshot: () => value, subscribe: () => () => {} })
const text = (instructions: string) => ({ instructions, memory: '', files: [], truncated: false })
const reply = (result: unknown) => Response.json({ result })
let loadPlugin: () => Plugin

beforeAll(async () => {
  const loader = {
    load({ factory }: { factory: (require: (name: string) => unknown) => Plugin }) {
      loadPlugin = () => factory((name) => {
        if (name === 'react') return React
        if (name === '@janhq/jan-client-ui-model-selection/client') return {}
        if (name === '@janhq/jan-api-workspace-controller/client') return {
          workspaceDisplayTitle: (row: typeof rows[number], defaultName: string) => row.isDefault === true && row.title === 'default-workspace' ? defaultName : row.title,
        }
        return new Proxy({}, { get: (_, property) => {
          if (property === 'Button') return ({ children, disabled, onClick }: React.ComponentProps<'button'>) =>
            <button type="button" disabled={disabled} onClick={onClick}>{children}</button>
          if (property === 'Modal') return ({ open, title, children, footer }: {
            open: boolean
            title: string
            children: React.ReactNode
            footer?: React.ReactNode
          }) => open ? <div role="dialog" aria-label={title}>{children}{footer}</div> : null
          return () => null
        } })
      })
    },
  }
  // This hand-written asset registers through Jan's runtime loader instead of exporting ESM.
  const file = resolve(import.meta.dirname, '../../../plugins/jan-theme/client.js')
  const browser = { __ModuleLoader__: loader, setTimeout: window.setTimeout.bind(window) }
  runInNewContext(await readFile(file, 'utf8'), { window: browser, document, localStorage, get fetch() { return globalThis.fetch }, URLSearchParams, AbortController, console }, { filename: file })
})

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

function theme(tasks: readonly unknown[] = []) {
  const registrations = new Map<string, Entry>()
  const disposers: (() => void)[] = []
  const selectPanel = vi.fn()
  const startSession = vi.fn()
  let openProject: ((id: string) => void) | undefined
  let openSearch: (() => void) | undefined
  const services = {
    slots: {
      inject: (_name: string, register: () => void) => register(),
      register: (options: Registration, Component: Entry['Component']) => {
        const key = options.key ?? options.id
        if (key !== undefined) registrations.set(key, { options, Component })
      },
      entriesOfSlot: () => [], subscribe: () => () => {},
    },
    layout: { configureSidebar: () => {}, selectPanel, panelInfo: source({ activePanelId: null }) },
    uiWorkspace: {
      setSessionGrouping: () => {}, startSession,
      registerProjectHandler: (open: (id: string) => void) => { openProject = open },
      openProjectSurface: (id: string) => { openProject?.(id); return openProject !== undefined },
      registerSearchHandler: (open: () => void) => { openSearch = open },
    },
    workspaces: { list: source(workspaces) },
    sessions: { list: source({ ids: [], byId: {} }) },
    shortcuts: { catalog: source([]), register: () => () => {} },
    locale: { bind: () => (key: string) => key, register: () => () => {}, subscribe: () => () => {} },
    remote: { schedule: { catalog: async () => ({ ok: true, value: tasks }) } },
    effect: (register: () => (() => void) | undefined) => {
      const dispose = register()
      if (dispose !== undefined) disposers.push(dispose)
    },
    inject: (keys: string[], apply: (scope: object) => void) => {
      if (keys.every(key => key === 'remote.schedule' || Object.hasOwn(services, key))) apply(services)
    },
  }
  loadPlugin().apply(services)
  const renderEntry = (id: string) => {
    const entry = registrations.get(id)
    if (entry === undefined) throw new Error(`Missing slot entry ${id}`)
    const { hooks, ...actions } = entry.options.inject?.() ?? {}
    const boundHooks = Object.fromEntries(Object.entries(hooks as Record<string, Source<unknown>>).map(([key, wire]) => [
      `use${key[0]!.toUpperCase()}${key.slice(1)}`, (select: (value: unknown) => unknown) =>
        select(React.useSyncExternalStore(wire.subscribe, wire.getSnapshot)),
    ]))
    return render(<entry.Component {...actions} {...boundHooks} t={(key: string) => key} />)
  }
  return {
    renderEntry, selectPanel, startSession,
    openProject: (id: string) => services.uiWorkspace.openProjectSurface(id),
    openSearch: () => { openSearch?.() },
    unmount: () => { for (const dispose of disposers.reverse()) dispose() },
  }
}

it('never displays a late read from the previously selected project', async () => {
  const alpha = Promise.withResolvers<Response>()
  const beta = Promise.withResolvers<Response>()
  vi.stubGlobal('fetch', vi.fn((_url: string, { body }: RequestInit) =>
    JSON.parse(String(body)).params.workspaceId === 'alpha' ? alpha.promise : beta.promise))
  const app = theme()
  try {
    app.openProject('alpha')
    app.renderEntry('jt-project')
    act(() => { app.openProject('beta') })
    await act(async () => { beta.resolve(reply(text('Beta instructions'))) })
    await act(async () => { alpha.resolve(reply(text('Alpha private content'))) })
    expect(screen.getByRole('heading', { name: 'Beta' })).toBeTruthy()
    expect(screen.getByText('Beta instructions')).toBeTruthy()
    expect(screen.queryByText('Alpha private content')).toBeNull()
  } finally { app.unmount() }
})

it('closes the previous project editor instead of letting its draft save to another project', async () => {
  vi.stubGlobal('fetch', vi.fn(async (_url: string, { body }: RequestInit) =>
    reply(text(JSON.parse(String(body)).params.workspaceId === 'alpha' ? 'Alpha instructions' : 'Beta instructions'))))
  const app = theme()
  try {
    app.openProject('alpha')
    app.renderEntry('jt-project')
    await screen.findByText('Alpha instructions')
    const instructions = screen.getByRole('region', { name: 'project.instructions' })
    fireEvent.click(within(instructions).getByRole('button', { name: 'project.edit' }))
    const editor = screen.getByRole('dialog', { name: 'project.instructions' })
    fireEvent.change(within(editor).getByRole('textbox'), { target: { value: 'Unsaved Alpha draft' } })
    act(() => { app.openProject('beta') })
    await screen.findByText('Beta instructions')
    expect(screen.queryByRole('dialog')).toBeNull()
    act(() => { app.openProject('alpha') })
    await screen.findByText('Alpha instructions')
    fireEvent.click(within(screen.getByRole('region', { name: 'project.instructions' })).getByRole('button', { name: 'project.edit' }))
    expect(within(screen.getByRole('dialog', { name: 'project.instructions' })).getByRole<HTMLTextAreaElement>('textbox').value).toBe('Unsaved Alpha draft')
  } finally { app.unmount() }
})

it('shows only tasks in the selected case-sensitive project or linked to one of its chats', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => reply(text(''))))
  const app = theme([
    { id: 'alpha', title: 'Alpha task', status: 'paused', target: { kind: 'new', create: { cwd: '/work/Foo' } } },
    { id: 'beta', title: 'Beta task', status: 'paused', target: { kind: 'new_once', create: { cwd: '/work/foo' } } },
    { id: 'link', title: 'Linked chat task', status: 'paused', target: { kind: 'session', sessionId: 'linked' } },
  ])
  try {
    app.openProject('alpha')
    app.renderEntry('jt-project')
    await screen.findByText('Alpha task')
    expect(screen.queryByText('Beta task')).toBeNull()
    expect(screen.getByText('Linked chat task')).toBeTruthy()
  } finally { app.unmount() }
})

it('labels the automatic default project by its feed identity on the project page', () => {
  vi.stubGlobal('fetch', vi.fn(async () => reply(text(''))))
  const app = theme()
  try {
    app.openProject('default')
    app.renderEntry('jt-project')
    expect(screen.getByRole('heading', { name: 'workspace.defaultName' })).toBeTruthy()
    act(() => { app.openProject('manual') })
    expect(screen.getByRole('heading', { name: 'default-workspace' })).toBeTruthy()
  } finally { app.unmount() }
})

it('opens the project page, not a new chat, from a search result', async () => {
  const app = theme()
  const scroll = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView')
  Object.defineProperty(Element.prototype, 'scrollIntoView', { value: () => {}, configurable: true })
  try {
    app.openSearch()
    app.renderEntry('jt-search-palette')
    fireEvent.click(screen.getByRole('tab', { name: 'projects' }))
    fireEvent.click(screen.getByRole('option', { name: /Alpha/ }))
    await vi.waitFor(() => { expect(app.selectPanel).toHaveBeenCalledWith('jt-project') })
    expect(app.startSession).not.toHaveBeenCalled()
  } finally {
    if (scroll === undefined) Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
    else Object.defineProperty(Element.prototype, 'scrollIntoView', scroll)
    app.unmount()
  }
})
