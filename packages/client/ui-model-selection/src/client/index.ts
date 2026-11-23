/**
 * Model selection plugin, browser half — TWO entries over ONE per-session
 * directory owned by ModelDirectoryResolver (`ctx.modelDirectories`). The /model popupSelect
 * contribution and the composer's named `conversation.input.model` seat share
 * one Host-generation `session/modelCatalog` catalog, combine it with the Session's
 * durable model-selection projection, and submit through `session.selectModel`.
 * A switch made in either entry is what the other shows next. Failures
 * ride each entry's own retry surface (popup shell error/retry; seat menu
 * inline error) without forking the state. Addressed subagent sessions expose
 * neither entry because those Agent-bound RPCs would activate persisted
 * history outside the direct-parent continuation path.
 */
// Type-only: the carrier types, the forwarded Host-event face and the ctx.remote merge.
import { createElement } from 'react'
import type { SessionId } from '@janhq/jan-session/types'
import type { PropsLocale, PropsRenderSlots, PropsRuntime } from '@janhq/jan-client-ui-slots'
import type { ModelSelection } from '@janhq/jan-api-session-controller/types'
import type { } from '@janhq/jan-api-session-controller/client'
import type { Context as ClientContext } from '@janhq/cordis'
import type { CommandUiContract, SelectOption } from '@janhq/jan-client-ui-commands/client'
// Type-only: pulls the ui-conversation SlotMap merge (the input.model seat).
import type { } from '@janhq/jan-client-ui-conversation/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type { } from '@janhq/jan-client-locale/client'
import type { } from '@janhq/jan-client-ui-renderer/client'
import type { } from '@janhq/jan-client-ui-session/client'
import type { } from '@janhq/jan-client-ui-settings-general/client'
import type { TranslateNS } from '@janhq/jan-client-ui-slots'
import type { ObservableSnapshot } from '@janhq/jan-client-store'
import { IconDataOutlineRegular } from '@janhq/jan-client-ui-primitives'
import type { ModelDirectoryState } from './directory.ts'
import { ModelDirectoryResolver } from './service.ts'
import type { ModelSelectInjected } from './slots.ts'
import { ModelSelect } from './ModelSelect.tsx'
import { ImageNotice, type ImageNoticeInjected } from './ImageNotice.tsx'
import { ToolNotice, type ToolNoticeInjected } from './ToolNotice.tsx'
import { en, ja, es, fr, de, ru, pt, zh, type ModelKey } from './locales.ts'
import { overflowOf } from './send-check.ts'
import type { ContextPressureProjection } from '@janhq/jan-token-meter/client'

export { ModelDirectory } from './directory.ts'
export type { ModelDirectoryState } from './directory.ts'
export { ModelDirectoryResolver } from './service.ts'
export type { ModelDetailsOwner, ModelLabelOwner, ModelOptionsOwner, ModelSelectInjected } from './slots.ts'
export type { ModelKey } from './locales.ts'

declare module '@janhq/jan-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The model selection surfaces' copy (/model popup + composer seat). */
    model: ModelKey
  }
}

/**
 * Live dock seat mounts. One entry may declare the model label and options
 * child slots, so while a dock seat is mounted the composer seat stands down
 * and contributions to those slots follow the picker into the dock.
 */
let dockSeats = 0
const dockSeatListeners = new Set<() => void>()

function changeDockSeats(delta: 1 | -1): void {
  dockSeats += delta
  for (const listener of [...dockSeatListeners]) listener()
}

const modelSeatChildren = {
  'conversation.input.model.label': { kind: 'single', scope: 'session', inline: true },
  'conversation.input.model.options': { kind: 'list', scope: 'session' },
  'conversation.input.model.details': { kind: 'list', scope: 'session' },
} as const

type ModelSeatProps = ModelSelectInjected & Pick<PropsRuntime<'conversation.input.model'>, 'locked'>
  & PropsLocale<'model'> & PropsRenderSlots<keyof typeof modelSeatChildren>

function renderModelSeat({ renderSlot, ...props }: ModelSeatProps) {
  return createElement(ModelSelect, {
    ...props,
    renderLabel: (owner, fallback) => renderSlot('conversation.input.model.label', owner, { fallback }),
    renderOptions: owner => renderSlot('conversation.input.model.options', owner),
    renderDetails: owner => renderSlot('conversation.input.model.details', owner),
  })
}

/** Optional dock selector plugin: the seat under the composer card, replacing the composer seat. */
export const DockModelSelection = {
  inject: ['slots', 'modelDirectories', 'sessions', 'locale'],
  apply(ctx: ClientContext): void {
    const settingsUnavailable: ObservableSnapshot<boolean> = { getSnapshot: () => false, subscribe: () => () => { } }
    // Claim before registering: the composer seat releases the child slots synchronously.
    ctx.effect(() => {
      changeDockSeats(1)
      return () => { changeDockSeats(-1) }
    }, 'ui-model-selection: dock seat claim')
    ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
      name: 'conversation.composer.dock', id: 'model', order: 2, locale: NS,
      children: modelSeatChildren,
      inject: modelInjection(ctx, settingsUnavailable),
    }, renderModelSeat))
  },
}
/**
 * Compose one model seat without requiring the optional Settings shell.
 * @param ctx - client plugin context.
 * @param settingsUnavailable - stable false source for profiles without Settings.
 * @returns injection for one session's model seat.
 */
