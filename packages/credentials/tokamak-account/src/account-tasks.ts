/** Account sign-out policy over the latest logged request route. */
import type { Context } from '@janhq/cordis'
import { LlmError } from '@janhq/jan-llm'
import type { Agent } from '@janhq/jan-agent'
import type {} from './account.ts'

/**
 * Identify running work whose latest bound request used the account route.
 * @param agent - live Agent with its durable request context.
 * @param provider - model route that authenticates with the account credential.
 * @returns whether account sign-out should interrupt this task.
 */
export function isRunningAccountTask(agent: Pick<Agent, 'status' | 'session'>, provider: string): boolean {
  return agent.status === 'running' && agent.session.requestContext()?.provider === provider
}

/**
 * Cancel signed-out account tasks and publish sign-in guidance for rejected requests.
 * @param ctx - account provider lifetime; Agents may attach later.
 * @param provider - model route that authenticates with the account credential.
 */
export function installAccountTaskCancellation(ctx: Context, provider: string): void {
  ctx.inject(['agents'], (scope) => {
    scope.on('agent/error', ({ error }) => {
      if (error instanceof LlmError && error.code === 'ACCOUNT_SIGN_IN_REQUIRED') {
        scope.emit('tokamak-account/model-sign-in-required')
      }
    })
    scope.on('tokamak-account/signed-out', () => {
      for (const agent of scope.agents.list()) {
        if (isRunningAccountTask(agent, provider)) {
          agent.cancel({ kind: 'hook', reason: 'tokamak-account/signed-out' }, { keepInbox: true })
        }
      }
    })
  })
}
