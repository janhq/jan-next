import { expect, it, vi } from 'vitest'
import { harness } from './harness.ts'

it('wakes a separate durable timer owner without resolving or creating a Session', async () => {
  vi.useFakeTimers()
  const test = await harness({ sessionController: false })
  try {
    const fired: number[] = []
    let due: number | undefined = Date.now() + 1000
    const source = test.service.registerWakeSource({
      next: () => due,
      deliver(now) { fired.push(now); due = now + 1000 },
    })
    await vi.advanceTimersByTimeAsync(999)
    expect(fired).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(fired).toEqual([Date.now()])
    due = Date.now() + 2000
    source.wake()
    await vi.advanceTimersByTimeAsync(1000)
    expect(fired).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(fired).toHaveLength(2)
    source.dispose()
    await vi.advanceTimersByTimeAsync(1000)
    expect(fired).toHaveLength(2)
    expect(test.createSession).not.toHaveBeenCalled()
    expect(test.resolve).not.toHaveBeenCalled()
  } finally {
    await test.ctx.fiber.dispose()
    vi.useRealTimers()
  }
})
