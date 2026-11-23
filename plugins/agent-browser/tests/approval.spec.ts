import type { ToolExecution, PreToolDecision } from '@janhq/jan-tools'
import { expect, it } from 'vitest'
import { apply } from '../index.mjs'

it('asks before navigation, actions and screenshots unless the Session has Full access, and never for reads', async () => {
  const agent = { session: {} }
  let preset = 'custom'
  let decide!: (exec: ToolExecution, next: () => Promise<PreToolDecision>) => Promise<PreToolDecision>
  apply({
    get: (name: string) => name === 'permissionPresets' ? { current: () => preset } : undefined,
    tools: { register: () => () => {} },
    effect(body: () => Generator<unknown>) { for (const _ of body()); },
    on(_event: string, listener: typeof decide) { decide = listener; return () => {} },
  } as never)
  const check = (name: string, decision: PreToolDecision) => decide({ name, agent } as ToolExecution, async () => decision)

  for (const name of ['web_open', 'web_act', 'web_screenshot']) {
    preset = 'custom'
    expect(await check(name, { kind: 'allow' })).toMatchObject({ kind: 'ask' })
    preset = 'danger-full-access'
    expect(await check(name, { kind: 'allow' })).toEqual({ kind: 'allow' })
    expect(await check(name, { kind: 'deny', reason: 'denied' })).toEqual({ kind: 'deny', reason: 'denied' })
  }
  preset = 'custom'
  for (const name of ['web_snapshot', 'web_read', 'web_wait', 'web_tabs', 'web_close']) {
    expect(await check(name, { kind: 'allow' })).toEqual({ kind: 'allow' })
  }
})
