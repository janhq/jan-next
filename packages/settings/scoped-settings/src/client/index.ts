/** Browser entry for project defaults and tool switches at each scope. */
import type { Context } from '@janhq/cordis'
import type {} from '@janhq/jan-api-remotes/client'
import type {} from '@janhq/jan-client-locale/client'
import type {} from '@janhq/jan-client-ui-commands/client'
import type {} from '@janhq/jan-client-ui-context-menu/client'
import type {} from '@janhq/jan-client-ui-layout/client'
import type {} from '@janhq/jan-client-ui-renderer/client'
import type {} from '@janhq/jan-client-ui-settings/client'
import type {} from '@janhq/jan-client-ui-workspace/client'
import { createSnapshotStore } from '@janhq/jan-client-store'
import { IconSettingsOutlineRegular } from '@janhq/jan-client-ui-primitives'
import remote from '@janhq/jan-scoped-settings/remote'
import type { ScopedWriteRequest } from '../types.ts'
import { ScopedSettingsOverlay, type ScopedDialogRequest } from './ScopedSettingsDialog.tsx'
import { GlobalToolsRow } from './GlobalToolsRow.tsx'
import { de, en, es, fr, ja, pt, ru, zh, type ScopedSettingsKey } from './locales.ts'

declare module '@janhq/jan-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Project defaults, tool switches and entry point labels. */
    scopedSettings: ScopedSettingsKey
  }
}

const NS = 'scopedSettings'

/** Shared services for the editor; each optional entry point waits only for its own registry. */
export const inject = ['remote', 'slots', 'locale']

/**
 * Mount the generated Remote and the entry points available in this composition.
 * @param ctx - browser plugin lifetime.
 * @returns disposer that withdraws the UI before the Remote.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const unmountRemote = await ctx.remote.$mount(remote)
  const ui = ctx.inject(['remote.scopedSettings', ...inject], registerUi)
  try {
    await ui
  } catch (error) {
    await ui.dispose()
    await unmountRemote()
    throw error
  }
  return async () => {
    await ui.dispose()
    await unmountRemote()
  }
}

function registerUi(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { de, en, es, fr, ja, pt, ru, zh }), 'scoped-settings: dictionaries')
  const request = createSnapshotStore<ScopedDialogRequest | null>(null)
  ctx.effect(() => () => { request.set(null) }, 'scoped-settings: dialog request')
  const open = async (address: ScopedDialogRequest['address']) => {
    const loading = { address, state: { status: 'loading' } } satisfies ScopedDialogRequest
    request.set(loading)
    try {
      const { scope, id } = address
      const session = scope === 'project' ? ctx.get('remote.session') as Context['remote']['session'] | undefined : undefined
      const presets = scope === 'project' ? ctx.get('remote.agentPresets') as Context['remote']['agentPresets'] | undefined : undefined
      const [stored, tools, models, modes] = await Promise.all([
        ctx.remote.scopedSettings.read({ scope, ...id === undefined ? {} : { id } }),
        ctx.remote.scopedSettings.toolCatalog(),
        session?.modelCatalog(),
        presets?.list(),
      ])
      if (request.getSnapshot() !== loading) return
      if (!stored.ok) throw stored.error
      if (!tools.ok) throw tools.error
      if (models?.ok === false) throw models.error
      if (modes?.ok === false && modes.error.code !== 'gateway/invocation-unavailable') throw modes.error
      request.set({ address, state: { status: 'ready', values: stored.value, catalog: tools.value,
        models: models?.value.groups ?? [], modes: modes?.ok ? modes.value.presets : [],
      } })
    } catch (error) {
      if (request.getSnapshot() !== loading) return
      ctx.logger.warn('scoped-settings: could not load settings', error)
      request.set({ address, state: { status: 'failed' } })
    }
  }
  const close = (address: ScopedDialogRequest['address']) => {
    if (request.getSnapshot()?.address === address) request.set(null)
  }
  const write = async (change: ScopedWriteRequest) => {
    const result = await ctx.remote.scopedSettings.write(change)
    if (!result.ok) throw result.error
  }
  const t = ctx.locale.bind(NS)

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'scoped-settings.dialog', locale: NS,
    inject: () => ({ hooks: { request }, write, close, retry: open }),
  }, ScopedSettingsOverlay))
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item', id: 'scoped-settings.tools', order: 18, locale: NS,
    inject: () => ({ open: () => { void open({ scope: 'global' }) } }),
  }, GlobalToolsRow))
  ctx.inject(['contextMenus'], (child) => {
    child.effect(() => child.contextMenus.register({
      id: 'scoped-settings.project', target: 'workspace', order: 60,
      // ScopeAddress.id is not routed by the Hosts plugin; never write a qualified id locally.
      resolve: ({ workspaceId, displayTitle }) => workspaceId.includes('~') ? [] : [{
        id: 'project-settings', label: t('project.settings'),
        run: () => { void open({ scope: 'project', id: workspaceId, title: displayTitle }) },
      }],
    }), 'scoped-settings: project context menu')
  })
  ctx.inject(['commandUi'], (child) => {
    child.effect(() => child.commandUi.register({
      name: 'tools', label: () => t('session.title'), icon: IconSettingsOutlineRegular,
      available: session => !session.sessionId.includes('~'),
      ui: { kind: 'action', run: ({ sessionId }) => { void open({ scope: 'session', id: sessionId }) } },
    }), 'scoped-settings: tools command')
  })
}
