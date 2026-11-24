/** Agent profiles: folder precedence, Jan file writes, watching, and per-chat selection. */
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@janhq/cordis'
import type { Agent } from '@janhq/jan-agent'
import { SessionId } from '@janhq/jan-session'
import SystemPrompt, { renderPrompt } from '@janhq/jan-system-prompt'
import type { Workspace, WorkspaceId } from '@janhq/jan-workspace'
import AgentProfiles from '../src/index.ts'
import type {} from '../src/types.ts'

const roots: Context[] = []
const dirs: string[] = []
afterEach(async () => {
  for (const ctx of roots.splice(0)) await ctx.fiber.dispose()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const PROJECT = 'project-a' as WorkspaceId

interface FakeSession {
  header: { cwd: string }
  events: { type: string; data: { agentProfile: string | null } }[]
  openTurn: number | null
  append(type: string, data: { agentProfile: string | null }): void
}

function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'agent-profiles-'))
  dirs.push(dir)
  const home = { janHome: join(dir, 'jan'), agentsHome: join(dir, 'agents-home'), userHome: join(dir, 'home') }
  const project = join(dir, 'project')
  mkdirSync(project, { recursive: true })
  const ctx = new Context()
  roots.push(ctx)
  await ctx.plugin(SystemPrompt)
  const workspaces: Workspace[] = [{ id: PROJECT, path: project, sessionIds: [SessionId('chat-a')] } as never]
  const agents: Agent[] = []
  const selected: unknown[] = []
  ctx.provide('workspaceRegistry', { list: () => workspaces, get: (id: WorkspaceId) => workspaces.find(w => w.id === id) } as never)
  ctx.provide('sessionProjections', {
    register: async (definition: { init(): string | null; apply(state: string | null, event: unknown): string | null }) => ({
      stateOf: (session: FakeSession) => session.events.reduce((state, event) => definition.apply(state, event), definition.init()),
    }),
  } as never)
  ctx.provide('agents', {
    get: (id: string) => agents.find(agent => agent.id === id),
    list: () => agents,
    turnBoundaryOf: (session: FakeSession) => ({ openTurnStartSeq: session.openTurn }),
  } as never)
  ctx.provide('sessionController', {
    modelCatalog: async () => ({
      groups: [
        { id: 'tokamak', models: [{ id: 'anthropic/claude-haiku-4-5' }, { id: 'anthropic/claude-haiku-5-5' }] },
        { id: 'anthropic', models: [{ id: 'claude-haiku-5-5' }] },
      ],
    }),
  } as never)
  ctx.provide('llm', { resolveCallConfig: async (config: unknown) => config } as never)
  const addAgent = (id: string): Agent & { session: FakeSession } => {
    const session: FakeSession = {
      header: { cwd: project }, events: [], openTurn: null,
      append(type, data) { this.events.push({ type, data }) },
    }
    const model = { select: (selection: unknown) => { selected.push(selection) } }
    const agent = { id: SessionId(id), session, model } as never as Agent & { session: FakeSession }
    agents.push(agent)
    return agent
  }
  await ctx.plugin(AgentProfiles, { ...home, debounceMs: 50, maxFileBytes: 64 * 1024 })
  const profiles = ctx.agentProfiles
  const prompt = async (agent: Agent): Promise<string> => renderPrompt(await ctx.systemPrompt.assemble({ agent }))
  return { ctx, dir, home, project, profiles, addAgent, selected, prompt }
}

