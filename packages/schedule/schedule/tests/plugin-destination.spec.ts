import { expect, it, vi } from 'vitest'
import type { SchedulePluginDelivery } from '../src/index.ts'
import { harness } from './harness.ts'

it('uses the ordinary schedule catalog, pause, delete, recurrence and history for a plugin destination', async () => {
  vi.useFakeTimers()
  const test = await harness({ sessionController: false })
  try {
    const receive = vi.fn(async (_delivery: SchedulePluginDelivery) => {})
    test.service.registerDestination('example', receive)
    const request = { title: 'Recurring background check', prompt: 'Check progress', timing: { kind: 'every', every_seconds: 60 } } as const
    const target = { owner: 'example', key: 'checkpoint-1', payload: 'progress/checkpoint.md' }
    const task = await test.service.createPluginTask(request, target)
    const duplicate = await test.service.createPluginTask(request, target)
    expect(duplicate.id).toBe(task.id)
    expect(await test.service.catalog()).toMatchObject([{ id: task.id, target: { kind: 'plugin', owner: 'example' } }])
    await vi.advanceTimersByTimeAsync(60_000)
    expect(receive).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ taskId: task.id,
      id: expect.any(String), prompt: request.prompt, payload: target.payload }))
    expect(await test.service.history({ id: task.id, limit: 10 })).toMatchObject({ records: [
      { owner: 'example', outcome: 'accepted', messageId: receive.mock.calls[0]?.[0].id },
    ] })
    const history = await test.service.history({ id: task.id, limit: 10 })
    expect('records' in history && history.records[0]).not.toHaveProperty('targetSessionId')
    await test.service.edit({ id: task.id, action: 'update', patch: { active: false } })
    await vi.advanceTimersByTimeAsync(120_000)
    expect(receive).toHaveBeenCalledTimes(1)
    await test.service.edit({ id: task.id, action: 'update', patch: { active: true, prompt: 'Edited' } })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(receive).toHaveBeenLastCalledWith(expect.objectContaining({ prompt: 'Edited' }))
    await test.service.edit({ id: task.id, action: 'delete' })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(receive).toHaveBeenCalledTimes(2)
    expect(await test.service.catalog()).toEqual([])
    expect(test.createSession).not.toHaveBeenCalled()
    expect(test.resolve).not.toHaveBeenCalled()
  } finally {
    await test.ctx.fiber.dispose()
    vi.useRealTimers()
  }
})
