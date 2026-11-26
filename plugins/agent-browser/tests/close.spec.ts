import type { ToolDefinition } from '@janhq/jan-tools'
import { expect, it, onTestFinished, vi } from 'vitest'
import { runBrowser } from '../cli.mjs'
import { apply } from '../index.mjs'

vi.mock('../cli.mjs', async () => ({ ...await vi.importActual('../cli.mjs'), runBrowser: vi.fn() }))

async function browser() {
  const tools = new Map<string, ToolDefinition>()
  let disposeSession: (() => Promise<void>) | undefined
  const agent = { id: 'browser-session', ctx: { effect(register: () => () => Promise<void>) {
    disposeSession = register()
    return async () => {
      const dispose = disposeSession
      disposeSession = undefined
      await dispose?.()
    }
  } } }
  const effects: (() => void | Promise<void>)[] = []
  const dispose = async () => {
    for (const effect of effects.splice(0).reverse()) await effect()
  }
  onTestFinished(dispose)
  apply({
    agents: { get: () => agent },
    tools: { register(tool: ToolDefinition) { tools.set(tool.name, tool); return () => { tools.delete(tool.name) } } },
    effect(register: () => Generator<() => void | Promise<void>>) { effects.push(...register()) },
    on: () => () => {},
    logger: { warn: vi.fn() },
  } as never)
  vi.mocked(runBrowser).mockReset().mockImplementation(async (_platform, _operation, _command, _browser, signal) => {
    signal.throwIfAborted()
    return { ok: true, data: {} }
  })
  const execute = (name: string, args = {}) => tools.get(name)!.execute(args, { signal: new AbortController().signal, agent } as never)
  await execute('web_open', { url: 'https://example.com' })
  return { dispose, execute }
}

it('closes open browser sessions with a live signal during plugin disposal', async () => {
  const f = await browser()
  let closed = false
  vi.mocked(runBrowser).mockImplementationOnce(async (_platform, operation, _command, _browser, signal) => {
    signal.throwIfAborted()
    closed = operation === 'close'
    return { ok: true, data: {} }
  })
  await f.dispose()
  expect(closed).toBe(true)
})

it('reports a rejected close and retries it at disposal', async () => {
  const f = await browser()
  vi.mocked(runBrowser).mockResolvedValueOnce({ ok: false, error: 'close refused' })
  await expect(f.execute('web_close')).rejects.toMatchObject({ code: 'WEB_COMMAND_FAILED' })
  await f.dispose()
  expect(vi.mocked(runBrowser).mock.calls.map(([, operation]) => operation)).toEqual(['open', 'close', 'close'])
})
