/** Mounts the hand-written Jan theme client half against a real ThemeRuntime. */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { render } from '@testing-library/react'
import * as primitives from '@janhq/jan-client-ui-primitives'
import * as React from 'react'
import { vi } from 'vitest'
import type { ThemeRuntime } from '../src/client/index.ts'

type Component = React.ComponentType

type ClientScope = {
  inject(services: string[], callback: (scope: ClientScope) => void): void
  effect(callback: () => undefined | (() => void)): void
  slots: {
    inject(name: string, callback: () => void): void
    register(options: { id?: string }, component: Component): void
  }
  locale: { bind(): (key: string) => string; register(): void }
  theme: ThemeRuntime
}

/** The plugin's source, also read by the stylesheet contract. */
export const janThemeClient = readFileSync(resolve(import.meta.dirname, '../../../../plugins/jan-theme/client.js'), 'utf8')

/**
 * Run the client half, publish its palette layer and render the General accent row.
 * @param theme - Runtime that receives the plugin's token override.
 * @returns Disposer for the rendered row, the palette layer and the root sidebar tints.
 */
export function mountAppearance(theme: ThemeRuntime): () => void {
  let Component: Component | undefined
  const dispose: (() => void)[] = []
  const scope: ClientScope = {
    inject(services, callback) {
      if (services.every(name => name === 'locale' || name === 'theme')) callback(scope)
    },
    effect(callback) {
      const stop = callback()
      if (stop) dispose.push(stop)
    },
    slots: {
      inject(name, callback) { if (name === 'settings.general.item') callback() },
      register(options, component) { if (options.id === 'jt-accent-color') Component = component },
    },
    locale: { bind: () => key => key, register() { } },
    theme,
  }
  runInNewContext(janThemeClient, {
    document,
    // The appearance API echoes the saved params, as the host does on success.
    fetch: vi.fn((_url: string, init: RequestInit) => {
      const request: unknown = typeof init.body === 'string' ? JSON.parse(init.body) : undefined
      const params = request !== null && typeof request === 'object' && 'params' in request ? request.params : undefined
      return Promise.resolve(Response.json({ result: params }))
    }),
    window: { __JAN_THEME__: Reflect.get(globalThis, '__JAN_THEME__') as unknown, __ModuleLoader__: { load({ factory }: { factory: (load: (id: string) => object) => { apply(scope: ClientScope): void } }) {
      factory(id => id === 'react' ? React : id === '@janhq/jan-client-ui-primitives' ? primitives : {}).apply(scope)
    } } },
  })
  if (!Component) throw new Error('Jan theme did not register the General accent settings')
  const view = render(<Component />)
  return () => {
    view.unmount()
    for (const stop of dispose.reverse()) stop()
    for (const name of ['--jt-sidebar-light', '--jt-sidebar-dark']) document.documentElement.style.removeProperty(name)
  }
}
