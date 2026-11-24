// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import * as primitives from '@janhq/jan-client-ui-primitives'
import type * as ReactAPI from 'react'
import { afterEach, expect, it, vi } from 'vitest'

const React = createRequire(import.meta.resolve('@testing-library/react'))('react') as typeof ReactAPI
const source = readFileSync(join(import.meta.dirname, '../client.js'), 'utf8')

afterEach(() => {
  cleanup()
  document.querySelector('style[data-plugin="@janhq/jan-downloads"]')?.remove()
})

it('opens an empty inbox, shows downloads from each producer, and returns focus on Escape', async () => {
  type HeaderProps = { t: typeof t; iconSize: number; tooltipSide: string; useInbox: () => unknown }
  let header!: ReactAPI.ComponentType<HeaderProps>
  let props: { hooks?: Record<string, { subscribe: (fn: () => void) => () => void; getSnapshot: () => unknown }>; request?: unknown } = {}
  let copy: Record<string, string>
  const t = (key: string, values: Record<string, unknown> = {}) =>
    (copy[key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) => String(values[name]))
  let stream!: ReadableStreamDefaultController<Uint8Array>
  const send = (snapshot: object) => { stream.enqueue(new TextEncoder().encode(`${JSON.stringify(snapshot)}\n`)) }
  const body = new ReadableStream<Uint8Array>({ start(controller) { stream = controller } })
  const request = vi.fn(async (_: URL, options?: RequestInit) => options?.method === 'POST'
    ? new Response(null, { status: 204 }) : new Response(body))
  const scope = {
    locale: { register: (_: string, translations: { en: Record<string, string> }) => { copy = translations.en }, bind: () => t },
    effect: (run: () => void) => { run() },
    inject: () => {},
    slots: {
      inject: (_: string, run: () => void) => { run() },
      register: (options: { name: string; inject?: () => typeof props }, component: typeof header) => {
        if (options.name !== 'sidebar.toggle.actions') return
        header = component
        props = options.inject?.() ?? {}
      },
    },
  }
  runInNewContext(source, {
    window: { __ModuleLoader__: {
      load: ({ factory }: { factory: (require: (id: string) => unknown) => { apply: (ctx: object) => void } }) => {
        const plugin = factory(id => id === 'react' ? React : id === 'react-dom' ? createRequire(import.meta.url)('react-dom') : primitives)
        plugin.apply(scope)
      },
    } },
    setTimeout, clearTimeout, URL, document, AbortController, TextDecoderStream, fetch: request,
  })
  const inbox = props.hooks?.inbox
  render(React.createElement(header, {
    t, iconSize: 16, tooltipSide: 'bottom', ...props,
    useInbox: () => inbox ? React.useSyncExternalStore(inbox.subscribe, inbox.getSnapshot) : null,
  }))
  const downloads = screen.getByRole('button', { name: 'Downloads' })
  await act(async () => { send({ items: [], active: { count: 0, percent: null }, unseen: null }) })
  fireEvent.click(downloads)
  expect(screen.getByRole('dialog')).toBeTruthy()
  expect(screen.getByText('Your download progress will appear here')).toBeTruthy()
  await act(async () => { send({ items: [
    { id: 'model', kind: 'model', name: 'Qwen', state: 'downloading', percent: 25, receivedBytes: 250_000_000,
      totalBytes: 1_000_000_000, bytesPerSecond: 12_500_000, actions: ['pause'] },
    { id: 'plugin', kind: 'plugin', name: 'Calendar', state: 'failed', error: 'Network unavailable', actions: ['retry'] },
  ], active: { count: 1, percent: 25 }, unseen: { sequence: 1, failed: true } }) })
  expect(screen.getByText('Qwen')).toBeTruthy()
  expect(screen.getByText('Calendar')).toBeTruthy()
  expect(screen.getByText('Network unavailable')).toBeTruthy()
  expect(screen.getByText('12.5 MB/s')).toBeTruthy()
  expect(screen.getByText('1 min left')).toBeTruthy()
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Pause' })) })
  expect(request.mock.calls.at(-1)?.[1]?.body).toBe(JSON.stringify({ method: 'act', id: 'model', action: 'pause' }))
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Clear finished' })) })
  expect(request.mock.calls.at(-1)?.[1]?.body).toBe(JSON.stringify({ method: 'clearFinished' }))
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(document.activeElement).toBe(downloads)
  stream.close()
})
