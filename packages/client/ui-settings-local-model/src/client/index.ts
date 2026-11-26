/** Browser entry: mount the `llamaCpp` Remote, then the Models card and the first-run option. */
import type { Context } from '@janhq/cordis'
import type {} from '@janhq/jan-api-remotes/client'
import type {} from '@janhq/jan-client-locale/client'
import type {} from '@janhq/jan-client-ui-renderer/client'
import type {} from '@janhq/jan-client-ui-settings-models/client'
import llamaCppRemote from '@janhq/jan-api-llama-cpp-controller/remote'
import { createActions, type LocalModelInjected } from './actions.ts'
import { LocalModelCard } from './LocalModelCard.tsx'
import { LocalSetup } from './LocalSetup.tsx'
import { de, en, es, fr, ja, NS, pt, ru, zh } from './locales.ts'
import { RunningDetail } from './RunningDetail.tsx'
import { observeLocalModel } from './state.ts'

export const inject = ['remote', 'slots', 'locale']

function registerUi(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ja, es, fr, de, ru, pt }), 'local-model: copy dictionaries')
  const mirror = observeLocalModel(ctx)
  ctx.effect(() => mirror.dispose, 'local-model: state stream')
  const injected = (): LocalModelInjected => ({ hooks: { localModel: mirror.store }, actions: createActions(ctx) })
  ctx.slots.inject('settings.models.setup-local', () => ctx.slots.register({
    name: 'settings.models.setup-local', locale: NS, inject: injected,
  }, LocalModelCard))
  ctx.slots.inject('settings.models.local-setup', () => ctx.slots.register({
    name: 'settings.models.local-setup', locale: NS, inject: injected,
  }, LocalSetup))
  ctx.slots.inject('conversation.chat.running-detail', () => ctx.slots.register({
    name: 'conversation.chat.running-detail', id: 'local-model', locale: NS, inject: injected,
  }, RunningDetail))
}

/**
 * Activate the local model UI.
 * @param ctx - Client runtime.
 * @returns disposer for the UI and the Remote contribution.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  // A host that already provides the namespace (a test Remote mock) is used as is.
  const disposeRemote = ctx.get('remote.llamaCpp') === undefined ? await ctx.remote.$mount(llamaCppRemote) : async () => {}
  const ui = ctx.inject(['remote.llamaCpp', 'slots', 'locale'], registerUi)
  try { await ui } catch (error) { await ui.dispose(); await disposeRemote(); throw error }
  return async () => { await ui.dispose(); await disposeRemote() }
}
