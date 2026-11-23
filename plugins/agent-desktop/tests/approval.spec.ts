import type { ToolExecution, PreToolDecision } from '@janhq/jan-tools'
import { expect, it } from 'vitest'
import { apply } from '../index.mjs'

it('requires approval for actions and screenshots unless the Session has Full access', async () => {
  const session = {}
  const agent = { session }
  let preset = 'custom'
  let decide!: (exec: ToolExecution, next: () => Promise<PreToolDecision>) => Promise<PreToolDecision>
  apply({
    get: (name: string) => name === 'permissionPresets' ? { current: () => preset } : name === 'approval' ? { overrideOf: () => 'never' } : undefined,
    tools: { register: () => () => {} },
    effect(body: () => Generator<unknown>) { for (const _ of body()); },
    on(_event: string, listener: typeof decide) { decide = listener; return () => {} },
  } as never)

  for (const name of ['desktop_act', 'desktop_screenshot']) {
    const beforeExecution = (decision: PreToolDecision) => decide({ name, agent } as ToolExecution, async () => decision)
    preset = 'custom' // Workspace-write with a delegated `never` policy is not Full access.
    expect(await beforeExecution({ kind: 'allow' })).toMatchObject({ kind: 'ask' })
    preset = 'danger-full-access'
    expect(await beforeExecution({ kind: 'allow' })).toEqual({ kind: 'allow' })
    expect(await beforeExecution({ kind: 'deny', reason: 'denied' })).toEqual({ kind: 'deny', reason: 'denied' })
  }
})
