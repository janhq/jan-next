// @vitest-environment jsdom
import { runInNewContext } from 'node:vm'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { janThemeClient } from './jan-theme-client.tsx'

afterEach(() => { cleanup(); localStorage.clear() })

it('pins newly registered third-party rows once and keeps Jan panels and unpinned rows in More', () => {
  const external = { owner: 'example-plugin', options: { id: 'example', label: 'Example plugin' } }
  const builtin = { owner: '@janhq/jan-example', options: { id: 'stock', label: 'Stock panel' } }
  const entries = [builtin]
  const listeners = new Set<() => void>()
  const mount = () => {
    const dispose: (() => void)[] = []
    const components = new Map<string, React.ComponentType<Record<string, unknown>>>()
    const scope = {
      inject(services: string[], callback: (ctx: object) => void) {
        if (services.join() === 'layout,uiWorkspace,workspaces,locale') callback(scope)
      },
      effect(callback: () => (() => void) | undefined) { const stop = callback(); if (stop) dispose.push(stop) },
      provide: vi.fn<(name: string, service: { setLayout: (layout: string) => void }) => void>(),
      slots: {
        inject(name: string, callback: () => void) { if (name.startsWith('sidebar.')) callback() },
        register({ name }: { name: string }, component: React.ComponentType<Record<string, unknown>>) { components.set(name, component) },
        entriesOfSlot: (name: string) => name === 'sidebar.panellist' ? entries : [],
        subscribe(name: string, callback: () => void) {
          if (name === 'sidebar.panellist') listeners.add(callback)
          return () => { listeners.delete(callback) }
        },
      },
      layout: {}, uiWorkspace: {}, workspaces: {}, locale: { bind: () => (key: string) => key },
    }
    runInNewContext(janThemeClient, {
      document, localStorage, window: {
        __ModuleLoader__: {
          load({ factory }: {
            factory: (require: (name: string) => object) => { apply(ctx: typeof scope): void }
          }) {
            factory(name => name === 'react' ? React : name === '@janhq/jan-client-ui-model-selection/client' ? {} : new Proxy({}, {
              get: (_, key) => {
                if (key === 'NavRow') return ({ label }: { label: string }) => <button>{label}</button>
                if (key === 'MenuItemButton') return ({ children, onSelect }: { children: React.ReactNode; onSelect: () => void }) => (
                  <button onClick={onSelect}>{children}</button>
                )
                if (key === 'Checkbox') return ({ label, checked, onChange }: {
                  label: string
                  checked: boolean
                  onChange: (value: boolean) => void
                }) => <input type="checkbox" aria-label={label} checked={checked}
                  onChange={(event) => { onChange(event.currentTarget.checked) }} />
                if (key === 'Modal') return ({ children }: { children: React.ReactNode }) => <div>{children}</div>
                return () => null
              },
            })).apply(scope)
          },
        },
      },
    })
    const [service, api] = scope.provide.mock.calls[0] ?? []
    expect(service).toBe('janSidebar')
    expect(typeof api?.setLayout).toBe('function')
    const Actions = components.get('sidebar.workspaces.actions')!
    const More = components.get('sidebar.panellist.actions')!
    const props = {
      wide: true,
      usePanelInfo: (select: (info: { activePanelId: null }) => unknown) => select({ activePanelId: null }),
      usePluginsAvailable: () => false, useArtifactsAvailable: () => false,
      useScheduledAvailable: () => false, useHubAvailable: () => false, useHostsAvailable: () => false,
      useOtherPanels: () => entries.map(({ options }) => options), renderFactorySlot: () => null,
      t: (key: string) => key, onDismiss: () => { },
    }
    const view = render(<Actions {...props} />)
    return {
      redraw: () => { view.rerender(<Actions {...props} />) },
      more: () => { view.rerender(<More {...props} entries={entries.map(({ options }) => options)} />) },
      edit: () => { view.rerender(<><Actions {...props} /><More {...props} entries={entries.map(({ options }) => options)} /></>); fireEvent.click(screen.getByText('editSidebar')) },
      close: () => { view.unmount(); for (const stop of dispose.reverse()) stop() },
    }
  }
  const view = mount()
  expect(screen.queryByText('Stock panel')).toBeNull()
  act(() => { entries.push(external); for (const listener of listeners) listener() })
  view.redraw()
  expect(screen.getByRole('button', { name: 'Example plugin' })).toBeTruthy()
  view.edit()
  fireEvent.click(screen.getByRole('checkbox', { name: 'Example plugin' }))
  view.close()
  const restored = mount()
  expect(screen.queryByText('Example plugin')).toBeNull()
  restored.more()
  expect(screen.getByText('Example plugin')).toBeTruthy()
  expect(screen.getByText('Stock panel')).toBeTruthy()
  restored.close()
})
