import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import { LocalCredentialProvider } from '@deepseek-ai/dsh-credentials-local'
import { LlamaCpp, type LlamaCppState } from '../src/index.ts'

// Self-skips unless both name real files: the staged worker and a small chat GGUF.
const worker = process.env.JAN_LLAMA_WORKER
const gguf = process.env.JAN_TEST_GGUF

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => { while (cleanups.length) await cleanups.pop()!() })

describe.skipIf(worker === undefined || gguf === undefined)('real jan-llama-worker', () => {
  it('serves a chat completion on the published endpoint and stops through stdin', async () => {
    const home = await mkdtemp(join(tmpdir(), 'llama-real-'))
    cleanups.push(() => rm(home, { recursive: true, force: true }))
    const ctx = new Context()
    await ctx.plugin(LocalSubprocess)
    const credentials = ctx.plugin(LocalCredentialProvider, { path: join(home, 'credentials.yaml'), watch: false })
    await credentials
    const plugin = ctx.plugin(LlamaCpp, { dataRoot: join(home, 'data'), workerPath: worker, ctxSize: 4096, fitCtx: 4096 })
    await plugin
    cleanups.push(async () => { await plugin.dispose(); await credentials.dispose() })
    const watching = new AbortController()
    cleanups.push(async () => { watching.abort() })
    const until = async (predicate: (state: LlamaCppState) => boolean): Promise<LlamaCppState> => {
      for await (const state of ctx.llamaCpp.follow(watching.signal)) if (predicate(state)) return state
      throw new Error('follow ended')
    }

    await until(state => state.phase === 'missing')
    await ctx.llamaCpp.importModel(gguf!)
    const running = await until(state => state.phase === 'running' || state.phase === 'failed')
    expect(running).toMatchObject({ phase: 'running', contextSize: 4096 })

    const stored = await readFile(join(home, 'credentials.yaml'), 'utf8')
    const endpoint = /(http:\/\/127\.0\.0\.1:\d+\/v1)/.exec(stored)?.[1]
    const key = /(llamacpp-[\w-]+)/.exec(stored)?.[1]
    const response = await fetch(`${endpoint}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'local', max_tokens: 8, messages: [{ role: 'user', content: 'Say hi.' }] }),
    })
    expect(response.status).toBe(200)
    const completion = await response.json() as { choices?: unknown[] }
    expect(completion.choices).toHaveLength(1)

    await ctx.llamaCpp.stop()
    expect(ctx.llamaCpp.snapshot().phase).toBe('stopped')
    await expect(fetch(`${endpoint}/models`)).rejects.toThrow()
  }, 180_000)
})
