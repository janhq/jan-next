// @vitest-environment jsdom
import { act, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, onTestFinished } from 'vitest'
import { SlotTestRuntime } from '@janhq/jan-client-test-runtime'

declare module '@janhq/jan-client-ui-slots' {
  interface SlotMap {
    'spec.owner.list': { kind: 'list'; scope: 'root' }
    'spec.owner.keyed': { kind: 'keyed'; scope: 'root' }
  }
}

afterEach(cleanup)

/** The Loader entry a plugin fiber runs, as the Loader merges it onto the fiber. */
interface EntryFiber {
  entry?: { options: { name: string } }
}

describe('owner markers', () => {
  it('wraps entries of third-party plugins in a layout-neutral marker naming the package, and no others', async () => {
    const runtime = await SlotTestRuntime.create()
    onTestFinished(() => runtime.dispose())
    await runtime.root.declare({
      'spec.owner.list': { kind: 'list', scope: 'root' },
    }, ({ renderSlot }) => renderSlot('spec.owner.list', {}))
    const load = (entry: string, id: string, text: string) => runtime.ctx.plugin({
      inject: ['slots'],
      apply: (ctx) => {
        const fiber: EntryFiber = ctx.fiber
        fiber.entry = { options: { name: entry } }
        ctx.slots.register({ name: 'spec.owner.list', id }, () => <span>{text}</span>)
      },
    })
    await load('dsh-cad/client', 'cad', 'Third-party').await()
    await load('@acme/tools', 'scoped', 'Scoped third-party').await()
    await load('@janhq/jan-client-ui-chat/client', 'chat', 'First-party').await()
    await load('./relative', 'relative', 'Relative').await()
    runtime.slots.register({ name: 'spec.owner.list', id: 'bare' }, () => <span>No entry</span>)
    const view = runtime.renderRoot()
    await act(async () => {})
    const owned = [...view.container.querySelectorAll('[data-plugin-owner]')]
    expect(owned.map(node => node.getAttribute('data-plugin-owner'))).toEqual(['dsh-cad', '@acme/tools'])
    expect(owned.map(node => node.textContent)).toEqual(['Third-party', 'Scoped third-party'])
    expect(owned.every(node => (node as HTMLElement).style.display === 'contents')).toBe(true)
    for (const text of ['First-party', 'Relative', 'No entry']) {
      expect(view.getByText(text).closest('[data-plugin-owner]')).toBeNull()
    }
  })

  it('removes the marker with the entry', async () => {
    const runtime = await SlotTestRuntime.create()
    onTestFinished(() => runtime.dispose())
    await runtime.root.declare({
      'spec.owner.keyed': { kind: 'keyed', scope: 'root' },
    }, ({ renderSlot }) => renderSlot('spec.owner.keyed', {}, { entryKey: 'panel' }))
    let dispose = (): void => {}
    await runtime.ctx.plugin({
      inject: ['slots'],
      apply: (ctx) => {
        const fiber: EntryFiber = ctx.fiber
        fiber.entry = { options: { name: 'dsh-cad' } }
        dispose = ctx.slots.register({ name: 'spec.owner.keyed', key: 'panel' }, () => <span>Panel</span>)
      },
    }).await()
    const view = runtime.renderRoot()
    await act(async () => {})
    const marker = view.container.querySelector('[data-plugin-owner="dsh-cad"]')
    expect(marker?.textContent).toBe('Panel')
    await act(async () => { dispose() })
    expect(view.container.querySelector('[data-plugin-owner]')).toBeNull()
  })
})
