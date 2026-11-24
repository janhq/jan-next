/** Browser entry for the conversation Agent picker and Settings > Agents. */
import type { Context } from '@janhq/cordis'
import type {} from '@janhq/jan-api-remotes/client'
import type { ISessions } from '@janhq/jan-api-session-controller/client'
import type {} from '@janhq/jan-api-workspace-controller/client'
import type {} from '@janhq/jan-client-locale/client'
import { createSnapshotStore } from '@janhq/jan-client-store'
import type { CommandArgumentOption } from '@janhq/jan-client-ui-commands/client'
import type {} from '@janhq/jan-client-ui-renderer/client'
import type {} from '@janhq/jan-client-ui-settings/client'
import type {} from '@janhq/jan-client-ui-settings-general/client'
import type {} from '@janhq/jan-client-ui-session/client'
import { IconUserOutlineMedium, isDarwinDesktop } from '@janhq/jan-client-ui-primitives'
import type { SessionId } from '@janhq/jan-session/types'
import type {} from '@janhq/jan-scoped-settings/remote'
import remote from '@janhq/jan-agent-profiles/remote'
import { AgentProfilePicker, JAN, type AgentProfilePickerInjected } from './AgentProfilePicker.tsx'
import { AgentProfilesSection, type AgentProfilesSectionInjected } from './AgentProfilesSection.tsx'
import { de, en, es, fr, ja, pt, ru, zh, type AgentProfilesKey } from './locales.ts'
import type { AgentProfileList } from '../types.ts'
import type { WorkspaceId } from '@janhq/jan-workspace/types'

const NS = 'agentProfiles'
const SECTION = 'agents'

declare module '@janhq/jan-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Agent picker and Settings > Agents copy. */
    agentProfiles: AgentProfilesKey
  }
}

/** Dependencies needed to mount the Remote and register the UI. */
export const inject = ['remote', 'locale', 'slots']

