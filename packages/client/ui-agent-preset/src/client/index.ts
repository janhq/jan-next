/**
 * Agent-preset surface plugin, browser half — three surfaces over one roster:
 * a chip on the new-session screen for the session about to start, the same
 * chip under a started session's composer, and a settings section that lists
 * the roster (selection, the new-task default, a read-only view of each
 * declared composition, and the way into Creator mode).
 *
 * A started session keeps every message it already has; a switch there
 * applies from its next turn, and the Host accepts it only at a turn boundary.
 * That is what splits the two chips: the hero chip stages a choice before the
 * session exists, while the composer chip commits one for a session that
 * already runs. The default preset is edited where the roster is visible —
 * the settings section's "make default" — so General settings carries no
 * duplicate control for the same field.
 *
 * Coding Tools (General settings) hide PTC and Minimal from the hero menu
 * and Settings roster when off. Hidden saved defaults fall back to Standard;
 * the existing gate clears staged choices while existing sessions keep their composition.
 */

// Type-only: pulls the Session Controller service merge (ctx.sessions).
import type { SessionBinding } from '@janhq/jan-api-session-controller/client'
import type { SessionId } from '@janhq/jan-session/types'
import { createSnapshotStore } from '@janhq/jan-client-store'
import { WeakMapWithValues } from '@janhq/jan-util-values'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@janhq/jan-client-locale/client'
// Type-only: pulls the ctx.remote merge and the forwarded-event key face
// (the settings invalidation rides the allowlist) into this program.
import type {} from '@janhq/jan-api-remotes/client'
// Type-only: pulls the settings shell's SlotMap merge (the 'settings.section' entry).
import type {} from '@janhq/jan-client-ui-settings/client'
import type {} from '@janhq/jan-client-ui-renderer/client'
// Type-only: pulls the Workspace UI navigation service merge (ctx.uiWorkspace).
import type {} from '@janhq/jan-client-ui-workspace/client'
import type {} from '@janhq/jan-client-ui-plugin-manager/client'
import type { Context as ClientContext } from '@janhq/cordis'
import { AgentPresetLabel } from './AgentPresetLabel.tsx'
import { CreatePluginMenuItem } from './CreatePluginMenuItem.tsx'
import type { AgentPresetLabelInjected } from './AgentPresetLabel.tsx'
import { AgentPresetSeat } from './AgentPresetSeat.tsx'
import type { AgentPresetSeatInjected } from './AgentPresetSeat.tsx'
import { AgentPresetSection } from './AgentPresetSection.tsx'
import type { AgentPresetSectionInjected } from './AgentPresetSection.tsx'
import { AgentPresetSeatController, type AgentPresetStage } from './seat-store.ts'
import { AgentPresetSectionController } from './section-store.ts'
import { en, ja, es, fr, de, ru, pt, zh, type AgentPresetSettingsKey } from './locales.ts'
import { AGENT_PRESET_SETTINGS_NS, AgentPresetSettingsController } from './settings-store.ts'
import { analyticsMode } from './analytics.ts'
// Type-only: pulls the custom-editor seat declaration into this registration.
import type {} from './slot-contract.ts'

declare module '@janhq/jan-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Agent-preset surface copy. */
    'settings.agentPreset': AgentPresetSettingsKey
  }
}

export type { AgentPresetLabelInjected, AgentPresetLabelProps } from './AgentPresetLabel.tsx'
export type { AgentPresetSeatInjected, AgentPresetSeatProps } from './AgentPresetSeat.tsx'
export type { AgentPresetSectionInjected, AgentPresetSectionProps } from './AgentPresetSection.tsx'
export type { AgentPresetSeatState } from './seat-store.ts'
export type { AgentPresetSectionState, PresetView } from './section-store.ts'
export type { AgentPresetOption, AgentPresetSettingsState } from './settings-store.ts'
export { AGENT_PRESET_SETTINGS_NS, writeDefaultPreset } from './settings-store.ts'

/** A mode that owns its entry flow instead of composing a capability preset. */
export interface AgentPresetModeAction {
  readonly id: string
  name(): string
  description(): string
  run(sessionId: SessionId | undefined): void
}

declare module '@janhq/cordis' {
  interface Context {
    uiAgentPreset: { registerModeAction(action: AgentPresetModeAction): () => void }
  }
}

/** Required services (cordis fiber inject). */
export const inject = [
  'slots', 'sessions', 'locale', 'remote', 'remote.agentPresets', 'remote.settings', 'configForms',
]

