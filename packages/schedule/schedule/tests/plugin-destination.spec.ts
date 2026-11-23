import { expect, it, vi } from 'vitest'
import type { SchedulePluginDelivery } from '../src/index.ts'
import { harness } from './harness.ts'
import { SessionId } from '@janhq/jan-session'

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
      id: expect.any(String) as unknown, prompt: request.prompt, payload: target.payload }))
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

it('moves a durable inbox to a Session without losing task history or delivering until its inbox is registered', async () => {
  vi.useFakeTimers()
  const initial = await harness({ sessionController: false })
  const sessionId = SessionId('canonical')
  const request = { title: 'Recurring check', prompt: 'Check progress', timing: { kind: 'every', every_seconds: 60 } } as const
  const payload = 'progress/checkpoint.md'
  const legacy = vi.fn<((delivery: SchedulePluginDelivery) => void)>()
  let taskId
  try {
    initial.service.registerDestination('example', legacy)
    const task = await initial.service.createPluginTask(request, { owner: 'example', key: 'legacy', payload })
    taskId = task.id
    await vi.advanceTimersByTimeAsync(60_000)
    await initial.service.retargetPluginTasks('example', sessionId)
    expect(await initial.service.catalog()).toMatchObject([{ id: task.id, target: { kind: 'session', sessionId }, status: 'active' }])
    expect(await initial.service.history({ id: task.id, limit: 2 })).toMatchObject({
      records: [{ messageId: legacy.mock.calls[0]?.[0].id }],
    })
    await initial.service.retargetPluginTasks('example', sessionId)
  } finally { await initial.ctx.fiber.dispose(); vi.useRealTimers() }

  vi.useFakeTimers()
  const restored = await harness({ pool: initial.pool })
  try {
    await vi.advanceTimersByTimeAsync(120_000)
    expect(restored.resolve).not.toHaveBeenCalled()
    const receive = vi.fn<((delivery: SchedulePluginDelivery) => void)>()
    restored.service.registerSessionDestination(sessionId, 'example', receive)
    await vi.advanceTimersByTimeAsync(0)
    expect(receive).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ taskId, payload }))
    const input = { sessionId, key: 'follow-up', payload }
    const followUp = await restored.service.createSessionTask(request, input)
    expect((await restored.service.createSessionTask(request, input)).id).toBe(followUp.id)
    expect(followUp.target).toMatchObject({ kind: 'session', sessionId })
    expect(await restored.service.history({ id: taskId, limit: 2 })).toMatchObject({ records: [
      { messageId: receive.mock.calls[0]?.[0].id, targetSessionId: sessionId }, { messageId: legacy.mock.calls[0]?.[0].id },
    ] })
  } finally { await restored.ctx.fiber.dispose(); vi.useRealTimers() }
})
