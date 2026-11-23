import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { openQueue } from '../src/queue.ts'
import { deferred } from './fixtures/async.ts'

it('batches source IDs once, holds one slot, and recovers an interrupted batch and a pending receipt', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'superagent-queue-'))
  let now = 1_800_000_000_000
  const started = deferred()
  const received: string[][] = [], sent: string[] = []
  const receipt = { id: 'notice', channel: { source: 'local', thread: 'user', address: {} }, kind: 'reply', text: 'Ready' } as const
  let firstBatch = ''
  let queue = openQueue<string>({ directory, now: () => now, send: async message => { sent.push(message.text); return 'sent' },
    async run(batch, signal) {
      firstBatch = batch.id
      received.push(batch.events.map(event => event.value))
      started.resolve()
      if (signal.aborted) throw signal.reason
      const { promise, reject } = Promise.withResolvers<void>()
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      await promise
      return 'done'
    },
  })
  try {
    expect(queue.enqueue({ id: 'one', value: 'one', readyAt: now + 100 })).toBe(true)
    expect(queue.enqueue({ id: 'two', value: 'two', readyAt: now + 110 })).toBe(true)
    expect(queue.enqueue({ id: 'one', value: 'duplicate', readyAt: now })).toBe(false)
    expect(queue.next()).toBeUndefined()
    await queue.setPaused(false)
    expect(queue.next()).toBe(now + 100)
    now += 100
    await queue.deliver(now)
    await started.promise
    queue.enqueue({ id: 'three', value: 'three', readyAt: now })
    expect(queue.next()).toBeUndefined()
    await queue.setPaused(true)
    expect(queue.send(receipt)).toBe(true)
    await queue.close()
    expect(received).toEqual([['one', 'two']])
    expect(sent).toEqual([])

    queue = openQueue<string>({ directory, now: () => now, send: async message => { sent.push(message.text); return 'sent' },
      async run(batch) {
        if (batch.events[0]?.id === 'one') expect(batch.id).toBe(firstBatch)
        received.push(batch.events.map(event => event.value))
        return 'done'
      },
    })
    expect(queue.enqueue({ id: 'one', value: 'duplicate', readyAt: now })).toBe(false)
    expect(queue.send(receipt)).toBe(false)
    expect(queue.next()).toBeUndefined()
    await queue.setPaused(false)
    await queue.deliver(now)
    await queue.idle()
    await queue.deliver(now)
    await queue.idle()
    expect(received).toEqual([['one', 'two'], ['one', 'two'], ['three']])
    expect(sent).toEqual(['Ready'])
    expect(queue.events().map(event => event.status)).toEqual(['done', 'done', 'done'])
    expect(queue.messages()[0]?.status).toBe('sent')
  } finally { await queue.close(); rmSync(directory, { recursive: true, force: true }) }
})
