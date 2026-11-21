// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import * as primitives from '@janhq/jan-client-ui-primitives'
import type * as ReactAPI from 'react'
import { afterEach, expect, it, vi } from 'vitest'

const React: typeof ReactAPI = createRequire(import.meta.resolve('@testing-library/react'))('react')
const source = readFileSync(join(import.meta.dirname, '../client.js'), 'utf8')

afterEach(() => {
  cleanup()
  document.querySelector('style[data-plugin="@janhq/jan-downloads"]')?.remove()
})

it('reports live download progress on the button and still opens Downloads', async () => {
  type HeaderProps = { t: typeof t; iconSize: number; tooltipSide: string; openPanel: (id: string) => void; useActivity: () => unknown }
  let header!: ReactAPI.ComponentType<HeaderProps>
  let props: { hooks?: Record<string, { subscribe: (fn: () => void) => () => void; getSnapshot: () => unknown }> } = {}
  let copy: Record<string, string>
  const { promise: nextState, resolve: push } = Promise.withResolvers<object>()
  const t = (key: string, values: Record<string, unknown> = {}) => (copy[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => String(values[name]))
  const scope = {
    locale: { register: (_: string, translations: { en: Record<string, string> }) => { copy = translations.en }, bind: () => t },
    effect: (run: () => void) => run(),
    remote: { llamaCpp: { async *follow() { yield await nextState } } },
    slots: {
      inject: (_: string, run: () => void) => run(),
      register: (options: { name: string; inject?: () => typeof props }, component: typeof header) => {
        if (options.name !== 'sidebar.toggle.actions') return
        header = component
        props = options.inject?.() ?? {}
      },
    },
  }
  runInNewContext(source, {
    window: { __ModuleLoader__: { load: ({ factory }: { factory: (require: (id: string) => unknown) => { apply: (ctx: object) => void } }) => {
      const plugin = factory(id => id === 'react' ? React : primitives)
      plugin.apply({ ...scope, inject: (_: string[], apply: (injected: object) => void) => apply(scope) })
    } } },
    setTimeout: () => 0, document, AbortController,
  })
  const openPanel = vi.fn()
  const sourceHook = props.hooks?.activity
  render(React.createElement(header, {
    t, iconSize: 16, tooltipSide: 'bottom', openPanel,
    useActivity: () => sourceHook ? React.useSyncExternalStore(sourceHook.subscribe, sourceHook.getSnapshot) : null,
  }))
  expect(screen.getByRole('button', { name: 'Downloads' })).toBeTruthy()
  await act(async () => push({ downloads: [{ id: 'qwen', progress: { receivedBytes: 5, totalBytes: 20 } }], models: [] }))
  const active = screen.getByRole('button', { name: 'Downloads: 25% downloaded' })
  fireEvent.focus(active)
  expect((await screen.findByRole('tooltip')).textContent).toContain('25% downloaded')
  fireEvent.click(active)
  expect(openPanel).toHaveBeenCalledWith('jan-downloads')
})
