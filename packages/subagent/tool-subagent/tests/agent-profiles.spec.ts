/** Named profiles through the delegation tool and the parent runtime context. */
import { assembleContextFor } from '@janhq/jan-agent'
import type { AgentProfile, AgentProfileGetRequest } from '@janhq/jan-agent-profiles/types'
import { ReasoningEffortId } from '@janhq/jan-llm'
import { describe, expect, it, vi } from 'vitest'
import { MockAdapter } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { callSubagent, modelSelectionSetupAgent, setup, text } from './harness.ts'

const args = { description: 'Review the evidence', prompt: 'Check these files.' }
const reviewer: AgentProfile = {
  id: 'reviewer', description: 'Reviews {{examples}}.', use: 'subagent', instructions: 'Review only.',
  scope: 'global', source: 'jan', path: '/example/reviewer.md', writable: true,
  model: { model: 'fast-model' }, disallowedTools: ['write'], warnings: [],
}
const primary: AgentProfile = { ...reviewer, id: 'primary-only', use: 'primary', path: '/example/primary-only.md' }
const shadowed: AgentProfile = { ...reviewer, id: 'shadowed', path: '/example/shadowed.md', shadowedBy: '/example/winner.md' }

async function setupProfiles(entries: readonly AgentProfile[] = [reviewer, primary, shadowed]) {
  const onStart = vi.fn()
  const ctx = await setup({
    provider: 'mock', modelSelection: true,
    parentAgentOptions: { provider: 'alpha', model: 'parent-model' },
  }, { capabilities: { agentPreset: true }, onStart })
  ctx.llm.registerAdapter(['alpha'], new MockAdapter([], {
    efforts: [{ id: ReasoningEffortId('high'), name: 'High' }],
  }))
  const agent = modelSelectionSetupAgent(ctx)
  const get = vi.fn(async ({ id }: AgentProfileGetRequest) => {
    const found = entries.find(entry => entry.id === id && entry.shadowedBy === undefined)
    if (found === undefined) throw Object.assign(new Error('Unknown agent'), { code: 'agent-profiles/not-found' })
    return found
  })
  const resolveModel = vi.fn(() => Promise.resolve({ provider: 'alpha', model: 'fast-model', reasoningEffort: 'high' }))
  const catalog = await ctx.plugin((owner) => {
    owner.provide('agentProfiles', {
      get, resolveModel, projectOf: () => undefined,
      snapshot: () => ({ profiles: entries, problems: [] }),
      toolRestrictionOf: () => ({ deny: ['write'] }),
    } as never)
  })
  const context = async () => {
    const assembly = await ctx.systemPrompt.assemble(assembleContextFor(agent))
    return assembly.contexts.find(part => part.name === 'agent-profiles:subagents')
  }
  return { ctx, agent, catalog, context, onStart, get, resolveModel }
}

describe('named subagent profiles', () => {
  it('advertises eligible agents and starts with their persona, tools and model defaults', async () => {
    const { ctx, agent, context, onStart, get, resolveModel } = await setupProfiles()
    const schema = ctx.tools.schemas(agent).find(entry => entry.name === 'subagent')
    expect(schema?.parameters.properties).toHaveProperty('agent', {
      type: 'string', description: 'Name of a Jan agent to run this task (see Available agents)',
    })
    expect(await context()).toMatchObject({
      text: 'Available agents (pass as `agent`):\n- reviewer: Reviews {{examples}}.', interpolate: false,
    })
    const expectedComposition = {
      label: 'Review the evidence (reviewer)', persona: 'Review only.', toolFilter: { deny: ['write'] },
    }

    expect((await callSubagent(ctx, { ...args, agent: 'reviewer' })).isError).not.toBe(true)
    expect(get).toHaveBeenCalledWith({ id: 'reviewer' })
    expect(onStart).toHaveBeenCalledWith(expect.objectContaining({
      ...expectedComposition,
      agentOptions: { provider: 'alpha', model: 'fast-model', reasoningEffort: ReasoningEffortId('high') },
    }))

    expect((await callSubagent(ctx, {
      ...args, agent: 'reviewer', provider: 'alpha', model: 'parent-model',
    })).isError).not.toBe(true)
    expect(resolveModel).toHaveBeenCalledTimes(1)
    expect(onStart).toHaveBeenLastCalledWith(expect.objectContaining({
      ...expectedComposition,
      agentOptions: { provider: 'alpha', model: 'parent-model', reasoningEffort: undefined },
    }))
  })

  it('keeps the agent roster when the preset turns optional runtime context off', async () => {
    const { agent, context } = await setupProfiles()
    const restore = agent.ctx.systemPrompt.suppressRuntimeContext()
    try {
      expect(await context()).toMatchObject({ text: 'Available agents (pass as `agent`):\n- reviewer: Reviews {{examples}}.' })
    } finally {
      restore()
    }
  })

  it('lists only selectable profiles in argument errors and removes guidance when the catalog unloads', async () => {
    const { ctx, agent, catalog, context, onStart } = await setupProfiles()
    for (const id of ['missing', primary.id, shadowed.id]) {
      const result = await callSubagent(ctx, { ...args, agent: id })
      expect(result.isError).toBe(true)
      expect(text(result)).toContain('agent must be one of: reviewer')
    }
    const lift = agent.ctx.tools.restrict({ deny: ['subagent'] })
    expect((await context())?.text).toBe('')
    lift()
    await catalog.dispose()
    expect(await context()).toBeUndefined()

    const result = await callSubagent(ctx, { ...args, agent: reviewer.id })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('agent must be one of: (none)')
    expect(onStart).not.toHaveBeenCalled()
  })

  it.each([
    { count: 42, description: 'brief', max: 40 },
    { count: 42, description: '🧪'.repeat(1100), max: 1 },
    { count: 1, description: '🧪'.repeat(1100), max: 1 },
  ])('bounds $count descriptions to $max complete entries within four KiB', async ({ count, description, max }) => {
    const entries = Array.from({ length: count }, (_, i) => ({ ...reviewer, id: `reviewer-${i}`, description }))
    const { context } = await setupProfiles(entries)
    const listing = (await context())?.text ?? ''
    expect(listing.split('\n').filter(line => line.startsWith('- '))).toHaveLength(max)
    expect(Buffer.byteLength(listing, 'utf8')).toBeLessThanOrEqual(4096)
    expect(listing).not.toContain('\uFFFD')
  })
})
