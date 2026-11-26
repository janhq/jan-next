/**
 * Workspace picker plugin, node half. The browser half ships via
 * exports["./client"], discovered through the package.json jan.client
 * declaration; this half only declares the Host Config the browser reads
 * through its configuration form.
 */
import type {} from '@janhq/jan-settings'

import type { Context, Volatile } from '@janhq/cordis'
import z from '@janhq/schemastery'

/** Sidebar preferences projected to the browser. */
export interface Config {
  /** Whether running chats repeat in a Working section at the top of the sidebar. */
  workingSection: Volatile<boolean>
}

/** Live sidebar preferences; a change applies without a restart. */
export const Config = z.object({
  workingSection: z.boolean().default(true)
    .description('Repeat running chats in a Working section at the top of the sidebar.').volatile(),
})

/**
 * Preferences are edited by the General settings row, so the automatic settings page stays off.
 * @param ctx - plugin context used for optional settings presentation.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (child) => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)) })
}
