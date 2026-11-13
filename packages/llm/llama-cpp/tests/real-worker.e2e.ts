import { mkdtemp, readFile, rm, symlink } from 'node:fs/promises'
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

/** Start the plugin on a fresh data root, import the test GGUF, and wait until it serves. */
async function boot(config: Record<string, unknown> = {}) {
  const home = await mkdtemp(join(tmpdir(), 'llama-real-'))
  cleanups.push(() => rm(home, { recursive: true, force: true }))
  const ctx = new Context()
  await ctx.plugin(LocalSubprocess)
  const credentials = ctx.plugin(LocalCredentialProvider, { path: join(home, 'credentials.yaml'), watch: false })
  await credentials
  const plugin = ctx.plugin(LlamaCpp, { dataRoot: join(home, 'data'), workerPath: worker, ...config })
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
  const stored = await readFile(join(home, 'credentials.yaml'), 'utf8')
  const endpoint = /(http:\/\/127\.0\.0\.1:\d+\/v1)/.exec(stored)?.[1]
  const key = /(llamacpp-[\w-]+)/.exec(stored)?.[1]
  const chat = async (model: string): Promise<{ model?: string; choices?: unknown[] }> => {
    const response = await fetch(`${endpoint}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: 8, messages: [{ role: 'user', content: 'Say hi.' }] }),
    })
    expect(response.status).toBe(200)
    return await response.json() as { model?: string; choices?: unknown[] }
  }
  /** Import the same file again under another id, through a link with another name. */
  const importTwin = async (): Promise<string> => {
    const twin = join(home, 'twin.gguf')
    await symlink(gguf!, twin)
    return await ctx.llamaCpp.importModel(twin)
  }
  return { ctx, home, running, endpoint, until, chat, importTwin }
}

describe.skipIf(worker === undefined || gguf === undefined)('real jan-llama-worker', () => {
  it('loads the generated preset, serves the trained context and a chat completion, and stops through stdin', async () => {
    // Larger than any small test model's trained context, so the preset caps it at the trained one.
    const { ctx, home, running, endpoint, until, chat } = await boot({ ctxSize: 1_048_576, fitCtx: 4096 })
    const trained = running.models[0]?.contextLength
    expect(running).toMatchObject({ phase: 'running', models: [{ active: true }] })
    expect(running.models[0]?.architecture).not.toBe('')
    expect(trained).toBeGreaterThan(0)
    expect(running.contextSize).toBe(trained)
    const preset = await readFile(join(home, 'data', 'run', 'preset.ini'), 'utf8')
    expect(preset).toContain(`ctx-size = ${String(trained)}\n`)
    expect(preset).toContain(`slot-save-path = ${join(home, 'data', 'slots')}\n`)
    expect(preset).toContain(`[local]\nalias-of = ${running.models[0]!.id}\n`)
    const hardware = (await until(state => state.hardware !== undefined)).hardware
    expect(hardware?.memoryBytes).toBeGreaterThan(0)
    expect(ctx.llamaCpp.snapshot().models[0]?.fit).toMatch(/^(fits|tight|too-large)$/)
    expect((await until(state => state.models[0]?.status === 'loaded')).models[0]?.status).toBe('loaded')

    expect((await chat('local')).choices).toHaveLength(1)

    await ctx.llamaCpp.stop()
    expect(ctx.llamaCpp.snapshot().phase).toBe('stopped')
    await expect(fetch(`${endpoint}/models`)).rejects.toThrow()
  }, 180_000)

  it('keeps two models resident, serves each by id and the default by alias, and moves the alias without a reload', async () => {
    const { ctx, running, until, chat, importTwin } = await boot({ ctxSize: 4096, fitCtx: 4096, modelsMax: 2 })
    const first = running.models[0]!.id
    const second = await importTwin()
    expect(second).not.toBe(first)
    expect((await chat(second)).model).toBe(second)
    expect((await chat('local')).model).toBe(first)
    const both = await until(state => state.models.every(model => model.status === 'loaded'))
    expect(both.models.map(model => model.contextSize)).toEqual([4096, 4096])

    await ctx.llamaCpp.setDefault(second)
    expect((await chat('local')).model).toBe(second)
    // Retargeting the alias left both models resident.
    expect(ctx.llamaCpp.snapshot().models.map(model => model.status)).toEqual(['loaded', 'loaded'])

    await ctx.llamaCpp.removeModel(first)
    expect(ctx.llamaCpp.snapshot()).toMatchObject({ phase: 'running', models: [{ id: second, active: true, status: 'loaded' }] })
  }, 240_000)

  it('evicts the least recently used model at a bound of one', async () => {
    const { running, until, chat, importTwin } = await boot({ ctxSize: 4096, fitCtx: 4096 })
    const first = running.models[0]!.id
    const second = await importTwin()
    expect((await chat(second)).model).toBe(second)
    const swapped = await until(state => state.models[0]?.status === 'unloaded' && state.models[1]?.status === 'loaded')
    expect(swapped.phase).toBe('running')
    expect((await chat('local')).model).toBe(first)
    await until(state => state.models[0]?.status === 'loaded' && state.models[1]?.status === 'unloaded')
  }, 240_000)
})