/**
 * Mount the roster surfaces: hero chip, composer chip, settings section.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  const toolsSettings = ctx.configForms.get<{ enabled: boolean }>('ui-settings')
  const presetSettings = ctx.configForms.get(AGENT_PRESET_SETTINGS_NS)
  let active = true
  // Host preferences start at false before their first accepted document.
  const codingToolsDisabled = (): boolean => active && toolsSettings.getSnapshot().value?.enabled === false
  const controller = new AgentPresetSettingsController(ctx)
  const staged: AgentPresetStage = { id: undefined, introduce: false }
  const modeActions = createSnapshotStore<readonly AgentPresetModeAction[]>([])
  ctx.provide('uiAgentPreset', {
    registerModeAction(action) {
      const current = modeActions.getSnapshot()
      if (current.some(entry => entry.id === action.id)) throw new Error(`Duplicate agent preset action: ${action.id}`)
      modeActions.set([...current, action])
      return () => { modeActions.set(modeActions.getSnapshot().filter(entry => entry !== action)) }
    },
  })
  const seats = new WeakMapWithValues<SessionBinding, AgentPresetSeatController>()
  const boundSeatDisposers = new Set<() => Promise<void>>()
  ctx.effect(() => async () => {
    await Promise.all([...boundSeatDisposers].map(dispose => dispose()))
  }, 'ui-agent-preset: bound selections')
  const unboundSeat = new AgentPresetSeatController(ctx, () => undefined, staged)
  const seatFor = (binding: SessionBinding): AgentPresetSeatController => {
    const existing = seats.get(binding)
    if (existing !== undefined) return existing
    const seat = new AgentPresetSeatController(ctx, () => {
      if (ctx.sessions.binding(binding.sessionId) !== binding) return undefined
      const summary = ctx.sessions.list.getSnapshot().byId[binding.sessionId]
      return summary !== undefined
        && (ctx.sessions.retainInfo(binding.sessionId).getSnapshot().retainedBy.mainView ?? 0) > 0
        ? summary
        : undefined
    }, staged)
    seats.set(binding, seat)
    const dispose = binding.ctx.effect(() => {
      const stop = ctx.sessions.list.subscribe(() => { void seat.apply() })
      return () => {
        stop()
        seats.delete(binding)
        boundSeatDisposers.delete(dispose)
      }
    }, 'ui-agent-preset: Provider binding')
    boundSeatDisposers.add(dispose)
    return seat
  }
  const section = new AgentPresetSectionController(ctx)
  // Turning Developer tools off clears the shared stage before any apply can compose it.
  const developerTools = ctx.configForms.developerTools.enabled
  ctx.effect(() => developerTools.subscribe(() => {
    if (developerTools.getSnapshot()) return
    staged.id = undefined
    staged.introduce = false
    void unboundSeat.apply()
    for (const seat of seats.values) void seat.apply()
  }), 'ui-agent-preset: Developer tools gate')
  const mainBlank = () => Object.values(ctx.sessions.list.getSnapshot().byId)
    .find((session) => {
      /* v8 ignore next -- retained source counts omit zero-valued entries. */
      return session.blank && (session.retainedBy.mainView ?? 0) > 0
    })
  const mainBlankSeat = (): AgentPresetSeatController | undefined => {
    const summary = mainBlank()
    const binding = summary === undefined ? undefined : ctx.sessions.binding(summary.id)
    return binding === undefined ? undefined : seatFor(binding)
  }

  ctx.effect(() => ctx.locale.register('settings.agentPreset', { zh, en, ja, es, fr, de, ru, pt }), 'ui-agent-preset: settings row dictionaries')

  ctx.effect(() => {
    let requested = 0
    let pending: Promise<void> | undefined
    // Settings invalidations may land while a correction is waiting on a
    // person's selection. Recheck once that work settles using the latest values.
    const reconcile = (): void => {
      requested++
      pending ??= Promise.resolve().then(async () => {
        try {
          for (;;) {
            const revision = requested
            await section.reconcileCodingTools(codingToolsDisabled)
            if (!active || requested === revision) return
          }
        } finally { pending = undefined }
      })
    }
    // The roster reflects live declarations and the default is a settings field, so
    // both an external settings edit and a reconnect can move this row.
    const refresh = (): void => {
      void controller.load()
      // The section reads the same roster and marks the same default, so a
      // change made from either surface converges both.
      if (section.store.getSnapshot().status !== 'idle') void section.load()
      void unboundSeat.load()
      for (const seat of seats.values) void seat.load()
      reconcile()
    }
    const disposers = [
      toolsSettings.subscribe(reconcile),
      presetSettings.subscribe(reconcile),
      ctx.remote.$on('settings/document-updated', (ns) => {
        if (ns !== AGENT_PRESET_SETTINGS_NS) return
        refresh()
      }),
      ctx.on('connection/reset', refresh),
    ]
    reconcile()
    return async () => {
      active = false
      for (const dispose of disposers) dispose()
      await pending
    }
  }, 'ui-agent-preset: settings refresh')

  // The settings section's conversational authoring entry: stage the
  // self-referential preset and land a new session on it. Bound inside the
  // conversation scope below (the seat and the session flow live there) and
  // unbound with it, so the section's face reads the current binding per
  // render and simply hides the button while no flow exists.
  let creatorDraft: (() => void) | undefined
  ctx.inject(['slots', 'conversation', 'sessions', 'uiWorkspace'], (scope: ClientContext) => {
    const seatInjected = (sessionId: SessionId | undefined): AgentPresetSeatInjected => {
      const binding = sessionId === undefined ? undefined : ctx.sessions.binding(sessionId)
      const seat = binding === undefined ? unboundSeat : seatFor(binding)
      return {
        hooks: { agentPresetSeat: seat.store, developerTools: ctx.configForms.developerTools.enabled, modeActions },
        load: () => seat.load(),
        select: async (id: string) => {
          const state = seat.store.getSnapshot()
          const from = analyticsMode(state.current)
          const to = analyticsMode(id)
          const enabled = toolsSettings.getSnapshot().value?.enabled
          const outcome = await seat.select(id)
          // A bound pick counts once the Host applies it; an unbound pick counts when staged for the next Session.
          const accepted = outcome.kind === 'applied' || (outcome.kind === 'staged' && sessionId === undefined)
          // The last picked mode becomes the default for the next new chat. The section serializes
          // this write with the Coding Tools reset, so turning tools off still lands on Standard.
          if (accepted && id !== state.current) void section.makeDefault(id)
          if (accepted && from !== undefined && to !== undefined && to !== 'other' && from !== to && enabled !== undefined) {
            ctx.get('productAnalytics')?.track('agent_preset_switch', {
              switch_from: from, switch_to: to, code_work_view_enabled: enabled,
            })
          }
          return outcome.kind === 'refused' ? outcome.reason : undefined
        },
        dismissRefusal: (error) => { seat.dismissRefusal(error) },
        introduced: () => { seat.introduced() },
      }
    }

    const labelInjected = (): AgentPresetLabelInjected => ({
      hooks: {
        agentPresets: controller.store,
        developerTools: ctx.configForms.developerTools.enabled,
        modeActions,
      },
      load: () => controller.load(),
      select: async (sessionId, id) => {
        try {
          const result = await ctx.remote.agentPresets.select(sessionId, id)
          if (result.ok) return undefined
          const { error } = result
          // Prefer the bare cause; the banner already names the rejected preset.
          return 'reason' in error.details && typeof error.details.reason === 'string'
            ? error.details.reason
            : error.message
        } catch (error) {
          return error instanceof Error ? error.message : String(error)
        }
      },
    })

    const startCreatorDraft = () => {
      // The Host composes the reused draft or new Session; the stage only drives the chip's display and introduction.
      // Navigation opens another blank when the main blank lists a different preset, so that blank is not staged.
      const listed = mainBlank()?.projectionValues?.agentPreset
      if (typeof listed !== 'string' || listed === 'cordis') (mainBlankSeat() ?? unboundSeat).stage('cordis', true)
      scope.uiWorkspace.startSession(undefined, { clearPreviousDraft: false, agentPreset: 'cordis' })
    }

    scope.effect(() => {
      creatorDraft = startCreatorDraft
      const chip = scope.slots.register({
        name: 'conversation.hero.agentPreset',
        locale: 'settings.agentPreset',
        inject: seatInjected,
      }, AgentPresetSeat)
      const label = scope.slots.register({
        name: 'conversation.composer.agentPreset',
        locale: 'settings.agentPreset',
        inject: labelInjected,
      }, AgentPresetLabel)
      return () => {
        creatorDraft = undefined
        chip()
        label()
      }
    }, 'ui-agent-preset: new-session and composer chips')

    scope.slots.inject('plugins.add.actions', () => scope.slots.register({
      name: 'plugins.add.actions',
      id: 'create-plugin',
      locale: 'settings.agentPreset',
      inject: () => ({
        hooks: { agentPresets: controller.store },
        load: () => controller.load(),
        startCreatorDraft,
      }),
    }, CreatePluginMenuItem))
  })

  /** Capture the exact blank Session one Settings action may update. */
  const captureBlankSessionSync = (): ((id: string) => Promise<string | undefined>) => {
    const summary = Object.values(ctx.sessions.list.getSnapshot().byId)
      .find(session => session.blank && (session.retainedBy.mainView ?? 0) > 0)
    const binding = summary === undefined ? undefined : ctx.sessions.binding(summary.id)
    const seat = binding === undefined ? undefined : seatFor(binding)
    const sessionId = seat?.blankSessionId()
    return async (id: string) => {
      if (seat === undefined || sessionId === undefined || binding === undefined
        || seats.get(binding) !== seat) return undefined
      return await seat.syncBlankSession(sessionId, id)
    }
  }

  const sectionInjected = (): AgentPresetSectionInjected => ({
    hooks: { agentPresetSection: section.store, developerTools: ctx.configForms.developerTools.enabled },
    load: () => section.load(),
    view: (id: string) => section.view(id),
    closeView: () => { section.closeView() },
    ...creatorDraft === undefined ? {} : { startCreatorDraft: creatorDraft },
    makeDefault: (id: string) => section.makeDefault(id, captureBlankSessionSync()),
  })

  // Ordered after Models: choosing a model is routine, and composing an
  // agent is the deployment-shaping act behind it.
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'agent-presets',
    order: 20,
    label: () => ctx.locale.bind('settings.agentPreset')('nav'),
    locale: 'settings.agentPreset',
    children: { 'settings.agentPresets.custom': { kind: 'single', scope: 'root' } },
    inject: sectionInjected,
  }, AgentPresetSection))
}
