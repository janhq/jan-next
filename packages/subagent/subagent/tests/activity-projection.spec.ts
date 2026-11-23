import { Context } from '@janhq/cordis'
import { ToolCallId, createToolResultMessage } from '@janhq/jan-llm'
import SessionStore, { SessionLogOffset } from '@janhq/jan-session'
import type { SessionEvent } from '@janhq/jan-session'
import SessionProjectionRegistry from '@janhq/jan-session-projection'
import { describe, expect, it } from 'vitest'
import { subagentActivityProjectionDefinition } from '../src/activity-projection.ts'
import SubagentRuntime from '../src/index.ts'
import { mountWorkingDirectoryFixture } from './working-directory-fixture.ts'

async function setup() {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await mountWorkingDirectoryFixture(ctx)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SubagentRuntime)
  const parent = ctx.sessions.create()
  const child = ctx.sessions.create(undefined, { meta: { parentSession: parent.id, delegationDepth: 1, origin: 'subagent' } })
  const view = () => ctx.sessionProjections.snapshot(child, ctx.sessionProjections.summaryKeys()).values.subagentActivity
  const descriptor = () => child.append('subagent/descriptor', { mode: 'one-shot', provider: 'local', version: 3, label: 'private assignment' })
  const start = (turn: number) => {
    child.append('turn/start', { turn })
    return child.append('step/start', { turn, step: 1 })
  }
  const call = (name: string, args = '{}', id = name) => child.append('tool/call', {
    turn: 1, step: 1, name, callId: ToolCallId(id), arguments: args,
  })
  const result = (call: SessionEvent<'tool/call'>) => child.append('tool/result', {
    turn: 1, step: 1,
    message: createToolResultMessage({ callId: call.data.callId, content: [{ type: 'text', text: 'private output' }], isError: false }),
  }, { surfaceOp: 'append', sourceEventSeqs: [call.seq] })
  return { child, parent, view, descriptor, start, call, result }
}

describe('subagent activity summary', () => {
  it('publishes timestamped model, tool, parent relay, inbox and settlement stages without their contents', async () => {
    const { child, view, descriptor, start, call, result } = await setup()
    child.append('turn/start', { turn: 1 })
    const created = descriptor()
    expect(view()?.current).toEqual({ kind: 'preparing', at: created.time, seq: created.seq })
    const step = child.append('step/start', { turn: 1, step: 1 })
    expect(view()?.current).toEqual({ kind: 'requesting-model', at: step.time, seq: step.seq })
    const read = call('read', '{"path":"private path"}')
    expect(view()?.current).toEqual({ kind: 'calling-tool', tool: 'read', at: read.time, seq: read.seq })
    const relay = call('send_message', '{"agent":"lead","message":"private question"}')
    expect(view()?.current?.kind).toBe('messaging-parent')
    result(relay)
    expect(view()?.current).toMatchObject({ kind: 'calling-tool', tool: 'read' })
    result(read)
    const wait = call('wait_agent')
    expect(view()?.current?.kind).toBe('waiting-inbox')
    result(wait)
    expect(view()?.current?.kind).not.toBe('waiting-inbox')
    const end = child.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    expect(view()?.current).toEqual({ kind: 'finished', at: end.time, seq: end.seq })
    expect(JSON.stringify(view())).not.toContain('private')

    start(2)
    child.append('turn/end', { turn: 2, reason: { kind: 'error', error: { message: 'private error', code: 'UNKNOWN' } } })
    expect(view()?.current?.kind).toBe('failed')
    start(3)
    child.append('turn/end', { turn: 3, reason: { kind: 'aborted', reason: { kind: 'user' } } })
    expect(view()?.current?.kind).toBe('stopped')
  })

  it('bounds the history and never publishes unsafe tool names, assignments or non-parent recipients', async () => {
    const { child, parent, view, descriptor, start, call, result } = await setup()
    start(1)
    expect(view()).toBeNull()
    descriptor()
    const sibling = call('send_message', '{"agent":"sibling","message":"hello"}')
    expect(view()?.current).toMatchObject({ kind: 'calling-tool', tool: 'send_message' })
    result(sibling)
    const direct = call('send_message', JSON.stringify({ agent: parent.id, message: 'hello' }))
    expect(view()?.current?.kind).toBe('messaging-parent')
    result(direct)
    for (let i = 0; i < 20; i++) result(call(`tool_${i}`))
    const unsafe = call('unsafe\n' + 'x'.repeat(100))
    expect(view()?.current).toMatchObject({ kind: 'calling-tool', tool: null })
    result(unsafe)
    child.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    expect(view()?.recent).toHaveLength(6)
    expect(view()?.recent.at(-1)).toEqual(view()?.current)
    expect(JSON.stringify(view())).not.toMatch(/unsafe|sibling|tool_0|private/)
  })

  it('reports a nested inbox wait, then returns to its still-running outer tool', async () => {
    const { child, view, descriptor, start, call } = await setup()
    descriptor()
    start(1)
    const outer = call('run_code', '{"code":"private program"}')
    const nested = {
      rootCallId: outer.data.callId, parentCallId: outer.data.callId,
      subCallId: ToolCallId('nested-wait'), name: 'wait_agent', arguments: { timeout_ms: 30_000 },
    }
    child.append('tool/ptc-dispatch-start', nested)
    expect(view()?.current?.kind).toBe('waiting-inbox')
    child.append('tool/ptc-dispatch', { ...nested, content: [], isError: false })
    expect(view()?.current).toMatchObject({ kind: 'calling-tool', tool: 'run_code' })
    expect(view()?.recent.at(-1)?.kind).toBe('waiting-inbox')
  })

  it('ignores ancestor events inherited at the fork cut', async () => {
    const { child, descriptor, start } = await setup()
    const inherited = [descriptor(), start(1)]
    const definition = subagentActivityProjectionDefinition
    const initial = definition.init(child.header, SessionLogOffset(3))
    expect(inherited.reduce(definition.apply, initial)).toBe(initial)
    expect(definition.wire.view(initial)).toBeNull()
  })
})