it('resolves project over global and Jan over Claude, listing the losers as shadowed', async () => {
  const h = await setup()
  write(join(h.home.userHome, '.claude', 'agents', 'reviewer.md'), '---\nname: reviewer\ndescription: global claude\n---\nG')
  write(join(h.project, '.claude', 'agents', 'reviewer.md'), '---\nname: reviewer\ndescription: project claude\n---\nC')
  write(join(h.project, '.jan', 'agents', 'reviewer.md'), '---\nname: reviewer\ndescription: project jan\n---\nJ')
  write(join(h.project, '.claude', 'agents', 'broken.md'), '---\ndescription: no name\n---\n')
  await h.profiles.save({ scope: 'global', profile: { id: 'other', description: 'x', use: 'all', instructions: '' } })

  const listed = await h.profiles.list({ workspaceId: PROJECT })
  const janPath = join(h.project, '.jan', 'agents', 'reviewer.md')
  const user = listed.profiles.filter(p => p.source !== 'builtin')
  expect(user.map(p => [p.id, p.description, p.shadowedBy])).toEqual([
    ['reviewer', 'project jan', undefined],
    ['reviewer', 'project claude', janPath],
    ['other', 'x', undefined],
    ['reviewer', 'global claude', janPath],
  ])
  expect(listed.profiles.find(p => p.source === 'builtin' && p.id === 'reviewer')?.shadowedBy).toBe(janPath)
  expect(listed.problems).toEqual([{ scope: 'project', path: join(h.project, '.claude', 'agents', 'broken.md'), reason: 'missing name' }])
  expect((await h.profiles.get({ id: 'reviewer', workspaceId: PROJECT })).instructions).toBe('J')
  expect((await h.profiles.list({})).profiles.filter(p => p.source !== 'builtin').map(p => [p.id, p.shadowedBy]))
    .toEqual([['other', undefined], ['reviewer', undefined]])
})

it('round-trips a saved Jan profile and refuses to delete a foreign one', async () => {
  const h = await setup()
  const saved = await h.profiles.save({
    scope: 'global', profile: { id: 'reviewer', description: 'Reviews', use: 'subagent', tools: ['read', 'grep'], instructions: 'Look.' },
  })
  expect(saved).toMatchObject({ id: 'reviewer', source: 'jan', scope: 'global', writable: true, tools: ['read', 'grep'], use: 'subagent' })
  expect(readFileSync(join(h.home.janHome, 'agents', 'reviewer.md'), 'utf8')).toContain('tools: Read, Grep\n')
  expect((await h.profiles.get({ id: 'reviewer' })).instructions).toBe('Look.')

  write(join(h.home.userHome, '.codex', 'agents', 'fixer.toml'), 'name = "fixer"\ndeveloper_instructions = "Fix."\n')
  await expect(h.profiles.deleteProfile({ scope: 'global', id: 'fixer' })).rejects.toMatchObject({ code: 'agent-profiles/read-only' })
  await h.profiles.deleteProfile({ scope: 'global', id: 'reviewer' })
  // Deleting the Jan copy brings back the shipped profile it replaced.
  expect(await h.profiles.get({ id: 'reviewer' })).toMatchObject({ source: 'builtin', writable: false })
})

it('ships read-only built-in profiles that parse cleanly and give way to any user file with the same id', async () => {
  const h = await setup()
  const builtins = (await h.profiles.list({})).profiles.filter(p => p.source === 'builtin')
  expect(builtins.map(p => p.id).sort()).toEqual(['debugger', 'explorer', 'planner', 'researcher', 'reviewer', 'tester', 'worker', 'writer'])
  for (const profile of builtins) {
    expect(profile).toMatchObject({ scope: 'global', writable: false, warnings: [] })
    expect(profile.description.length).toBeGreaterThan(40)
    expect((await h.profiles.get({ id: profile.id })).instructions.length).toBeGreaterThan(400)
  }
  expect([...builtins.find(p => p.id === 'reviewer')?.disallowedTools ?? []].sort()).toEqual(['apply_patch', 'edit', 'str_replace_editor', 'write'])
  expect(builtins.find(p => p.id === 'explorer')?.use).toBe('subagent')
  // Read-and-report agents cannot write even under a Full access chat; builders stay inside the project.
  expect(Object.fromEntries(builtins.map(p => [p.id, p.sandbox]))).toEqual({
    reviewer: 'read-only', researcher: 'read-only', explorer: 'read-only', planner: 'read-only',
    debugger: 'workspace-write', tester: 'workspace-write', worker: 'workspace-write', writer: 'workspace-write',
  })
  await expect(h.profiles.deleteProfile({ scope: 'global', id: 'researcher' })).rejects.toMatchObject({ code: 'agent-profiles/read-only' })

  write(join(h.home.userHome, '.claude', 'agents', 'researcher.md'), '---\nname: researcher\ndescription: mine\n---\nMine')
  await h.profiles.list({})
  await new Promise(resolve => setTimeout(resolve, 400))
  expect((await h.profiles.get({ id: 'researcher' })).instructions).toBe('Mine')
})

