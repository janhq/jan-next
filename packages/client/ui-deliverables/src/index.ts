/**
 * Deliverables plugin, node half. Serves authenticated native opens of declared files and indexes
 * each Session's presented files as a Session projection, so the Artifacts library lists every
 * chat's deliveries from the Session list. The browser half ships via exports["./client"],
 * discovered through the package.json jan.client declaration.
 */

import type { Context } from '@janhq/cordis'
import type {} from '@janhq/jan-session-projection'
import type {} from '@janhq/jan-workspace-changes/types'
import { presentedFilesProjectionDefinition } from '@janhq/jan-tool-present/projection'
import { registerPresentOpen } from './present-open.ts'

/** Services required for change summaries, authenticated native opens, and the presented-files index. */
export const inject = ['connection', 'sessionQuery', 'sessionController', 'workspaceFiles', 'fs', 'sandboxPolicy', 'workspaceChanges', 'sessionProjections']

/**
 * Register native opens for declared files and the presented-files projection.
 * The projection lives here, not in the per-agent `present` tool, because a cold
 * Session list reads it with no agent mounted.
 * @param ctx - host context carrying file, connection, and projection services.
 */
export async function apply(ctx: Context): Promise<void> {
  registerPresentOpen(ctx)
  await ctx.sessionProjections.register(presentedFilesProjectionDefinition)
}
