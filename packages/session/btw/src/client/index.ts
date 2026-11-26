import type { Context } from '@janhq/cordis'
import type {} from '@janhq/jan-api-remotes/client'
import type { ISessions } from '@janhq/jan-api-session-controller/client'
import type {} from '@janhq/jan-client-locale/client'
import type {} from '@janhq/jan-client-ui-commands/client'
import type {} from '@janhq/jan-client-ui-conversation/client'
import type {} from '@janhq/jan-client-ui-renderer/client'
import type { SessionId } from '@janhq/jan-session/types'
import remote from '@janhq/jan-btw/remote'
import { SideAnswerPanel, type SideAnswerInjected } from './SideAnswerPanel.tsx'
import { SideAnswerState } from './state.ts'
import { dictionaries, type BtwKey } from './locales.ts'

declare module '@janhq/jan-client-ui-slots' {
  interface LocaleNamespaceMap { btw: BtwKey }
}

/** Client-side services used by the composer contribution. */
export const inject = ['remote', 'slots', 'locale', 'commandUi', 'sessions']

/** Mount one side-question command and its Session-scoped composer dock. */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const unmount = await ctx.remote.$mount(remote)
  const ui = ctx.inject(['remote.btw', ...inject], register)
  try {
    await ui
  } catch (error) {
    await unmount()
    throw error
  }
  return async () => {
    try { await ui.dispose() } finally { await unmount() }
  }
}

function register(ctx: Context): void {
  const sessions = ctx.get('sessions') as ISessions
  const states = new Map<SessionId, SideAnswerState>()
  const stateFor = (id: SessionId): SideAnswerState => {
    const existing = states.get(id)
    if (existing !== undefined) return existing
    const state = new SideAnswerState((question, signal) => ctx.remote.btw.ask(id, question, signal))
    const owner = sessions.scope(id)
    if (owner === undefined) throw new Error('btw: Session scope unavailable')
    states.set(id, state)
    owner.effect(() => () => { state.dismiss(); states.delete(id) }, 'btw: Session panel')
    return state
  }
  ctx.effect(() => () => { for (const state of states.values()) state.dismiss(); states.clear() }, 'btw: panel disposal')
  ctx.effect(() => ctx.locale.register('btw', dictionaries), 'btw: dictionaries')
  const t = ctx.locale.bind('btw')
  ctx.effect(() => ctx.commandUi.register({
    name: 'btw',
    description: () => t('description'),
    available: ({ sessionId }) => sessions.subagentAddress(sessionId) === undefined,
    arguments: {
      inputHint: () => t('hint'),
      complete: () => Promise.resolve([]),
      run: (question, { sessionId }) => {
        if (question === '') throw new Error(t('hint'))
        stateFor(sessionId).start(question)
      },
    },
  }), 'btw: composer command')
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock', id: 'btw', order: 15, locale: 'btw',
    inject: (sessionId): SideAnswerInjected => ({ state: stateFor(sessionId) }),
  }, SideAnswerPanel))
}
