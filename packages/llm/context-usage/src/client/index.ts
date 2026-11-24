/** Browser plugin for the `/context` action and its session-scoped composer dock. */
import type { Context } from '@janhq/cordis'
import type {} from '@janhq/jan-api-remotes/client'
import type { ISessions } from '@janhq/jan-api-session-controller/client'
import type {} from '@janhq/jan-client-locale/client'
import type {} from '@janhq/jan-client-ui-commands/client'
import type {} from '@janhq/jan-client-ui-conversation/client'
import type {} from '@janhq/jan-client-ui-renderer/client'
import type { SessionId } from '@janhq/jan-session/types'
import remote from '@janhq/jan-context-usage/remote'
import { ContextPanel, type ContextPanelInjected } from './ContextPanel.tsx'
import { dictionaries } from './locales.ts'
import { ContextPanelState } from './state.ts'

/** Client-side services used to register the command and panel. */
export const inject = ['remote', 'slots', 'locale', 'commandUi', 'sessions']

/**
 * Mount the context breakdown remote and register its command and dock.
 * @param ctx - client plugin context.
 * @returns disposer for the UI and remote registrations.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const unmount = await ctx.remote.$mount(remote)
  const ui = ctx.inject(['remote.contextUsage', ...inject], register)
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
  const panels = new Map<SessionId, { state: ContextPanelState; dispose: () => Promise<void> }>()
  const stateFor = (id: SessionId): ContextPanelState => {
    const existing = panels.get(id)
    if (existing !== undefined) return existing.state
    const owner = sessions.scope(id)
    if (owner === undefined) throw new Error('context-usage: Session scope unavailable')
    const state = new ContextPanelState(async (signal) => {
      const result = await ctx.remote.contextUsage.breakdown(id, signal)
      if (!result.ok) throw result.error
      return result.value
    })
    const dispose = owner.effect(() => () => { state.dismiss(); panels.delete(id) }, 'context-usage: Session panel')
    panels.set(id, { state, dispose })
    return state
  }
  ctx.effect(() => async () => {
    await Promise.all(Array.from(panels.values(), ({ dispose }) => dispose()))
  }, 'context-usage: panel disposal')
  ctx.effect(() => ctx.locale.register('contextUsage', dictionaries), 'context-usage: dictionaries')
  const t = ctx.locale.bind('contextUsage')
  ctx.effect(() => ctx.commandUi.register({
    name: 'context',
    description: () => t('description'),
    available: ({ sessionId }) => sessions.subagentAddress(sessionId) === undefined,
    ui: { kind: 'action', run: ({ sessionId }) => { stateFor(sessionId).refresh() } },
  }), 'context-usage: composer command')
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock', id: 'context-usage', order: 16, locale: 'contextUsage',
    inject: (id): ContextPanelInjected => {
      const { snapshot, refresh, dismiss } = stateFor(id)
      return { hooks: { breakdown: snapshot }, refresh, dismiss }
    },
  }, ContextPanel))
}
