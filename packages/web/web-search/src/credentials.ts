/**
 * Per-operation API-key lookup through the credential seam, falling back to the launch environment
 * in compositions that mount no `ctx.credentials`.
 * @module @janhq/jan-web-search/credentials
 */

import type { Context } from '@janhq/cordis'
import type { CredentialRef } from '@janhq/jan-credentials'
import { launchEnvironmentOf } from '@janhq/jan-launch-environment'

/** Looks up one credential reference for the operation about to run. */
export type KeyLookup = (ref: CredentialRef) => Promise<string | undefined>

/**
 * Build the lookup the providers call once per operation, so a changed key reaches the next
 * search or fetch without a restart.
 * @param ctx - the plugin context; `ctx.credentials` is optional.
 * @returns a lookup answering the non-empty value, or undefined while the reference is unset.
 */
export function keyLookupFrom(ctx: Context): KeyLookup {
  return async (ref) => {
    const credentials = ctx.get('credentials')
    const value = credentials === undefined
      ? launchEnvironmentOf(ctx).get(ref)?.value
      : (await credentials.resolve(ref))?.value
    const trimmed = value?.trim()
    return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed
  }
}
