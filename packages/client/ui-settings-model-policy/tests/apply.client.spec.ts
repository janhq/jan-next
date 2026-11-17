import { Context } from '@janhq/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@janhq/jan-client-ui-renderer/client'
import { TestRemote } from '@janhq/jan-client-test-runtime'
import { LocaleRuntime } from '@janhq/jan-client-locale/client'
import { apply as settingsApply, inject as settingsInject } from '@janhq/jan-client-ui-settings/client'
import { apply, inject } from '../src/client/index.ts'

function view(ns: string, revision = 0) {
  return { ns, schema: {}, value: {}, applies: 'live', secrets: [], revision }
}

async function bench(served: string[]) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.provide('locale', new LocaleRuntime(ctx))
  const describe = vi.fn(async () => ({ ok: true as const, value: {
    writable: true, hasDocument: true, namespaces: served.map(ns => view(ns)),
  } }))
  const remote = new TestRemote(ctx, { settings: { describe }, session: { modelCatalog: vi.fn() } })
  await ctx.plugin({ inject: [...settingsInject], apply: settingsApply }).await()
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({ name: 'root', children: { 'settings.models.footer': { kind: 'list', scope: 'root' } } } as never, () => null)
  return { ctx, slots, describe, remote }
}

describe('ui-settings-model-policy apply', () => {
  it('registers each card only when its own namespace is served', async () => {
    const { ctx, slots, describe, remote } = await bench(['model-fallback'])
    await ctx.plugin({ inject: [...inject], apply }).await()
    await vi.waitFor(() => { expect(slots.entries('settings.models.footer').map(entry => entry.options.id)).toEqual(['model-fallback']) })

    describe.mockResolvedValue({ ok: true, value: { writable: true, hasDocument: true, namespaces: [view('compaction-settings', 1)] } })
    remote.emit('settings/document-updated', ['model-fallback', 1])
    await vi.waitFor(() => { expect(slots.entries('settings.models.footer').map(entry => entry.options.id)).toEqual(['compaction-settings']) })
  })

  it('registers neither card when neither namespace is served', async () => {
    const { ctx, slots, describe } = await bench([])
    await ctx.plugin({ inject: [...inject], apply }).await()
    await vi.waitFor(() => { expect(describe).toHaveBeenCalled() })
    expect(slots.entries('settings.models.footer')).toHaveLength(0)
  })
})
