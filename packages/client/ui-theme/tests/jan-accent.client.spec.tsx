// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { Context } from '@janhq/cordis'
import { stubConfigForm } from '@janhq/jan-client-test-runtime'
import * as primitives from '@janhq/jan-client-ui-primitives'
import * as React from 'react'
import { expect, it, vi } from 'vitest'
import { ThemeRuntime, type ThemeSettings } from '../src/client/index.ts'

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

const client = readFileSync(resolve(import.meta.dirname, '../../../../plugins/jan-theme/client.js'), 'utf8')

function mountAppearance(theme: ThemeRuntime) {
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
      inject(name, callback) { if (name === 'settings.section') callback() },
      register(options, component) { if (options.id === 'jt-appearance') Component = component },
    },
    locale: { bind: () => key => key, register() { } },
    theme,
  }
  runInNewContext(client, {
    document,
    fetch: vi.fn((_url: string, init: RequestInit) => Promise.resolve(Response.json({ result: JSON.parse(String(init.body)).params }))),
    window: { __ModuleLoader__: { load({ factory }: { factory: (load: (id: string) => object) => { apply(scope: ClientScope): void } }) {
      factory(id => id === 'react' ? React : id === '@janhq/jan-client-ui-primitives' ? primitives : {}).apply(scope)
    } } },
  })
  if (!Component) throw new Error('Jan theme did not register Appearance settings')
  const view = render(<Component />)
  return () => {
    view.unmount()
    for (const stop of dispose.reverse()) stop()
    for (const name of ['--jt-sidebar-light', '--jt-sidebar-dark']) document.documentElement.style.removeProperty(name)
  }
}

it('publishes resting, hover, pressed and checked accent tokens on each Appearance change', async () => {
  const theme = new ThemeRuntime(new Context(), stubConfigForm<ThemeSettings>().scope)
  const dispose = mountAppearance(theme)
  try {
    const swatches = within(screen.getByRole('group', { name: 'Accent color' }))
    const choose = async (color: string) => {
      const swatch = swatches.getByRole('button', { name: color })
      fireEvent.click(swatch)
      await swatches.findByRole('button', { name: color, pressed: true })
      return swatch.style.backgroundColor
    }
    for (const [scheme, first, second] of [['light', 'Purple', 'Gray'], ['dark', 'Cyan', 'Orange']] as const) {
      theme.setTheme(scheme)
      for (const color of [first, second]) {
        const accent = await choose(color)
        expect(accent).not.toBe('')
        const tokens = theme.getTheme().active.tokens
        for (const name of [
          '--dsw-alias-brand-primary', '--dsw-alias-button-primary-fill', '--dsw-alias-button-info-fill',
          '--dsw-alias-state-business-primary', '--dsw-alias-brand-primary-new-colorprimary-new-color',
        ]) {
          const chip = document.createElement('span')
          chip.style.backgroundColor = tokens[name] ?? ''
          expect(chip.style.backgroundColor, name).toBe(accent)
        }
        for (const kind of ['primary', 'info']) {
          const fill = tokens[`--dsw-alias-button-${kind}-fill`]
          const hover = tokens[`--dsw-alias-button-${kind}-hover`]
          const active = tokens[`--dsw-alias-button-${kind}-active`]
          const base = scheme === 'light' ? 'black' : 'white'
          expect(hover).toBe(`color-mix(in oklch, ${fill} 88%, ${base})`)
          expect(active).toBe(`color-mix(in oklch, ${fill} 76%, ${base})`)
        }
      }
    }
  } finally {
    dispose()
  }
})
