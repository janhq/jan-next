/** Reload gate: held module replacement through a real Loader and a controlled watcher. */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@janhq/cordis'
import Loader from '@janhq/cordis-plugin-loader'
import Timer from '@janhq/cordis-plugin-timer'
import { FSWatcher, type ChokidarOptions } from 'chokidar'
import { expect, it, onTestFinished, vi } from 'vitest'
import Hmr from '../src/index.ts'

const watchers = vi.hoisted(() => [] as FSWatcher[])
// File notifications are delivered only when a test emits them.
vi.mock('chokidar', async (original) => {
  const actual = await original<typeof import('chokidar')>()
  return { ...actual, watch: (_paths: string | string[], options: ChokidarOptions = {}) => {
    const watcher = new actual.FSWatcher(options)
    watchers.push(watcher)
    queueMicrotask(() => watcher.emit('ready'))
    return watcher
  } }
})

function file(path: string, source: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, source)
}

function plugin(marker: string): string {
  return `export function apply(ctx) {
  ctx.get('gateTrace').push('start:${marker}');
  ctx.effect(() => () => { ctx.get('gateTrace').push('stop:${marker}'); });
}
`
}

async function fixture() {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'jan-hmr-gate-')))
  const ctx = new Context()
  onTestFinished(async () => {
    try { await ctx.fiber.dispose() } finally { rmSync(root, { recursive: true, force: true }) }
  })
  const pkg = join(root, 'plugins', 'addon')
  file(join(pkg, 'package.json'), JSON.stringify({ name: 'addon', type: 'module', exports: './a.mjs' }))
  file(join(pkg, 'a.mjs'), plugin('a'))
  file(join(root, 'app', 'package.json'), '{"type":"module"}')
  mkdirSync(join(root, 'app', 'node_modules'), { recursive: true })
  symlinkSync(pkg, join(root, 'app', 'node_modules', 'addon'), process.platform === 'win32' ? 'junction' : 'dir')
  const trace: string[] = []
  ctx.baseUrl = pathToFileURL(join(root, 'app')).href + '/'
  ctx.provide('gateTrace', trace)
  await ctx.plugin(Loader)
  await ctx.plugin(Timer)
  const start = watchers.length
  await ctx.plugin(Hmr, { root: ['../plugins'], ignored: [], debounce: 0 })
  const watcher = watchers.slice(start).at(-1)!
  ctx.loader.resolve(await ctx.loader.create({ name: 'addon' }))
  await ctx.loader.await()
  const emit = async (path: string) => {
    const dispatch = vi.spyOn(ctx.hmr, 'runExclusive')
    try {
      watcher.emit('change', path)
      await vi.waitFor(() => { expect(dispatch).toHaveBeenCalledOnce() })
      await dispatch.mock.results[0]!.value
    } finally {
      dispatch.mockRestore()
    }
  }
  const edit = async () => {
    file(join(pkg, 'a.mjs'), `${plugin('a')}// edited\n`)
    await emit(join(pkg, 'a.mjs'))
  }
  return { ctx, pkg, trace, emit, edit }
}

it('holds a changed plugin while the gate gives a reason and applies it on request', async () => {
  const f = await fixture()
  let busy: string | undefined = 'running-chats'
  const dispose = f.ctx.hmr.setGate({ hold: () => busy })
  onTestFinished(dispose)
  const held = vi.fn()
  const applied = vi.fn()
  f.ctx.on('hmr/held', held)
  f.ctx.on('hmr/applied', applied)

  await f.edit()
  expect(f.trace).toEqual(['start:a'])
  const url = pathToFileURL(join(f.pkg, 'a.mjs')).href
  expect(held).toHaveBeenCalledWith({ modules: [url], reason: 'running-chats' })
  expect(f.ctx.hmr.held).toEqual({ modules: [url], reason: 'running-chats' })

  busy = undefined
  expect(await f.ctx.hmr.applyHeld()).toBe(true)
  expect(f.trace).toEqual(['start:a', 'stop:a', 'start:a'])
  expect(applied).toHaveBeenCalledWith([url])
  expect(f.ctx.hmr.held).toBeUndefined()
  expect(await f.ctx.hmr.applyHeld()).toBe(false)
})

it('rechecks the gate when an automatic apply reaches the transaction', async () => {
  const f = await fixture()
  let busy: string | undefined = 'running-chats'
  onTestFinished(f.ctx.hmr.setGate({ hold: () => busy }))
  await f.edit()

  const release = Promise.withResolvers<undefined>()
  onTestFinished(() => release.resolve(undefined))
  const transaction = f.ctx.hmr.runExclusive(() => release.promise)
  busy = undefined
  const apply = f.ctx.hmr.applyHeld({ respectGate: true })
  busy = 'running-chats'
  release.resolve(undefined)
  await transaction

  expect(await apply).toBe(false)
  expect(f.trace).toEqual(['start:a'])
  expect(f.ctx.hmr.held?.reason).toBe('running-chats')
  busy = undefined
  expect(await f.ctx.hmr.applyHeld({ respectGate: true })).toBe(true)
  expect(f.trace).toEqual(['start:a', 'stop:a', 'start:a'])
})

it('lets a held listener apply the changes later from its own continuation', async () => {
  const f = await fixture()
  let busy: string | undefined = 'running-chats'
  onTestFinished(f.ctx.hmr.setGate({ hold: () => busy }))
  const idle = Promise.withResolvers<undefined>()
  let applied: Promise<boolean> | undefined
  // Like a gate owner waiting for its chats: the continuation keeps the async context the listener ran in.
  f.ctx.on('hmr/held', () => { applied = idle.promise.then(() => f.ctx.hmr.applyHeld()) })
  await f.edit()
  busy = undefined
  idle.resolve(undefined)
  expect(await applied).toBe(true)
  expect(f.trace).toEqual(['start:a', 'stop:a', 'start:a'])
})

it('applies held changes when the gate is removed', async () => {
  const f = await fixture()
  const dispose = f.ctx.hmr.setGate({ hold: () => 'busy' })
  expect(() => f.ctx.hmr.setGate({ hold: () => undefined })).toThrow('HMR already has a reload gate')
  await f.edit()
  const applied = Promise.withResolvers<unknown>()
  f.ctx.on('hmr/applied', applied.resolve)
  dispose()
  await applied.promise
  expect(f.trace).toEqual(['start:a', 'stop:a', 'start:a'])
})

it('reports an external module change instead of exiting while a gate is set', async () => {
  const f = await fixture()
  const filename = join(f.pkg, 'framework.mjs')
  file(filename, 'export {}')
  const url = pathToFileURL(filename).href;
  (Reflect.get(f.ctx.hmr, 'externals') as Set<string>).add(url)
  const exit = vi.spyOn(f.ctx.loader, 'exit').mockImplementation(() => {})
  onTestFinished(() => { exit.mockRestore() })
  const restart = vi.fn()
  f.ctx.on('hmr/restart-required', restart)
  onTestFinished(f.ctx.hmr.setGate({ hold: () => undefined }))

  await f.emit(filename)
  expect(exit).not.toHaveBeenCalled()
  expect(restart).toHaveBeenCalledWith('external-module', [url])
})
