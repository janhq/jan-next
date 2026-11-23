// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as primitives from '@janhq/jan-client-ui-primitives'
import type * as ReactAPI from 'react'
import { afterEach, expect, it } from 'vitest'

const React: typeof ReactAPI = createRequire(import.meta.resolve('@testing-library/react'))('react')
const source = readFileSync(join(import.meta.dirname, '../client.js'), 'utf8')

afterEach(cleanup)

type Call = { method: string; params: Record<string, unknown> }
type Reply = { result?: unknown; error?: string }

/** Mount the Settings tab with a Host whose replies come from `reply`. */
function mount(reply: (call: Call) => Reply) {
  const calls: Call[] = []
  let tab!: ReactAPI.ComponentType
  const fetch = async (_url: URL, init: { body: string }) => {
    const call = JSON.parse(init.body) as Call
    calls.push(call)
    const body = reply(call)
    return { ok: body.error === undefined, status: body.error === undefined ? 200 : 400, json: async () => body }
  }
  const ctx = {
    effect: (run: () => void) => run(),
    get: () => undefined,
    sessions: { refresh: async () => {} },
    uiWorkspace: { startSession() {} },
    slots: {
      inject: (_name: string, run: () => void) => run(),
      register: (options: { name: string }, component: ReactAPI.ComponentType) => { if (options.name === 'settings.plugins.tab') tab = component },
    },
  }
  runInNewContext(source, {
    window: { __ModuleLoader__: { load: ({ factory }: { factory: (require: (id: string) => unknown) => { apply: (ctx: object) => void } }) => {
      factory(id => id === 'react' ? React : primitives).apply(ctx)
    } } },
    document, fetch, URL, setTimeout, clearTimeout, console,
  })
  render(React.createElement(tab))
  return calls
}

it('frees the form and ignores an earlier run when the Host refuses an import before it starts', async () => {
  const thread = { id: 't1', title: 'Trip plan', messageCount: 3, updated: Date.parse('2026-11-01') }
  const settings = { providers: [], mcp: { names: ['search'], skipped: [] }, assistants: [] }
  const calls = mount(({ method }) => {
    if (method === 'list') return { result: { folder: '/jan', threads: [thread], settings, scanId: 'scan-1' } }
    // The Host still holds an earlier, finished run that imported this chat.
    if (method === 'progress') return { result: { runId: 'earlier', running: false, total: 1, done: 1, current: null, results: [{ id: 't1', status: 'imported' }] } }
    if (method === 'import') return { error: 'The MCP scan expired. Scan again before importing.' }
    return { result: null }
  })

  const importButton = await screen.findByRole('button', { name: 'Import 1 chat and settings' })
  fireEvent.click(importButton)

  expect((await screen.findByRole('alert')).textContent).toBe('The MCP scan expired. Scan again before importing.')
  expect(calls.find(call => call.method === 'import')?.params).toMatchObject({ scanId: 'scan-1', ids: ['t1'] })
  // The earlier run's results never stand in for this refused one.
  expect(screen.queryByText('Imported')).toBeNull()
  expect(screen.queryByRole('progressbar')).toBeNull()
  await waitFor(() => expect((screen.getByRole('button', { name: 'Import 1 chat and settings' }) as HTMLButtonElement).disabled).toBe(false))
  expect((screen.getByRole('checkbox', { name: 'Trip plan' }) as HTMLInputElement).disabled).toBe(false)
  expect((screen.getByRole('button', { name: 'Change' }) as HTMLButtonElement).disabled).toBe(false)
  expect(screen.getByLabelText('Import sessions').getAttribute('aria-busy')).toBe('false')
})
