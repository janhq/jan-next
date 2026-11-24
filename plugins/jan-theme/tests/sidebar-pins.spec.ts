// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { expect, it, onTestFinished } from 'vitest'

const client = readFileSync(resolve(import.meta.dirname, '../client.js'), 'utf8')
const pinsKey = 'jan-theme.sidebar.pinned'
const seenKey = 'jan-theme.sidebar.seen'
type Panel = { owner: string; options: { id: string } }
const panel = (id: string): Panel => ({ owner: `example-${id}`, options: { id } })

function mount(storage: Map<string, string>, entries: Panel[]) {
  const startup = Promise.withResolvers<void>()
  let changed = () => {}
  const scope = {
    get: (key: string) => key === 'loader' ? { await: () => startup.promise } : undefined,
    inject(keys: string[], setup: (ctx: unknown) => void) {
      if (keys.join(',') === 'layout,uiWorkspace,workspaces,locale') setup(scope)
    },
    provide() {},
    effect(setup: () => void | (() => void)) { const stop = setup(); if (stop) onTestFinished(stop) },
    slots: {
      inject() {},
      subscribe(name: string, listener: () => void) {
        if (name === 'sidebar.panellist') changed = listener
        return () => {}
      },
      entriesOfSlot: (name: string) => name === 'sidebar.panellist' ? entries : [],
    },
    uiWorkspace: {},
    locale: { bind: () => (key: string) => key },
  }
  runInNewContext(client, {
    document,
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value) },
    },
    window: { __ModuleLoader__: { load({ factory }: { factory: (require: () => object) => { apply(ctx: typeof scope): void } }) { factory(() => ({})).apply(scope) } } },
  })
  return {
    add(id: string) { entries.push(panel(id)); changed() },
    async finishStartup() { startup.resolve(); await startup.promise },
    pins: () => JSON.parse(storage.get(pinsKey) ?? 'null'),
    seen: () => JSON.parse(storage.get(seenKey) ?? 'null'),
  }
}

it('keeps legacy choices for every startup panel, including panels that register late', async () => {
  const storage = new Map([[pinsKey, JSON.stringify(['pinned'])]])
  const sidebar = mount(storage, [panel('pinned'), panel('unpinned')])
  sidebar.add('late-existing')
  await sidebar.finishStartup()

  expect(sidebar.pins()).toEqual(['pinned'])
  expect(sidebar.seen()).toEqual(['pinned', 'unpinned', 'late-existing'])
  sidebar.add('new')
  expect(sidebar.pins()).toEqual(['pinned', 'new'])

  const restarted = mount(storage, [panel('pinned'), panel('unpinned'), panel('late-existing'), panel('new')])
  await restarted.finishStartup()
  expect(restarted.pins()).toEqual(['pinned', 'new'])
})

it('pins third-party panels on a new sidebar without saved choices', async () => {
  const sidebar = mount(new Map(), [panel('new')])
  await sidebar.finishStartup()
  expect(sidebar.pins()).toContain('new')
})