it('emits a change within a second when a file is renamed on disk or a folder appears', async () => {
  const h = await setup()
  const file = join(h.project, '.claude', 'agents', 'pirate.md')
  write(file, '---\nname: pirate\ndescription: Talks like a pirate\n---\nArr.')
  await vi.waitFor(async () => {
    expect((await h.profiles.list({ workspaceId: PROJECT })).profiles.filter(p => p.source !== 'builtin').map(p => p.id)).toEqual(['pirate'])
  }, { timeout: 2_000 })
  const changed = new Promise<void>((resolve) => { h.ctx.on('agent-profiles/changed', () => { resolve() }) })
  renameSync(file, join(h.project, '.claude', 'agents', 'parrot.md'))
  await expect(Promise.race([changed.then(() => 'changed'), new Promise(resolve => setTimeout(resolve, 1_000, 'timeout'))])).resolves.toBe('changed')
})

it('selects a profile at a turn boundary, logs it, switches the model and adds the prompt section', async () => {
  const h = await setup()
  write(join(h.project, '.claude', 'agents', 'pirate.md'),
    '---\nname: pirate\ndescription: Talks like a pirate\nmodel: haiku\ntools: Read\n---\nAlways answer like a pirate.')
  write(join(h.project, '.opencode', 'agents', 'helper.md'), '---\nmode: subagent\n---\nHelp.')
  const agent = h.addAgent('chat-a')

  agent.session.openTurn = 3
  await expect(h.profiles.select({ sessionId: agent.id, id: 'pirate' })).rejects.toMatchObject({ code: 'agent-profiles/locked' })
  agent.session.openTurn = null
  await expect(h.profiles.select({ sessionId: agent.id, id: 'helper' })).rejects.toMatchObject({ code: 'agent-profiles/invalid' })

  await h.profiles.select({ sessionId: agent.id, id: 'pirate' })
  expect(agent.session.events).toEqual([{ type: 'agent-profile/selected', data: { agentProfile: 'pirate' } }])
  expect(h.selected).toEqual([{ provider: 'tokamak', model: 'anthropic/claude-haiku-5-5' }])
  expect(h.profiles.toolLimitsFor(agent)).toEqual({ allow: ['read'], deny: [] })
  expect(await h.prompt(agent)).toContain('Agent: pirate\n\nTalks like a pirate\n\nAlways answer like a pirate.')

  await h.profiles.select({ sessionId: agent.id, id: null })
  expect(h.profiles.profileForSession(agent.session as never)).toBeNull()
  expect(await h.prompt(agent)).not.toContain('Agent: pirate')
})

it('keeps a running chat on the profile it first read, so a hot edit never rewrites its prompt or tools', async () => {
  const h = await setup()
  const file = join(h.project, '.jan', 'agents', 'pirate.md')
  write(file, '---\nname: pirate\ndescription: Talks like a pirate\ntools: Read\n---\nArr.')
  const agent = h.addAgent('chat-a')
  await h.profiles.list({ workspaceId: PROJECT })
  await h.profiles.select({ sessionId: agent.id, id: 'pirate' })
  const before = await h.prompt(agent)

  write(file, '---\nname: pirate\ndescription: Talks like a parrot\ntools: Read, Grep\n---\nSquawk.')
  await vi.waitFor(async () => {
    expect((await h.profiles.get({ id: 'pirate', workspaceId: PROJECT })).instructions).toBe('Squawk.')
  }, { timeout: 2_000 })
  expect(await h.prompt(agent)).toBe(before)
  expect(h.profiles.toolLimitsFor(agent)).toEqual({ allow: ['read'], deny: [] })

  // Picking the profile again is the explicit way to take the edit.
  await h.profiles.select({ sessionId: agent.id, id: 'pirate' })
  expect(await h.prompt(agent)).toContain('Squawk.')
  expect(h.profiles.toolLimitsFor(agent)).toEqual({ allow: ['read', 'grep'], deny: [] })
})