/**
 * Mount the generated Agent Profiles Remote before registering browser contributions.
 * @param ctx - browser plugin context.
 * @returns a disposer that withdraws the UI before its Remote.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const unmountRemote = await ctx.remote.$mount(remote)
  const ui = ctx.inject(['remote.agentProfiles', 'remote.session', ...inject], registerUi)
  try {
    await ui
  } catch (error) {
    await unmountRemote()
    throw error
  }
  return async () => {
    try { await ui.dispose() } finally { await unmountRemote() }
  }
}

function registerUi(ctx: Context): void {
  const profileRevision = createSnapshotStore(0)
  const invalidate = () => { profileRevision.set(profileRevision.getSnapshot() + 1) }
  ctx.effect(() => ctx.remote.$on('agent-profiles/changed', invalidate), 'agent-profiles: catalog changes')
  ctx.on('connection/reset', invalidate)
  ctx.effect(() => ctx.locale.register(NS, { de, en, es, fr, ja, pt, ru, zh }), 'agent-profiles: dictionaries')
  const t = ctx.locale.bind(NS)
  const picker: AgentProfilePickerInjected = {
    hooks: { profileRevision },
    list: async (request) => {
      const result = await ctx.remote.agentProfiles.list(request)
      if (!result.ok) throw result.error
      return result.value
    },
    select: async (request) => {
      const result = await ctx.remote.agentProfiles.select(request)
      if (result.ok) return undefined
      if (result.error.code === 'agent-profiles/locked') return 'locked'
      throw result.error
    },
    manage: () => {
      if (ctx.get('settingsNavigation')?.open(SECTION) !== true) throw new Error('Agents settings section unavailable')
    },
  }
  ctx.inject(['commandUi', 'sessions', 'workspaces'], (scope) => {
    const sessions = scope.get('sessions') as unknown as Pick<ISessions, 'subagentAddress'>
    const catalogs = new Map<WorkspaceId | undefined, Promise<AgentProfileList>>()
    const options = async (sessionId: SessionId): Promise<CommandArgumentOption[]> => {
      const project = scope.workspaces.list.getSnapshot().items.find(workspace => workspace.sessionIds.includes(sessionId))
      const workspaceId = project?.workspaceId
      let load = catalogs.get(workspaceId)
      if (load === undefined) {
        const pending = picker.list(workspaceId === undefined ? {} : { workspaceId }).catch((error: unknown) => {
          if (catalogs.get(workspaceId) === pending) catalogs.delete(workspaceId)
          scope.logger.warn('agent-profiles: could not load /agent choices', error)
          throw new Error(t('listError'))
        })
        catalogs.set(workspaceId, pending)
        load = pending
      }
      const profiles = (await load).profiles
        .filter(profile => profile.use !== 'subagent' && profile.shadowedBy === undefined)
        .map(profile => ({
          value: profile.id, label: profile.id,
          ...(profile.description === '' ? {} : { description: profile.description }),
          group: t(`group.${profile.scope}`),
        }))
      return [{ value: JAN, label: t('noAgent') }, ...profiles]
    }
    const select = async (sessionId: SessionId, id: string | null): Promise<void> => {
      let result: 'locked' | undefined
      try {
        result = await picker.select({ sessionId, id })
      } catch (error) {
        scope.logger.warn('agent-profiles: could not select /agent choice', error)
        throw new Error(t('selectError'))
      }
      if (result === 'locked') throw new Error(t('locked'))
    }
    scope.effect(() => profileRevision.subscribe(() => { catalogs.clear() }), 'agent-profiles: invalidate command choices')
    scope.effect(() => scope.commandUi.register({
      name: 'agent',
      label: () => t('command.label'),
      description: () => t('command.description'),
      icon: IconUserOutlineMedium,
      available: ({ sessionId }) => sessions.subagentAddress(sessionId) === undefined,
      arguments: {
        complete: (_query, { sessionId }) => options(sessionId),
        run: (id, { sessionId }) => select(sessionId, id === JAN ? null : id),
      },
      ui: {
        kind: 'popupSelect',
        options: async ({ sessionId }) => (await options(sessionId)).map(({ value, label, description, group }) => ({
          id: value, label,
          ...(description === undefined ? {} : { detail: description }),
          ...(group === undefined ? {} : { group: { name: group, label: group } }),
        })),
        onSelect: ({ id }, { sessionId }) => select(sessionId, id === JAN ? null : id),
      },
    }), 'agent-profiles: /agent contribution')
  })
  const settings: AgentProfilesSectionInjected = {
    list: picker.list,
    hooks: picker.hooks,
    get: async (request) => {
      const result = await ctx.remote.agentProfiles.get(request)
      if (!result.ok) throw result.error
      return result.value
    },
    save: async (request) => {
      const result = await ctx.remote.agentProfiles.save(request)
      if (!result.ok) throw result.error
    },
    remove: async (request) => {
      const result = await ctx.remote.agentProfiles.deleteProfile(request)
      if (!result.ok) throw result.error
    },
    models: async () => {
      const result = await ctx.remote.session.modelCatalog()
      if (!result.ok) throw result.error
      return result.value.groups
    },
    tools: async () => {
      const service = ctx.get('remote.scopedSettings') as Context['remote']['scopedSettings'] | undefined
      const result = await service?.toolCatalog()
      if (result === undefined) return []
      if (!result.ok) throw result.error
      return [...result.value.tools, ...result.value.mcpServers.map(name => `mcp:${name}`)]
    },
    fileManager: async () => {
      const result = await ctx.remote.session.canOpenWorkspacePath()
      if (!result.ok || !result.value) return undefined
      return isDarwinDesktop() ? 'finder' : 'folder'
    },
    reveal: async (path) => {
      const result = await ctx.remote.session.openWorkspacePath({ path, action: 'reveal' })
      if (!result.ok) throw result.error
    },
  }
  ctx.slots.inject('conversation.hero.agentProfile', () => ctx.slots.register({
    name: 'conversation.hero.agentProfile', locale: NS, inject: () => picker,
  }, AgentProfilePicker))
  ctx.slots.inject('conversation.composer.agentProfile', () => ctx.slots.register({
    name: 'conversation.composer.agentProfile', locale: NS, inject: () => picker,
  }, AgentProfilePicker))
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: SECTION, order: 21, label: () => t('nav'), locale: NS, inject: () => settings,
  }, AgentProfilesSection))
  ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
    name: 'settings.section.icon', id: SECTION,
  }, IconUserOutlineMedium))
}
