/** Sign-out impact follows the latest logged provider of running tasks. */
import { Context } from '@janhq/cordis'
import { expect, it } from 'vitest'
import type { Agent } from '@janhq/jan-agent'
import { AccountController } from '../src/index.ts'

it('reports running account requests and excludes idle or unbound tasks', async () => {
  const ctx = new Context()
  const active: Array<Pick<Agent, 'status' | 'session'>> = []
  const task = (status: Agent['status'], provider?: string): Pick<Agent, 'status' | 'session'> => ({
    status, session: { requestContext: () => provider === undefined ? undefined : { provider, model: 'model' } } as Agent['session'],
  })
  ctx.provide('agents', { list: () => active } as Context['agents'])
  ctx.provide('tokamakAccount', { modelProvider: 'tokamak' } as Context['tokamakAccount'])
  const controller = new AccountController(ctx)
  try {
    expect(controller.hasRunningAccountTasks()).toBe(false)
    active.push(task('running'), task('running', 'other'), task('idle', 'tokamak'))
    expect(controller.hasRunningAccountTasks()).toBe(false)
    active.push(task('running', 'tokamak'))
    expect(controller.hasRunningAccountTasks()).toBe(true)
    active.pop()
    expect(controller.hasRunningAccountTasks()).toBe(false)
  } finally { await ctx.fiber.dispose() }
})
