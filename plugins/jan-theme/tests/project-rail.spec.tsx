// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as primitives from '@janhq/jan-client-ui-primitives'
import { expect, it, onTestFinished, vi } from 'vitest'

const client = readFileSync(resolve(import.meta.dirname, '../client.js'), 'utf8')
// Use the same React singleton as the app; the plain-JS theme loads it from the client module loader.
const React = createRequire(resolve(import.meta.dirname, '../../../apps/web/package.json'))('react')

it('refreshes project details, rescans skills and reloads tools and schedules from the rail', async () => {
  let showProject: ((id: string) => void) | undefined
  let Page: ((props: Record<string, unknown>) => unknown) | undefined
  let inject: (() => Record<string, unknown>) | undefined
  const catalog = vi.fn(async () => ({ ok: true, value: [] }))
  const reads: { method: string; params: { rescan?: boolean } }[] = []
  let files: { name: string; directory: boolean }[] = []
  const workspace = { workspaceId: 'project', path: '/work/project', sessionIds: [] }
  const list = { getSnapshot: () => ({ items: [workspace], archivedSessionIds: [] }), subscribe: () => () => {} }
  const scope = {
    inject(keys: string[], setup: (ctx: unknown) => void) {
      if (['layout,uiWorkspace,workspaces,locale', 'layout,uiWorkspace,workspaces,sessions,locale', 'remote,remote.schedule'].includes(keys.join(','))) setup(scope)
    },
    provide() {},
    effect(setup: () => void | (() => void)) { const stop = setup(); if (stop) onTestFinished(stop) },
    slots: {
      inject(name: string, setup: () => void) { if (name === 'main') setup() },
      register(options: { key?: string; inject?: typeof inject }, page: typeof Page) {
        if (options.key === 'jt-project') { Page = page; inject = options.inject }
      },
      subscribe: () => () => {},
      entriesOfSlot: () => [],
    },
    remote: { schedule: { catalog }, $on: () => () => {} },
    on: () => () => {},
    layout: { selectPanel() {} },
    uiWorkspace: { registerProjectHandler(handler: typeof showProject) { showProject = handler } },
    workspaces: { list },
    sessions: { list: {} },
    locale: { bind: () => (key: string) => key },
  }
  runInNewContext(client, {
    document, URL, AbortController, setTimeout, clearTimeout,
    async fetch(_url: URL, { body }: { body: string }) {
      const request = JSON.parse(body)
      reads.push(request)
      const result = request.method === 'read' ? { instructions: '', memory: '', files }
        : request.method === 'skills' ? { folders: [] } : { mcp: [], connectors: [], plugins: [] }
      return Response.json({ result })
    },
    window: {
      addEventListener: window.addEventListener.bind(window),
      removeEventListener: window.removeEventListener.bind(window),
      __ModuleLoader__: { load({ factory }) {
        factory(id => id === 'react' ? React : id === '@janhq/jan-client-ui-primitives' ? primitives
          : { workspaceDisplayTitle: () => 'Project' }).apply(scope)
      } },
    },
  })
  if (!Page || !inject || !showProject) throw new Error('Project page not registered')
  showProject('project')
  const { hooks, ...actions } = inject() as { hooks: { project: { getSnapshot(): string }; scheduleTasks: { getSnapshot(): unknown; subscribe(listener: () => void): () => void } }; [key: string]: unknown }
  const view = render(React.createElement(Page, {
    ...actions, t: (key: string) => key, useProject: () => hooks.project.getSnapshot(),
    useWorkspaces: (select: (state: { items: typeof workspace[] }) => unknown) => select(list.getSnapshot()),
    useArchived: () => [], useSessions: () => ({ byId: {} }), useSessionStatus: () => new Map(),
    connectDraft: () => Promise.resolve({ sessionId: 'draft', release() {} }), SessionProvider: () => null,
    renderSlot: () => null,
    useScheduleTasks: () => React.useSyncExternalStore(hooks.scheduleTasks.subscribe, hooks.scheduleTasks.getSnapshot),
  }))
  onTestFinished(view.unmount)
  await screen.findByText('project.context.empty')
  await screen.findByText('project.tools.empty')
  await waitFor(() => expect(catalog).toHaveBeenCalledTimes(1))
  reads.length = 0
  files = [{ name: 'added-on-disk.txt', directory: false }]

  fireEvent.click(screen.getByRole('button', { name: 'project.refresh' }))

  await screen.findByText('added-on-disk.txt')
  await waitFor(() => expect(screen.getByRole('button', { name: 'project.refresh' }).hasAttribute('disabled')).toBe(false))
  expect(reads.map(({ method }) => method).sort()).toEqual(['read', 'skills', 'tools'])
  expect(reads.find(({ method }) => method === 'skills')?.params.rescan).toBe(true)
  expect(catalog).toHaveBeenCalledTimes(2)
})
