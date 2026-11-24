/** Resolves and seeds per-role default models on newly created sessions without mutating the global DSH default. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, ModelSelection } from '@deepseek-ai/dsh-agent'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { RoleModel } from '../policy.ts'

/** Resolve a configured route through the live provider; catalog membership is not a restriction. */
export async function resolveRoleModel(ctx: Context, model: RoleModel): Promise<ModelSelection> {
  const value = await ctx.llm.resolveCallConfig({ provider: model.provider, model: model.model,
    ...(model.reasoningEffort ? { reasoningEffort: ReasoningEffortId(model.reasoningEffort) } : {}) })
  return { provider: value.provider, model: value.model, ...(value.reasoningEffort ? { reasoningEffort: value.reasoningEffort } : {}) }
}

/** Seed a role's configured model onto a brand-new session before its first request, leaving later manual or durable selections intact. */
export async function initializeRoleModel(ctx: Context, agent: Agent, model: RoleModel | null): Promise<void> {
  if (!model) return
  if (agent.session.requestHeader() || agent.session.snapshotEvents().some(event => event.type === 'model/selection')) return
  const selected = await resolveRoleModel(ctx, model)
  // Jan routes every step through the Session's durable model/selection projection, which also supplies the
  // prompt's {{provider}}/{{model}} variables; a per-session append leaves the host default untouched.
  agent.session.append('model/selection', selected)
  await ctx.sessionPersistence.flush()
}
