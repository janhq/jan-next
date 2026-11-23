/** Let the title request start during its turn but publish its result after turn/end. */
import { EventEmitter, once } from 'node:events'

export const name = 'session-title-stability-order'
export const inject = ['llm', 'sessions']

/**
 * Order two real replay streams without using wall-clock delays.
 * @param {import('@janhq/cordis').Context} ctx - snapshot host context.
 */
export function apply(ctx) {
  let turn
  ctx.on('session/event', (session, event) => {
    if (event.type === 'turn/start') {
      turn = { sessionId: session.id, events: new EventEmitter(), titleStarted: false, closed: false }
    } else if (event.type === 'turn/end' && turn?.sessionId === session.id) {
      turn.closed = true
      turn.events.emit('closed')
    }
  })
  ctx.on('llm/stream', async function* (options, next) {
    const current = turn
    if (current !== undefined && current.sessionId === options.sessionId) {
      if (options.purpose === 'session-title') {
        current.titleStarted = true
        current.events.emit('title-started')
        if (!current.closed) await once(current.events, 'closed', { signal: options.signal })
      } else if (!current.titleStarted) {
        await once(current.events, 'title-started', { signal: options.signal })
      }
    }
    yield* next()
  })
}
