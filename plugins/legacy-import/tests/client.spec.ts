// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as store from '@janhq/jan-client-store'
import * as primitives from '@janhq/jan-client-ui-primitives'
import type * as ReactAPI from 'react'
import { afterEach, expect, it } from 'vitest'

const React: typeof ReactAPI = createRequire(import.meta.resolve('@testing-library/react'))('react')
const source = readFileSync(join(import.meta.dirname, '../client.js'), 'utf8')
const localeSource = readFileSync(join(import.meta.dirname, '../client.locale.js'), 'utf8')

afterEach(cleanup)

type Call = { method: string; params: Record<string, unknown> }
type Reply = { result?: unknown; error?: string }
type Translate = (key: string, values?: Record<string, unknown>) => string
type Page = ReactAPI.ComponentType<Record<string, unknown>>

/** Run one `window.__ModuleLoader__` chunk and return what its factory builds. */
function load<T>(code: string, globals: object, require?: unknown): T {
  let built!: T
  runInNewContext(code, {
    ...globals,
    window: { __ModuleLoader__: { load: ({ factory }: { factory: (require: unknown) => T }) => { built = factory(require) } } },
  })
  return built
}

/** Mount the Settings > Import page on its local tab with a Host whose replies come from `reply`. */
async function mount(reply: (call: Call) => Reply) {
  const calls: Call[] = []
  const fetch = async (_url: URL, init: { body: string }) => {
    const call = JSON.parse(init.body) as Call
    calls.push(call)
    const body = reply(call)
    return { ok: body.error === undefined, status: body.error === undefined ? 200 : 400, json: async () => body }
  }
  const locale = load<{ dictionaries: Record<string, Record<string, string>> }>(localeSource, {})
  const t: Translate = (key, values = {}) => locale.dictionaries.en[key]!.replace(/\{(\w+)\}/gu, (_, name: string) => String(values[name]))
  let page: Page | undefined
  const ctx = {
    effect: (run: () => void) => run(),
    get: () => undefined,
    inject: () => {},
    locale: { register: () => () => {}, bind: () => t },
    sessions: { refresh: async () => {} },
    uiWorkspace: { startSession() {} },
    slots: {
      inject: (_name: string, run: () => void) => run(),
      register: (options: { name: string }, component: Page) => { if (options.name === 'settings.section') page = component },
    },
  }
  const require = Object.assign((id: string) => id === 'react' ? React : id === '@janhq/jan-client-store' ? store : primitives, { async: async () => locale })
  load<{ apply: (ctx: object) => void }>(source, { document, fetch, URL, setTimeout, clearTimeout, console }, require).apply(ctx)
  await waitFor(() => expect(page).toBeDefined())
  const launch = { source: 'jan' }
  render(React.createElement(page!, {
    useLaunch: (select: (value: unknown) => unknown) => select(launch), takeLaunch() {}, close() {},
    refreshSessions: async () => {}, startMigrate() {}, t,
  }))
  return calls
}

it('frees the form and ignores an earlier run when the Host refuses an import before it starts', async () => {
  const thread = { id: 't1', title: 'Trip plan', messageCount: 3, updated: Date.parse('2026-11-01') }
  const settings = { providers: [], assistants: [], mcp: { names: ['search'], rows: [{ name: 'search', status: 'ready', omitted: [] }], files: [], skipped: [], issues: [] } }
  const calls = await mount(({ method }) => {
    if (method === 'list') return { result: { folder: '/jan', threads: [thread], settings, previewId: 'preview-1' } }
    // The Host still holds an earlier, finished run that imported this chat.
    if (method === 'progress') return { result: { runId: 'earlier', running: false, total: 1, done: 1, current: null, results: [{ id: 't1', status: 'imported' }] } }
    if (method === 'import') return { error: 'This preview expired or was already used. Scan or preview again.' }
    return { result: null }
  })

  fireEvent.click(await screen.findByRole('button', { name: 'Import 1 chat and settings' }))

  expect((await screen.findByRole('alert')).textContent).toBe('This preview expired or was already used. Scan or preview again.')
  expect(calls.find(call => call.method === 'import')?.params).toMatchObject({ previewId: 'preview-1', ids: ['t1'], mcpNames: ['search'] })
  // The earlier run's results never stand in for this refused one.
  expect(screen.queryByText('Imported')).toBeNull()
  expect(screen.queryByRole('progressbar')).toBeNull()
  await waitFor(() => expect((screen.getByRole('button', { name: 'Scan again' }) as HTMLButtonElement).disabled).toBe(false))
  expect((screen.getByRole('checkbox', { name: 'Trip plan' }) as HTMLInputElement).disabled).toBe(false)
  expect(screen.getByRole('region', { name: 'Local chats and settings' }).getAttribute('aria-busy')).toBe('false')
})

it('shows a refused import without unlocking the form until the other run ends', async () => {
  const thread = { id: 't1', title: 'Trip plan', messageCount: 3 }
  let running = false
  let submitted = false
  const calls = await mount(({ method }) => {
    if (method === 'list') return { result: { folder: '/jan', threads: [thread], previewId: 'preview-1' } }
    if (method === 'progress') return { result: submitted ? {
      runId: 'other-tab', running, total: 2, done: running ? 1 : 2,
      results: [{ id: 't1', status: 'imported' }],
    } : null }
    if (method === 'import') { submitted = running = true; return { error: 'An import is already running.' } }
    return { result: null }
  })
  await waitFor(() => expect(calls.some(call => call.method === 'progress')).toBe(true))
  fireEvent.click(screen.getByRole('button', { name: 'Import 1 chat' }))

  const form = screen.getByRole('region', { name: 'Local chats and settings' })
  expect((await screen.findByRole('alert')).textContent).toBe('An import is already running.')
  expect(form.getAttribute('aria-busy')).toBe('true')
  expect(screen.getByRole('button', { name: 'Importing 50%…' })).toHaveProperty('disabled', true)
  expect(screen.getByRole('button', { name: 'Change' })).toHaveProperty('disabled', true)
  expect(screen.queryByRole('button', { name: 'Scan again' })).toBeNull()
  expect(screen.queryByText('Imported')).toBeNull()

  running = false
  await waitFor(() => expect(form.getAttribute('aria-busy')).toBe('false'))
  expect(screen.queryByText('Imported')).toBeNull()
  expect(screen.queryByRole('progressbar')).toBeNull()
  expect(screen.getByRole('button', { name: 'Scan again' })).toHaveProperty('disabled', false)
})
