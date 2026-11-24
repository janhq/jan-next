// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { fireEvent, render, screen, within } from '@testing-library/react'
import * as primitives from '@janhq/jan-client-ui-primitives'
import * as React from 'react'
import { expect, it, vi } from 'vitest'

const client = readFileSync(resolve(import.meta.dirname, '../../../packages/host/downloads/client.js'), 'utf8')

type Translate = (key: string, values?: Record<string, string>) => string

it('warns with the model name and size, leaves it on cancel, and refreshes after confirmed deletion', async () => {
  const path = 'llama-cpp/models/example/0123456789abcdef.gguf'
  const remote = {
    async *follow(signal: AbortSignal) {
      yield { downloads: [] }
      if (signal.aborted) return
      const stop = Promise.withResolvers<Event>()
      signal.addEventListener('abort', stop.resolve, { once: true })
      await stop.promise
    },
    listStoredDownloads: vi.fn().mockResolvedValue({ ok: true, value: [{ name: 'Example model', path, kind: 'model', bytes: 2500 }] }),
    deleteStoredDownload: vi.fn(async () => {
      remote.listStoredDownloads.mockResolvedValue({ ok: true, value: [] })
      return { ok: true }
    }),
  }
  let Page: React.ComponentType | undefined
  let copy: Record<string, string> = {}
  const dispose: (() => void)[] = []
  const scope = {
    remote: { llamaCpp: remote },
    locale: {
      register(_namespace: string, messages: { en: Record<string, string> }) { copy = messages.en },
      bind() { return (key: string, values: Record<string, string> = {}) => (copy[key] ?? key).replace(/\{(\w+)\}/g, (_, id: string) => values[id] ?? '') },
    },
    inject(_services: string[], activate: (context: unknown) => void) { activate(scope) },
    effect(activate: () => unknown) {
      const cleanup = activate()
      if (typeof cleanup === 'function') dispose.push(cleanup as () => void)
    },
    slots: {
      inject(slot: string, activate: () => void) { if (slot !== 'sidebar.toggle.actions') activate(); return () => {} },
      register(options: { name: string; inject?: () => object }, Component: React.ComponentType<{ t: Translate }>) {
        if (options.name === 'main') Page = () => <Component {...options.inject?.()} t={scope.locale.bind()} />
      },
    },
  }
  const fetchInbox = async (_: string, { signal }: { signal: AbortSignal }) => {
    signal.throwIfAborted()
    const stop = Promise.withResolvers<never>()
    signal.addEventListener('abort', () => stop.reject(signal.reason), { once: true })
    return stop.promise
  }
  runInNewContext(client, { document, AbortController, URL, setTimeout, clearTimeout, fetch: fetchInbox, window: { __ModuleLoader__: {
    load(module: { factory: (require: (id: string) => unknown) => { apply: (ctx: unknown) => void } }) {
      module.factory(id => id === 'react' ? React : id === 'react-dom' ? createRequire(import.meta.url)('react-dom') : primitives).apply(scope)
    },
  } } })
  if (Page === undefined) throw new Error('Downloads did not register a page')
  const view = render(<Page />)
  try {
    const rowDelete = await screen.findByRole('button', { name: 'Delete Example model' })
    expect(remote.deleteStoredDownload).not.toHaveBeenCalled()
    expect(screen.getByText('2.5 KB used')).toBeTruthy()
    fireEvent.click(rowDelete)
    const dialog = within(screen.getByRole('dialog', { name: 'Delete this download?' }))
    expect(dialog.getByText('Delete Example model (2.5 KB) from this computer. You will need to download it again to use it.')).toBeTruthy()
    expect(dialog.getByRole<HTMLButtonElement>('button', { name: /^Delete$/ }).disabled).toBe(true)
    fireEvent.click(dialog.getByText('Keep download', { selector: 'button' }))
    expect(remote.deleteStoredDownload).not.toHaveBeenCalled()
    fireEvent.click(rowDelete)
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('checkbox'))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^Delete$/ }))
    await screen.findByText('Nothing stored on this computer yet.')
    expect(remote.deleteStoredDownload).toHaveBeenCalledExactlyOnceWith(path)
    expect(screen.queryByText('Example model')).toBeNull()
  } finally {
    view.unmount()
    dispose.reverse().forEach((cleanup) => { cleanup() })
  }
})
