import { Context } from '@janhq/cordis'
import WorkingDirectory from '@janhq/jan-working-directory'
import type { Agent } from '@janhq/jan-agent'
import AgentLoop from '@janhq/jan-agent-loop'
import { mountAgentLoopTestDependencies } from '@janhq/jan-agent-loop-testkit'
import LocalFileSystem from '@janhq/jan-fs-local'
import * as FsPolicy from '@janhq/jan-fs-observation-policy'
import * as ToolFs from '@janhq/jan-tool-fs'
import * as LlmPiAi from '@janhq/jan-llm-pi-ai'

/**
 * Build the real fs-tool stack for with-key e2e tests. Agents have no session
 * cwd, so `fsCwd` is their workspace; `persona` configures the deployment prompt.
 * This helper lives outside the e2e glob so imports do not register tests.
 */
export async function fsHarness(fsCwd: string, persona = ''): Promise<Context> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx, { systemPrompt: { personaPrefix: persona } })
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(LlmPiAi, { providers: { deepseek: { apiKeyEnv: 'DEEPSEEK_API_KEY' } } })
  await ctx.plugin(LocalFileSystem, { cwd: fsCwd })
  await ctx.plugin(WorkingDirectory, { defaultDirectory: fsCwd })
  await ctx.plugin(FsPolicy)
  await ctx.plugin(ToolFs)
  return ctx
}

export function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') {
        dispose()
        resolve()
      }
    })
  })
}
