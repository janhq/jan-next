import { describe, expect, it, vi } from 'vitest'
import { createDownloadStore } from '../src/store.ts'

import type { DownloadStore } from '../src/types.ts'
const row = (store: DownloadStore, id: string) => store.snapshot().items.find(item => item.id === id)

describe('Download inbox store', () => {
  it('weights concurrent byte transfers by size and keeps unknown totals indeterminate', () => {
    const store = createDownloadStore()
    const model = store.start({ id: 'model', kind: 'model', name: 'GGUF', totalBytes: 300 })
    const update = store.start({ id: 'update', kind: 'update', name: 'Jan', totalBytes: 100 })
    model.update({ state: 'downloading', receivedBytes: 150 })
    update.update({ state: 'downloading', receivedBytes: 25 })
    expect(store.snapshot().active).toEqual({ count: 2, percent: 43 })
    const plugin = store.start({ id: 'plugin', kind: 'plugin', name: 'Calendar' })
    expect(store.snapshot().active).toEqual({ count: 3, percent: null })
    plugin.finish('done')
    update.finish('cancelled')
    expect(store.snapshot().active).toEqual({ count: 1, percent: 50 })
    expect(store.snapshot()).toMatchObject({ unseen: { sequence: 1, failed: false } })
  })

  it('retains settlements, acknowledges only observed finishes, and clears only finished rows', async () => {
    const store = createDownloadStore()
    const paused = store.start({ id: 'paused', kind: 'model', name: 'Paused model' })
    paused.update({ state: 'paused' })
    const done = store.start({ id: 'done', kind: 'file', name: 'Report' })
    const failed = store.start({ id: 'failed', kind: 'backend', name: 'Backend' })
    const retry = vi.fn()
    done.finish('done')
    failed.finish('failed', 'Disk full', { retry })
    expect(store.snapshot()).toMatchObject({ active: { count: 0 }, unseen: { sequence: 2, failed: true } })
    store.markSeen(1)
    expect(store.snapshot().unseen).toEqual({ sequence: 2, failed: true })
    expect(row(store, 'failed')).toMatchObject({ state: 'failed', error: 'Disk full', actions: ['retry'] })
    await store.act('failed', 'retry')
    expect(retry).toHaveBeenCalledOnce()
    store.markSeen(2)
    expect(store.snapshot().unseen).toBeNull()
    store.clearFinished()
    expect(store.snapshot().items.map(item => item.id)).toEqual(['paused'])
    await expect(store.act('failed', 'retry')).rejects.toThrow()
  })

  it('ignores superseded reports and smooths cumulative byte rates for the current attempt', () => {
    let time = 0
    const store = createDownloadStore(() => time)
    const before = store.start({ id: 'same', kind: 'voice', name: 'Voice' })
    const after = store.start({ id: 'same', kind: 'voice', name: 'Voice', totalBytes: 1000 })
    before.finish('failed', 'old error')
    after.update({ state: 'downloading', receivedBytes: 0 })
    time = 1000
    after.update({ receivedBytes: 200 })
    time = 2000
    after.update({ receivedBytes: 600 })
    expect(row(store, 'same')).toMatchObject({ state: 'downloading', receivedBytes: 600, bytesPerSecond: 300 })
    after.finish('done')
    after.update({ receivedBytes: 10 })
    expect(row(store, 'same')).toMatchObject({ state: 'done', receivedBytes: 600 })
  })
})
