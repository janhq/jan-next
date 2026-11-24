import { createUserMessage } from '@janhq/jan-llm'
import { describe, expect, it } from 'vitest'
import { Context } from '@janhq/cordis'
import { SessionId, type SessionEvent } from '@janhq/jan-session'
import type { Agent } from '@janhq/jan-agent'
import AgentLoop from '@janhq/jan-agent-loop'
import { mountAgentLoopTestDependencies } from '@janhq/jan-agent-loop-testkit'
import * as ToolTodo from '@janhq/jan-tool-todo'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { defineContentToolFixture } from '@janhq/jan-tool-testkit'

/**
 * Full-loop integration: a scripted mock model drives the REAL todo_write tool
 * through the agent loop, exercising the same execution paths a live model would — the
 * tool/call + tool/result session events AND the todo/write event the tool
 * appends. Only the model is mocked; the tool and the session log are real.
 */
async function harness(adapter: MockAdapter, stopReminders = 0): Promise<Context> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(ToolTodo, { allowParallelInProgress: true, stopReminders })
  ctx.llm.registerAdapter(['mock'], adapter)
  return ctx
}

function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') {
        dispose()
        resolve()
      }
    })
  })
}

function findEvent<T extends SessionEvent['type']>(
  log: readonly SessionEvent[],
  type: T,
  position: 'first' | 'last' = 'first',
): Extract<SessionEvent, { type: T }> {
  const found = position === 'first'
    ? log.find(event => event.type === type)
    : log.findLast(event => event.type === type)
  if (!found) throw new Error(`no ${type} event in the session log`)
  return found as Extract<SessionEvent, { type: T }>
}

describe('todo_write tool through the agent loop', () => {
  it('model calls todo_write: a tool/call, a non-error tool/result, and a todo/write snapshot land', async () => {
    const adapter = new MockAdapter([
      toolCallResponse('call-1', 'todo_write', {
        todos: [
          { content: 'read the code', status: 'in_progress' },
          { content: 'write the fix', status: 'pending' },
        ],
      }, 'Planning the work.'),
      textResponse('Plan recorded.'),
    ])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(SessionId('it-todo'), { provider: 'mock', model: 'mock' })

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'plan a two-step task' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    const log = agent.session.snapshotEvents()
    expect(findEvent(log, 'tool/call').data.name).toBe('todo_write')
    expect(findEvent(log, 'tool/result').data.message.isError).toBe(false)

    const todoEvent = findEvent(log, 'todo/write')
    expect(todoEvent.data.todos).toEqual([
      { content: 'read the code', status: 'in_progress' },
      { content: 'write the fix', status: 'pending' },
    ])
  })

  it('a second todo_write replaces the list (last-write-wins on the log)', async () => {
    const adapter = new MockAdapter([
      toolCallResponse('call-1', 'todo_write', { todos: [{ content: 'step one', status: 'in_progress' }] }),
      toolCallResponse('call-2', 'todo_write', {
        todos: [
          { content: 'step one', status: 'completed' },
          { content: 'step two', status: 'in_progress' },
        ],
      }),
      textResponse('Done planning.'),
    ])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(SessionId('it-todo-2'), { provider: 'mock', model: 'mock' })

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'plan then update' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    const todoEvents = agent.session.snapshotEvents().filter(e => e.type === 'todo/write')
    expect(todoEvents).toHaveLength(2)
    expect(findEvent(agent.session.snapshotEvents(), 'todo/write', 'last').data.todos).toEqual([
      { content: 'step one', status: 'completed' },
      { content: 'step two', status: 'in_progress' },
    ])
  })
})

describe('stop reminders', () => {
  const reminders = (agent: Agent): string[] => agent.session.snapshotEvents().flatMap((event) => {
    if (event.type !== 'user/message' || event.data.source.kind !== 'todo-reminder') return []
    return event.data.content.flatMap(block => block.type === 'text' ? [block.text] : [])
  })
  const send = (agent: Agent, text: string): void => {
    agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
  }

  it('steers an early stop back to unfinished todos, at most the configured number of times', async () => {
    const adapter = new MockAdapter([
      toolCallResponse('call-1', 'todo_write', {
        todos: [{ content: 'read the code', status: 'completed' }, { content: 'write the fix', status: 'pending' }],
      }),
      textResponse('Stopping early.'),
      textResponse('Still stopping.'),
      textResponse('Giving up.'),
    ])
    const ctx = await harness(adapter, 2)
    const agent = await ctx.agentLoop.create(SessionId('it-todo-remind'), { provider: 'mock', model: 'mock' })
    send(agent, 'fix it')
    await waitForIdle(ctx, agent)

    const sent = reminders(agent)
    expect(sent).toHaveLength(2)
    expect(sent[0]).toContain('- [pending] write the fix')
    expect(sent[0]).not.toContain('read the code')
    expect(sent[1]).toContain('Reminder 2 of 2.')
    // One model request per scripted response: the budget ends the turn.
    expect(adapter.requests).toHaveLength(4)
    expect(agent.session.snapshotEvents().filter(event => event.type === 'turn/start')).toHaveLength(1)
  })

  it('lets the turn end once every todo is completed', async () => {
    const adapter = new MockAdapter([
      toolCallResponse('call-1', 'todo_write', { todos: [{ content: 'only step', status: 'completed' }] }),
      textResponse('Done.'),
    ])
    const ctx = await harness(adapter, 3)
    const agent = await ctx.agentLoop.create(SessionId('it-todo-done'), { provider: 'mock', model: 'mock' })
    send(agent, 'do it')
    await waitForIdle(ctx, agent)
    expect(reminders(agent)).toEqual([])
    expect(adapter.requests).toHaveLength(2)
  })

  it('never overrides a tool that ends the turn on purpose', async () => {
    const adapter = new MockAdapter([
      toolCallResponse('call-1', 'todo_write', { todos: [{ content: 'wait for answer', status: 'in_progress' }] }),
      toolCallResponse('call-2', 'ask', {}),
    ])
    const ctx = await harness(adapter, 3)
    ctx.tools.register(defineContentToolFixture({
      name: 'ask',
      description: '',
      parameters: {},
      async execute(_args, exec) {
        exec.concludeTurn()
        return [{ type: 'text', text: 'asked' }]
      },
    }))
    const agent = await ctx.agentLoop.create(SessionId('it-todo-ask'), { provider: 'mock', model: 'mock' })
    send(agent, 'ask me')
    await waitForIdle(ctx, agent)
    expect(reminders(agent)).toEqual([])
    expect(adapter.requests).toHaveLength(2)
  })

  it('stays off by default', async () => {
    const adapter = new MockAdapter([
      toolCallResponse('call-1', 'todo_write', { todos: [{ content: 'open step', status: 'pending' }] }),
      textResponse('Stopping.'),
    ])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(SessionId('it-todo-off'), { provider: 'mock', model: 'mock' })
    send(agent, 'go')
    await waitForIdle(ctx, agent)
    expect(reminders(agent)).toEqual([])
  })
})