function modelInjection(
  ctx: ClientContext, settingsUnavailable: ObservableSnapshot<boolean>,
): (sessionId: SessionId) => ModelSelectInjected {
  return (sessionId) => {
    const directory = ctx.modelDirectories.directoryFor(sessionId)
    const available = ctx.sessions.subagentAddress(sessionId) === undefined
    return {
      available, directory: directory.store,
      load: () => { if (available) void directory.load().catch(() => { /* surfaced on the store */ }) },
      settingsAvailability: ctx.get('settingsNavigation')?.availability ?? settingsUnavailable,
      openModelsSettings: () => { ctx.get('settingsNavigation')?.open('models') },
      resolveText: text => ctx.locale.resolveText(text),
      select: (selection: ModelSelection) => available ? directory.select(selection) : Promise.resolve(undefined),
    }
  }
}

/** One selectable row's id: an opaque row key (resolved by lookup, never parsed). */
function rowId(providerId: string, modelId: string): string {
  return `${providerId}/${modelId}`
}

/** Window store for a Session that has no model directory. */
const NO_WINDOW = { getSnapshot: (): number | undefined => undefined, subscribe: () => () => { } }

/** Flatten the directory into popup rows; failure rows are listed for visibility but never selectable. */
function optionsOf(directory: ModelDirectoryState, t: TranslateNS<'model'>): SelectOption[] {
  const rows: SelectOption[] = []
  for (const group of directory.groups) {
    for (const model of group.models) {
      rows.push({
        id: rowId(group.id, model.id),
        label: model.name,
        group: { name: group.id, label: group.name },
        ...(directory.current !== null
          && directory.current.provider === group.id
          && directory.current.model === model.id
          ? { active: true } : {}),
      })
    }
  }
  for (const failure of directory.failures) {
    rows.push({
      id: `failure/${failure.id}`,
      label: failure.name,
      detail: failure.code === 'MISSING_CREDENTIAL'
        ? t('option.signedOut')
        : t('option.loadError', { message: failure.message }),
    })
  }
  return rows
}

/**
 * Resolve a picked row back to its model selection by matching against the loaded
 * groups (the same data the rows were built from — ids stay opaque).
 * @param state - the session's directory snapshot.
 * @param id - the picked row id.
 * @returns the row's model selection, or undefined for failure rows / stale ids.
 */
function selectionOf(state: ModelDirectoryState, id: string): ModelSelection | undefined {
  for (const group of state.groups) {
    for (const model of group.models) {
      if (rowId(group.id, model.id) !== id) continue
      const sameRoute = state.current?.provider === group.id && state.current.model === model.id
      const reasoningEffort = sameRoute
        ? state.current?.reasoningEffort ?? model.reasoning?.defaultEffort
        : model.reasoning?.defaultEffort
      return {
        provider: group.id,
        model: model.id,
        ...reasoningEffort === undefined ? {} : { reasoningEffort },
      }
    }
  }
  return undefined
}

/** Dictionary namespace owned by this plugin. */
const NS = 'model'

/** Required services: the contribution registry, the seat's slot registry, locale, and the service's own faces. */
export const inject = ['commandUi', 'locale', 'sessions', 'slots', 'remote', 'remote.session']

