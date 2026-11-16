import { Context } from '@janhq/cordis'
import Sandbox from '@janhq/jan-sandbox-local'
import SandboxPolicy from '@janhq/jan-sandbox-policy'
import SessionProjections from '@janhq/jan-session-projection'
import { onTestFinished } from 'vitest'
import type { SandboxMode } from '@janhq/jan-sandbox'

/** Mount the Python runtime's policy and confinement providers with owned teardown. */
export async function createRuntimeContext(policy: { mode?: SandboxMode; workspaceRoot?: string } = {}): Promise<Context> {
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  await ctx.plugin(Sandbox, {})
  await ctx.plugin(SessionProjections)
  await ctx.plugin(SandboxPolicy, { mode: 'danger-full-access', ...policy })
  return ctx
}
