import { Context } from '@janhq/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@janhq/jan-client-ui-renderer/client'
import { TestRemote } from '@janhq/jan-client-test-runtime'
import { LocaleRuntime } from '@janhq/jan-client-locale/client'
import { resolveSlotLabel } from '@janhq/jan-client-ui-slots'
import { apply as settingsApply, inject as settingsInject } from '@janhq/jan-client-ui-settings/client'
import { apply, inject } from '../src/client/index.ts'

function view(ns: string, revision = 0) {
  return { ns, schema: {}, value: {}, applies: 'live', secrets: [], revision }
}

async function bench(served: string[]) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.provide('locale', new LocaleRuntime(ctx, undefined, { languages: ['en'], preference: null }))
  const describe = vi.fn(async () => ({ ok: true as const, value: {
    writable: true, hasDocument: true, namespaces: served.map(ns => view(ns)),
  } }))
  const remote = new TestRemote(ctx, { settings: { describe }, session: { modelCatalog: vi.fn() } })
  await ctx.plugin({ inject: [...settingsInject], apply: settingsApply }).await()
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({ name: 'root', children: {
    'settings.section': { kind: 'list', scope: 'root' },
    'settings.models.footer': { kind: 'list', scope: 'root' },
  } } as never, () => null)
  return { ctx, slots, describe, remote }
}

const items = (slots: SlotRegistry) => slots.entries('settings.agentLoop.item').map(entry => entry.options.id)

describe('ui-settings-model-policy apply', () => {
  it('registers each card only when its own namespace is served', async () => {
    const { ctx, slots, describe, remote } = await bench(['model-fallback'])
    await ctx.plugin({ inject: [...inject], apply }).await()
    await vi.waitFor(() => { expect(items(slots)).toEqual(['model-fallback']) })
    const [section] = slots.entries('settings.section')
    expect(section?.options).toMatchObject({ id: 'agent-loop', order: 12 })
    expect(resolveSlotLabel(section?.options.label)).toBe('Agent loop')
    expect(slots.entries('settings.models.footer')).toHaveLength(0)

    describe.mockResolvedValue({ ok: true, value: { writable: true, hasDocument: true, namespaces: [view('compaction-settings', 1)] } })
    remote.emit('settings/document-updated', ['model-fallback', 1])
    await vi.waitFor(() => { expect(items(slots)).toEqual(['compaction-settings']) })
    expect(slots.entries('settings.section')).toEqual([section])

    describe.mockResolvedValue({ ok: true, value: { writable: true, hasDocument: true, namespaces: [] } })
    remote.emit('settings/document-updated', ['compaction-settings', 2])
    await vi.waitFor(() => { expect(slots.entries('settings.section')).toHaveLength(0) })
  })

  it('orders the cards before the contributed send behavior row', async () => {
    const { ctx, slots, describe, remote } = await bench(['compaction-settings', 'model-fallback', 'ui-conversation'])
    await ctx.plugin({ inject: ['slots'], apply(scope) {
      scope.slots.inject('settings.agentLoop.item', () => scope.slots.register({
        name: 'settings.agentLoop.item', id: 'composer-enter', order: 20,
      }, () => null))
    } }).await()
    await ctx.plugin({ inject: [...inject], apply }).await()
    await vi.waitFor(() => { expect(items(slots)).toEqual(['model-fallback', 'compaction-settings', 'composer-enter']) })

    describe.mockResolvedValue({ ok: true, value: { writable: true, hasDocument: true, namespaces: [view('ui-conversation', 1)] } })
    remote.emit('settings/document-updated', ['compaction-settings', 1])
    await vi.waitFor(() => { expect(items(slots)).toEqual(['composer-enter']) })
    expect(slots.entries('settings.section').map(entry => entry.options.id)).toEqual(['agent-loop'])
  })

  it('omits the section when no related namespace is served', async () => {
    const { ctx, slots, describe } = await bench([])
    await ctx.plugin({ inject: [...inject], apply }).await()
    await vi.waitFor(() => { expect(describe).toHaveBeenCalled() })
    expect(items(slots)).toEqual([])
    expect(slots.entries('settings.section')).toHaveLength(0)
  })
})
