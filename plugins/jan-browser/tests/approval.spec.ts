import type { ToolExecution, PreToolDecision } from '@janhq/jan-tools'
import { expect, it } from 'vitest'
import { Config, apply } from '../index.mjs'

it('requires approval to read or control Chrome unless the Session has Full access', async () => {
  const session = {}
  const agent = { session }
  let preset = 'custom'
  let decide!: (exec: ToolExecution, next: () => Promise<PreToolDecision>) => Promise<PreToolDecision>
  apply({
    get: (name: string) => name === 'permissionPresets' ? { current: () => preset } : name === 'approval' ? { overrideOf: () => 'never' } : undefined,
    browserUse: { register: () => () => {} },
    tools: { register: () => () => {} },
    effect(body: () => unknown) {
      const result = body()
      if (result && typeof result === 'object' && Symbol.iterator in result) for (const _ of result as Generator<unknown>);
    },
    on(_event: string, listener: typeof decide) { decide = listener; return () => {} },
  } as never, Config({}))

  for (const name of ['browser_extract', 'browser_click']) {
    const beforeExecution = (decision: PreToolDecision) => decide({ name, agent } as ToolExecution, async () => decision)
    preset = 'custom'
    expect(await beforeExecution({ kind: 'allow' })).toMatchObject({ kind: 'ask' })
    preset = 'danger-full-access'
    expect(await beforeExecution({ kind: 'allow' })).toEqual({ kind: 'allow' })
    expect(await beforeExecution({ kind: 'deny', reason: 'denied' })).toEqual({ kind: 'deny', reason: 'denied' })
  }
})
