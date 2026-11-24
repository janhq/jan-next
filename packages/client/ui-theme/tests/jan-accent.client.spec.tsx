// @vitest-environment jsdom
import { fireEvent, screen, within } from '@testing-library/react'
import { Context, type Plugin } from '@janhq/cordis'
import { stubConfigForm } from '@janhq/jan-client-test-runtime'
import WebServer from '@janhq/jan-host-webserver'
import Loader from '@janhq/cordis-plugin-loader'
import { expect, it, onTestFinished, vi } from 'vitest'
import { ThemeRuntime, type ThemeSettings } from '../src/client/index.ts'
import { applyIndexInjections } from '../../web/src/apply-injections.ts'
// @ts-expect-error The Jan theme Host half is an untyped `.mjs` plugin; the test only mounts it.
import * as JanThemeHost from '../../../../plugins/jan-theme/index.mjs'
import { mountAppearance } from './jan-theme-client.tsx'

it('restores the saved accent on a fresh desktop boot', async () => {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  const server = new WebServer(ctx, WebServer.Config({ host: '127.0.0.1', port: 0 }))
  for (const name of ['configEditor', 'connection', 'credentials', 'settings', 'skills', 'tools']) {
    ctx.provide(name, {})
  }
  // Mount through the Loader, as a profile does: the plugin reads its entry id and live `appearance` config.
  await ctx.plugin(Loader)
  ctx.loader.builtins['jan-theme-host'] = JanThemeHost as Plugin
  const config = { appearance: { accent: 'orange', coloredUserBubble: false } }
  const id = await ctx.loader.create({ name: 'cordis:jan-theme-host', config })
  await ctx.loader.resolve(id).fiber!.await()

  const peer = { principal: { kind: 'owner' } } as Parameters<WebServer['collectIndexInjections']>[0]
  vi.stubGlobal('__JAN_THEME__', undefined)
  onTestFinished(() => { vi.unstubAllGlobals() })
  await applyIndexInjections(server.collectIndexInjections(peer), async (src) => { throw new Error(`Unexpected boot script: ${src}`) })

  const theme = new ThemeRuntime(new Context(), stubConfigForm<ThemeSettings>().scope)
  onTestFinished(mountAppearance(theme))
  expect(theme.getTheme().active.tokens['--dsw-alias-brand-primary']).toBe('#E9A23F')
  const swatches = within(screen.getByRole('group', { name: 'Accent color' }))
  expect(swatches.getByRole('button', { name: 'Orange', pressed: true })).toBeTruthy()
})

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
