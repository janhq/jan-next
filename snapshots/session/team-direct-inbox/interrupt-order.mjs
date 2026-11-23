/** Let the child claim the relay before interruption, then deliver its settlement. */
import { EventEmitter, once } from 'node:events'

export const name = 'team-direct-inbox-interrupt-order'
export const inject = ['tools', 'subagents']

/**
 * Keep the root in its interrupt tool step until the child's notice is queued.
 * @param {import('@janhq/cordis').Context} ctx - snapshot host context.
 */
export function apply(ctx) {
  const events = new EventEmitter()
  let childClaimedRelay = false
  ctx.on('agent/pre-step', async ({ agent, step, signal }, next) => {
    if (agent.session.header.origin !== 'subagent' || step !== 2) return next()
    const interrupted = once(events, 'dispose', { signal })
    childClaimedRelay = true
    events.emit('child-claimed-relay')
    await interrupted
    return next()
  })
  ctx.effect(() => () => { events.emit('dispose') })
  ctx.on('tools/execute', async (exec, next) => {
    if (exec.name !== 'interrupt_agent' || exec.callId !== 'direct-4') return next()
    const parent = exec.agent
    if (parent === undefined) throw new Error('interrupt fixture requires a parent agent')
    if (!childClaimedRelay) await once(events, 'child-claimed-relay', { signal: exec.signal })
    const result = await next()
    if (!result.isError) await ctx.subagents.waitForTreeWork(parent)
    return result
  })
}
