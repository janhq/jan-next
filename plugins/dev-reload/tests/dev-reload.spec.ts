/** Reload gate policy, continuation and the restart record, against fake Host services. */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CONTINUE_MAX_AGE_MS, CONTINUE_TEXT, createDevReload, RUNNING_CHATS } from '../index.mjs'

interface FakeAgent {
  status: 'idle' | 'running'
  session: { id: string; header: { origin?: 'subagent'; parentSession?: string } }
  idle: PromiseWithResolvers<void>
  whenIdle(): Promise<void>
}

function agent(id: string, status: FakeAgent['status'], header: FakeAgent['session']['header'] = {}): FakeAgent {
  const idle = Promise.withResolvers<void>()
  return { status, session: { id, header }, idle, whenIdle: () => idle.promise }
}

const disposers: (() => void)[] = []
afterEach(() => { for (const dispose of disposers.splice(0).reverse()) dispose() })

function fixture(agents: FakeAgent[], home = mkdtempSync(join(tmpdir(), 'jan-dev-reload-'))) {
  disposers.push(() => { rmSync(home, { recursive: true, force: true }) })
  const listeners = new Map<string, ((...args: unknown[]) => void)[]>()
  let gate: { hold(): string | undefined } | undefined
  let held: { modules: string[]; reason: string } | undefined
  const hmr = {
    get held() { return held },
    setGate: vi.fn((next: typeof gate) => { gate = next; return () => { gate = undefined } }),
    applyHeld: vi.fn(async () => {
      const had = held !== undefined
      held = undefined
      return had
    }),
  }
  const prompt = vi.fn(async (_request: { sessionId: string; mode: string; content: { text: string }[] }, _signal: AbortSignal) => ({ accepted: true }))
  const ctx = {
    hmr,
    agents: { list: () => agents },
    sessionController: { prompt },
    logger: { warn: vi.fn() },
    effect(fn: () => (() => void) | void) { const dispose = fn(); if (dispose) disposers.push(dispose) },
    on(name: string, listener: (...args: unknown[]) => void) { listeners.set(name, [...listeners.get(name) ?? [], listener]) },
  }
  const emit = (name: string, ...args: unknown[]) => { for (const listener of listeners.get(name) ?? []) listener(...args) }
  const hold = (modules = ['file:///repo/plugin.mjs']) => {
    held = { modules, reason: gate?.hold() ?? 'unexpected' }
    emit('hmr/held', held)
  }
  const reload = createDevReload(ctx as never, { home })
  return { reload, hmr, prompt, home, emit, hold, gate: () => gate }
}

describe('dev reload', () => {
  it('holds changes while a chat runs and applies them once when it goes idle', async () => {
    const chat = agent('chat-a', 'running')
    const f = fixture([chat])
    expect(f.gate()?.hold()).toBe(RUNNING_CHATS)
    f.hold()
    expect(f.reload.state()).toEqual({ held: { count: 1, reason: RUNNING_CHATS }, restart: null, running: 1 })
    expect(f.hmr.applyHeld).not.toHaveBeenCalled()

    chat.status = 'idle'
    chat.idle.resolve()
    await vi.waitFor(() => { expect(f.hmr.applyHeld).toHaveBeenCalledOnce() })
    expect(f.gate()?.hold()).toBeUndefined()
    expect(f.reload.state().held).toBeNull()
  })

  it('reloads now and continues exactly the interrupted chats', async () => {
    const f = fixture([
      agent('chat-a', 'running'),
      agent('child', 'running', { origin: 'subagent', parentSession: 'chat-b' }),
      agent('chat-c', 'idle'),
    ])
    f.hold()
    expect(await f.reload.reloadNow()).toEqual({ applied: true, continued: 2 })
    expect(f.prompt.mock.calls.map(([request]) => [request.sessionId, request.mode, request.content[0]?.text]))
      .toEqual([['chat-a', 'queue', CONTINUE_TEXT], ['chat-b', 'queue', CONTINUE_TEXT]])
  })

  it('continues recorded chats on the next start and removes the record', async () => {
    const before = fixture([agent('chat-a', 'running')])
    before.emit('hmr/restart-required', 'external-module', ['file:///repo/host.mjs'])
    expect(before.reload.state().restart).toEqual({ reason: 'external-module' })
    expect(await before.reload.prepareRestart()).toEqual({ continued: 1 })

    const after = fixture([], before.home)
    expect(await after.reload.resume()).toBe(1)
    expect(after.prompt).toHaveBeenCalledOnce()
    expect(after.prompt.mock.calls[0]?.[0].sessionId).toBe('chat-a')
    expect(existsSync(join(before.home, 'dev-reload', 'continue.json'))).toBe(false)
  })

  it('discards a stale record without continuing anything', async () => {
    const f = fixture([])
    mkdirSync(join(f.home, 'dev-reload'), { recursive: true })
    const record = join(f.home, 'dev-reload', 'continue.json')
    writeFileSync(record, JSON.stringify({ sessionIds: ['chat-a'], writtenAt: Date.now() - CONTINUE_MAX_AGE_MS - 1 }))
    expect(await f.reload.resume()).toBe(0)
    expect(f.prompt).not.toHaveBeenCalled()
    expect(existsSync(record)).toBe(false)
  })
})
