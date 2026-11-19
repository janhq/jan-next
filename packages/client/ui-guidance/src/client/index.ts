/** Register the browser's local guidance service and navigation copy. */
import type { Context } from '@janhq/cordis'
import type {} from '@janhq/jan-client-locale/client'
import { dictionaries, type GuidanceKey } from './locales.ts'
import { createGuidance } from './guidance.ts'
import type { GuidanceService } from './contract.ts'

export type { GuidanceService, GuidanceStep, GuidanceTour } from './contract.ts'

declare module '@janhq/cordis' {
  interface Context {
    /** Replayable tours and local acknowledgements for contextual guidance. */
    uiGuidance: GuidanceService
  }
}

declare module '@janhq/jan-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Tour navigation and position labels. */
    guidance: GuidanceKey
  }
}

/** Guidance needs the browser locale service for its navigation controls. */
export const inject = ['locale']

/**
 * Provide guidance for the lifetime of the Client plugin.
 * @param ctx - owning Client context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('guidance', dictionaries), 'guidance: dictionaries')
  const { service, dispose } = createGuidance(ctx.locale.bind('guidance'))
  ctx.provide('uiGuidance', service)
  ctx.effect(() => dispose, 'guidance: tour lifetime')
}
