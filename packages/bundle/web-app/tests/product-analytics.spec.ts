import OTel from '@janhq/jan-otel'
/** tokamak-harness: product telemetry, analytics, and message ratings stay unmounted on every profile. */
import { createServer } from 'node:http'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { Context } from '@janhq/cordis'
import Loader from '@janhq/cordis-plugin-loader'
import { loadOverlayPatches } from '@janhq/jan-app-boot'
import * as Telemetry from '@janhq/jan-host-product-telemetry-otel'
import Analytics from '@janhq/jan-client-product-analytics'
import { afterEach, expect, it, onTestFinished, vi } from 'vitest'

afterEach(() => { vi.unstubAllEnvs() })

it.each(['desktop', 'web'])('never mounts product telemetry or analytics: %s', async (profile) => {
  const received = Promise.withResolvers<undefined>()
  const server = createServer((req) => { req.resume(); req.once('end', () => { received.resolve(undefined) }) })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  onTestFinished(async () => { const closed = once(server, 'close'); server.close(); server.closeAllConnections(); await closed })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('missing collector address')
  vi.stubEnv('JAN_CLIENT_VERSION', 'test-version')
  vi.stubEnv('JAN_PRODUCT_ANALYTICS_OTLP_URL', `http://127.0.0.1:${address.port}/logs`)
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  ctx.provide('profileContext', {
    name: profile, dir: '/profile', patchPath: '/profile/cordis.patch.yml', installAnchor: '/profile/package.json',
    cwd: '/workspace', home: '/home', startedBundles: [], overlays: [], telemetryDisabledEnv: undefined,
  })
  const identity = vi.fn().mockResolvedValue(undefined)
  ctx.provide('tokamakAccount', { getDeviceIdentity: identity } as never)
  await ctx.plugin(OTel)
  ctx.baseUrl = 'file:///'
  await ctx.plugin(Loader).await()
  ctx.loader.builtins.telemetry = Telemetry
  ctx.loader.builtins.analytics = Analytics
  const rows = loadOverlayPatches('analytics', fileURLToPath(new URL('../cordis.patch.yml', import.meta.url)))
    .flatMap(patch => patch.insert ?? []).filter(row => row.id === 'desktop-product-telemetry' || row.id === 'product-analytics')
  const entries = rows.map(row => ({ ...row, name: row.id === 'desktop-product-telemetry' ? 'cordis:telemetry' : 'cordis:analytics' }))
  await ctx.loader.root.update(entries)
  await ctx.loader.await()
  // tokamak-harness: product telemetry and analytics are never mounted, on any profile.
  expect(ctx.loader.resolve('desktop-product-telemetry').disabled).toBe(true)
  expect(ctx.loader.resolve('product-analytics').disabled).toBe(true)
  expect(ctx.get('productTelemetry')).toBeUndefined()
  expect(ctx.get('productAnalytics')).toBeUndefined()
  // Nothing reaches the collector.
  await new Promise(resolve => setTimeout(resolve, 200))
  let delivered = false
  void received.promise.then(() => { delivered = true })
  await Promise.resolve()
  expect(delivered).toBe(false)
})

it('does not mount the message rating surface', () => {
  const rows = loadOverlayPatches('ratings', fileURLToPath(new URL('../cordis.patch.yml', import.meta.url)))
    .flatMap(patch => patch.insert ?? [])
  expect(rows.find(row => row.id === 'ui-message-feedback')).toMatchObject({
    name: '@deepseek-ai/dsh-client-ui-message-feedback', disabled: true,
  })
})