/**
 * Client plugin body: mount ModelDirectoryResolver, register the `model` dictionaries,
 * then register the /model popup contribution and the composer model seat
 * over the service.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const settingsUnavailable: ObservableSnapshot<boolean> = { getSnapshot: () => false, subscribe: () => () => { } }
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ja, es, fr, de, ru, pt }), 'ui-model-selection: dictionaries')

  // Non-slot faces (the command description, the popup option builder) read
  // through the bound translate; the seat component reads the standard seat.
  const t = ctx.locale.bind(NS)

  ctx.plugin(ModelDirectoryResolver)

  // Warn before a plain message the selected model cannot hold.
  ctx.inject(['conversation', 'modelDirectories'], (scope: ClientContext) => {
    scope.effect(() => scope.conversation.input.addSendCheck((sessionId, text) => {
      const pressure = scope.sessions.binding(sessionId)?.session.projections.faceOf('contextPressure')
        .getSnapshot() as ContextPressureProjection | undefined
      const overflow = overflowOf(text, { directory: scope.modelDirectories.directoryFor(sessionId).store.getSnapshot(), pressure })
      if (overflow === undefined) return undefined
      return t('send.tooLong', {
        tokens: overflow.tokens.toLocaleString(), window: overflow.contextWindow.toLocaleString(), model: overflow.model,
      })
    }), 'ui-model-selection: context-window send check')
    // The context meter reads the selected model's window until the first request reports one.
    scope.effect(() => scope.conversation.input.setContextWindowSource((sessionId) => {
      // A Session without a retained scope (an addressed subagent, a closing tab) has no directory.
      if (scope.sessions.scope(sessionId) === undefined || scope.sessions.binding(sessionId) === undefined) return NO_WINDOW
      const directory = scope.modelDirectories.directoryFor(sessionId)
      const windowOf = (state: ModelDirectoryState): number | undefined => {
        const current = state.current
        return current === null ? undefined : state.groups.find(group => group.id === current.provider)
          ?.models.find(model => model.id === current.model)?.contextWindow
      }
      if (directory.store.getSnapshot().groups.length === 0) void directory.load().catch(() => undefined)
      return {
        getSnapshot: () => windowOf(directory.store.getSnapshot()),
        subscribe: listener => directory.store.subscribe(listener),
      }
    }), 'ui-model-selection: context-window source')
  })

  // Say at attach time that the selected model cannot read the draft's images.
  ctx.inject(['slots', 'conversation', 'modelDirectories'], (scope: ClientContext) => {
    scope.slots.inject('conversation.input.dock', () => scope.slots.register({
      name: 'conversation.input.dock', id: 'model-image', order: 30, locale: NS,
      inject: (sessionId: SessionId): ImageNoticeInjected => {
        const actx = scope.sessions.scope(sessionId)
        if (actx === undefined) throw new Error(`ui-model-selection: session "${String(sessionId)}" resolved no scope`)
        const input = scope.conversation.input.for(actx).state
        const directory = scope.modelDirectories.directoryFor(sessionId)
        return {
          directory: directory.store,
          draftHasImage: {
            getSnapshot: () => scope.conversation.resolveDraftAttachments(input.getSnapshot().attachmentIds)
              .some(attachment => attachment.kind === 'image'),
            subscribe: listener => input.subscribe(listener),
          },
          select: async selection => (await directory.select(selection)).ok,
        }
      },
    }, ImageNotice))
  })

  // Say as soon as a model that cannot use tools is selected; dismissed per chat and model.
  ctx.inject(['slots', 'modelDirectories'], (scope: ClientContext) => {
    const dismissed = new Set<string>()
    scope.slots.inject('conversation.input.dock', () => scope.slots.register({
      name: 'conversation.input.dock', id: 'model-tools', order: 31, locale: NS,
      inject: (sessionId: SessionId): ToolNoticeInjected => {
        const directory = scope.modelDirectories.directoryFor(sessionId)
        const key = (model: string): string => `${String(sessionId)}\n${model}`
        return {
          directory: directory.store,
          select: async selection => (await directory.select(selection)).ok,
          dismissed: model => dismissed.has(key(model)),
          dismiss: (model) => { dismissed.add(key(model)) },
        }
      },
    }, ToolNotice))
  })

  // Entry 1: the /model popupSelect over the shared directory.
  ctx.inject(['commandUi', 'modelDirectories'], (scope: ClientContext) => {
    const command = scope.get('commandUi') as CommandUiContract
    const models = scope.modelDirectories
    const sessions = scope.sessions
    scope.effect(() => command.register({
      name: 'model',
      label: () => t('command.label'),
      description: () => t('command.description'),
      icon: IconDataOutlineRegular,
      available: session => sessions.subagentAddress(session.sessionId) === undefined,
      ui: {
        kind: 'popupSelect',
        searchLabels: () => ({
          placeholder: t('search.placeholder'),
          empty: t('empty.models'),
          noResults: t('search.empty'),
        }),
        options: async (session) => {
          if (sessions.subagentAddress(session.sessionId) !== undefined) {
            throw new Error('model selection is unavailable for addressed subagent sessions')
          }
          return optionsOf(await models.directoryFor(session.sessionId).load(), t)
        },
        onSelect: async (option, session) => {
          if (sessions.subagentAddress(session.sessionId) !== undefined) {
            throw new Error('model selection is unavailable for addressed subagent sessions')
          }
          const directory = models.directoryFor(session.sessionId)
          const selection = selectionOf(directory.store.getSnapshot(), option.id)
          if (selection === undefined) {
            throw new Error('this provider\'s catalog failed to load — pick a model from a loaded group')
          }
          const result = await directory.select(selection)
          if (!result.ok) {
            if (result.error.code === 'session/writer-held') throw new Error(t('error.sessionInUse'))
            throw result.error
          }
        },
      },
    }), 'ui-model-selection: /model contribution')
  })

  ctx.inject(['slots', 'modelDirectories'], (scope: ClientContext) => {
    let seat: (() => void) | undefined
    const sync = (): void => {
      if (dockSeats > 0) {
        seat?.()
        seat = undefined
        return
      }
      seat ??= scope.slots.inject('conversation.input.model', () => scope.slots.register({
        name: 'conversation.input.model',
        locale: NS,
        children: modelSeatChildren,
        inject: modelInjection(scope, settingsUnavailable),
      }, renderModelSeat))
    }
    scope.effect(() => {
      dockSeatListeners.add(sync)
      sync()
      return () => {
        dockSeatListeners.delete(sync)
        seat?.()
        seat = undefined
      }
    }, 'ui-model-selection: composer seat')
  })
}
