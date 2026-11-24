/** The shipped minimal profile must stop model dispatch when a durable checkpoint fails. */
import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Jan } from '@janhq/jan-sdk-client'
import { MOCK_MODEL_KEY_ENV, MOCK_MODEL_PROVIDER, mockModelRouteRow } from './fixtures/mock-model-route.ts'
import { describe, expect, it, onTestFinished } from 'vitest'

const janBin = fileURLToPath(new URL('../../../lib/bin.js', import.meta.url))
const fixture = fileURLToPath(new URL('./fixtures/checkpoint-failure.mjs', import.meta.url))

describe.skipIf(!existsSync(janBin))('sdk-minimal durability checkpoints', () => {
  it.each([false, true])('checkpoint storage failure with policy disabled=%s', async (disabled) => {
    const root = await mkdtemp(join(tmpdir(), 'jan-sdk-checkpoint-'))
    onTestFinished(async () => { await rm(root, { recursive: true, force: true }) })
    let modelRequests = 0
    const server = createServer((request, response) => {
      request.resume()
      request.on('end', () => {
        modelRequests += 1
        const events = [
          { type: 'message_start', message: { id: 'checkpoint-response', model: 'mock-model', usage: { input_tokens: 3, output_tokens: 0 } } },
          { type: 'content_block_start', index: 0, content_block: { type: 'text', text: 'OK' } },
          { type: 'content_block_stop', index: 0 },
          { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } },
          { type: 'message_stop' },
        ]
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        response.end(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''))
      })
    })
    onTestFinished(async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error)
          else resolve()
        })
      })
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('model server has no TCP address')
    const patch = join(root, 'checkpoint.patch.yml')
    await writeFile(patch, JSON.stringify([
      mockModelRouteRow(`http://127.0.0.1:${address.port}`, ['mock-model']),
      { insert: [{ id: 'checkpoint-failure', name: fixture }] },
      ...disabled ? [{ id: 'session-checkpoint-policy', disabled: true }] : [],
    ]))
    const harness = new Jan({
      janBin, profile: 'sdk-minimal', janHome: join(root, 'home'),
      cwd: root, processCwd: root, patches: [patch], provider: MOCK_MODEL_PROVIDER, model: 'mock-model',
      env: { ...process.env, [MOCK_MODEL_KEY_ENV]: 'keyless-checkpoint-test' },
    })
    onTestFinished(async () => { await harness.close() })
    const result = await harness.run('Reply OK without calling tools.')
    expect(modelRequests).toBe(disabled ? 1 : 0)
    const terminal = result.events.findLast(event => event.type === 'turn/end')
    expect(terminal).toMatchObject({ data: { reason: { kind: disabled ? 'completed' : 'error' } } })
    if (disabled) {
      expect(result.finalResponse).toBe('OK')
    } else {
      expect(terminal).toMatchObject({
        data: { reason: { kind: 'error', error: { message: 'sdk checkpoint persistence unavailable' } } },
      })
    }
  })
})
