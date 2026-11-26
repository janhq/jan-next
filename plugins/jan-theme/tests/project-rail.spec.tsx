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

const hour = 60 * 60 * 1000

it('shows project rail estimates and refreshes details, skills, tools and schedules', async () => {
  let showProject: ((id: string) => void) | undefined
  let Page: ((props: Record<string, unknown>) => unknown) | undefined
  let inject: (() => Record<string, unknown>) | undefined
  const now = new Date(2026, 10, 24, 8).getTime()
  const clock = vi.spyOn(Date, 'now').mockReturnValue(now)
  onTestFinished(() => { clock.mockRestore() })
  const catalog = vi.fn(async () => ({ ok: true, value: [
    { id: 'soon', title: 'Check progress', workspaceId: 'project', scheduledAt: new Date(now + hour).toISOString(), deliveryFloorEndsAt: new Date(now + 3 * hour).toISOString() },
    { id: 'later', title: 'Review risks', workspaceId: 'project', scheduledAt: new Date(now + 48 * hour).toISOString() },
    { id: 'due', title: 'Read status', workspaceId: 'project', scheduledAt: new Date(now - hour).toISOString() },
    { id: 'paused', title: 'Draft update', workspaceId: 'project', status: 'paused', scheduledAt: new Date(now + hour).toISOString() },
  ] }))
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
    document, URL, Date, AbortController, setTimeout, clearTimeout, setInterval, clearInterval,
    async fetch(_url: URL, { body }: { body: string }) {
      const request = JSON.parse(body)
      reads.push(request)
      const result = request.method === 'read' ? { instructions: '', memory: '', files, contextSummary: { fileCount: files.length, estimatedTokens: files.length * 1200 } }
        : request.method === 'skills' ? { active: 1, total: 1, estimatedTokens: 2100, folders: [{ path: null, enabled: true, skills: [{ name: 'review', enabled: true }] }] } : { mcp: [], connectors: [], plugins: [] }
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
  const t = (key: string, params: Record<string, unknown> = {}) => {
    switch (key) {
      case 'project.locale': return 'en'
      case 'project.context.count.one': return `${params.count} file · ${params.estimate}`
      case 'project.context.count.other': return `${params.count} files · ${params.estimate}`
      case 'project.tokens': return `~${params.count} tokens`
      case 'project.skills.count': return `${params.active} of ${params.total} on · ${params.estimate}`
      default: return key
    }
  }
  const view = render(React.createElement(Page, {
    ...actions, t, useProject: () => hooks.project.getSnapshot(),
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
  await screen.findByText('0 files · ~0 tokens')
  expect(screen.getByText('1 of 1 on · ~2.1K tokens')).toBeDefined()
  const next = screen.getByText('in 3h')
  expect(next.getAttribute('datetime')).toBe(new Date(now + 3 * hour).toISOString())
  expect(next.getAttribute('title')).toBe(new Date(now + 3 * hour).toLocaleString('en', { dateStyle: 'medium', timeStyle: 'short' }))
  expect(screen.getByText('in 2 days')).toBeDefined()
  expect(screen.getByText('project.task.dueToday')).toBeDefined()
  expect(screen.getByText('project.task.paused')).toBeDefined()
  reads.length = 0
  files = [{ name: 'added-on-disk.txt', directory: false }]

  fireEvent.click(screen.getByRole('button', { name: 'project.refresh' }))

  await screen.findByText('added-on-disk.txt')
  await screen.findByText('1 file · ~1.2K tokens')
  await waitFor(() => expect(screen.getByRole('button', { name: 'project.refresh' }).hasAttribute('disabled')).toBe(false))
  expect(reads.map(({ method }) => method).sort()).toEqual(['read', 'skills', 'tools'])
  expect(reads.find(({ method }) => method === 'skills')?.params.rescan).toBe(true)
  expect(catalog).toHaveBeenCalledTimes(2)
})
