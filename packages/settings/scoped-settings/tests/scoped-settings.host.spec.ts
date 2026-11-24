/** Scoped settings: stored values per scope, project defaults, and tool switches applied to live agents. */
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@janhq/cordis'
import type { Agent } from '@janhq/jan-agent'
import type { AgentToolLimits } from '@janhq/jan-agent-profiles/types'
import { syncTools } from '@janhq/jan-mcp-client/src/tools.ts'
import { createScope } from '@janhq/jan-scope'
import { SessionId } from '@janhq/jan-session'
import SystemPrompt from '@janhq/jan-system-prompt'
import ToolRuntime, { defineTool } from '@janhq/jan-tools'
import type { Workspace, WorkspaceId } from '@janhq/jan-workspace'
import ScopedSettings from '../src/index.ts'

const roots: Context[] = []
const dirs: string[] = []
afterEach(async () => {
  for (const ctx of roots.splice(0)) await ctx.fiber.dispose()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const PROJECT = 'project-c' as WorkspaceId
const OTHER = 'project-d' as WorkspaceId

function tool(name: string) {
  return defineTool({
    name, description: `The ${name} tool.`, parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute() { return name },
  })
}

async function registerMcpTools(ctx: Context, names: string[]): Promise<void> {
  await syncTools({
    getServerCapabilities: () => ({ tools: {} }),
    listTools: async () => ({ tools: names.map(name => ({ name, inputSchema: { type: 'object' } })) }),
  } as never, ctx, { serverName: 'github', toolCallTimeoutMs: 1_000, signal: new AbortController().signal }, new Map())
}

interface Setup {
  readonly file?: string
  readonly presets?: readonly { id: string; broken?: string }[]
}

async function setup(options: Setup = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'scoped-settings-'))
  dirs.push(dir)
  const file = options.file ?? join(dir, 'settings', 'scoped.json')
  const ctx = new Context()
  roots.push(ctx)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  for (const name of ['bash', 'read']) ctx.tools.register(tool(name))
  await registerMcpTools(ctx, ['search', 'issue'])
  const workspaces: Workspace[] = [
    { id: PROJECT, path: '/repo/c', sessionIds: [SessionId('chat-a')] } as never,
    { id: OTHER, path: '/repo/d', sessionIds: [SessionId('chat-b')] } as never,
  ]
  const agents: Agent[] = []
  ctx.provide('workspaceRegistry', {
    list: () => workspaces,
    get: (id: WorkspaceId) => workspaces.find(workspace => workspace.id === id),
  } as never)
  ctx.provide('agents', { list: () => agents } as never)
  if (options.presets !== undefined) {
    const presets = options.presets
    ctx.provide('agentPresets', { list: async () => presets } as never)
  }
  const addAgent = async (id: string, cwd: string): Promise<Agent> => {
    const agent: { -readonly [K in keyof Agent]: Agent[K] } = { id: SessionId(id), session: { header: { cwd } }, status: 'idle' } as never
    await ctx.plugin(Object.assign((inner: Context) => { agent.ctx = createScope(inner, agent).ctx }, { inject: ['tools'] }))
    agents.push(agent)
    return agent
  }
  const visible = (agent: Agent): string[] => ctx.tools.definitions(agent).map(definition => definition.name).sort()
  const start = async (): Promise<ScopedSettings> => {
    await ctx.plugin(ScopedSettings, { file })
    return ctx.scopedSettings
  }
  return { ctx, dir, file, addAgent, visible, start }
}

it('stores each scope separately, persists privately, and reads back after a restart', async () => {
  const h = await setup()
  const settings = await h.start()
  await settings.write({ scope: 'global', values: { toolsDisabled: ['read', 'bash', 'bash'] } })
  await settings.write({ scope: 'project', id: PROJECT, values: { model: { provider: 'tokamak', model: 'haiku' }, mode: 'chat' } })
  await settings.write({ scope: 'session', id: 'chat-a', values: { toolsDisabled: ['mcp:github'] } })

  expect(settings.read({ scope: 'global' })).toEqual({ toolsDisabled: ['bash', 'read'] })
  expect(settings.read({ scope: 'project', id: PROJECT })).toEqual({ model: { provider: 'tokamak', model: 'haiku' }, mode: 'chat' })
  expect(settings.read({ scope: 'project', id: OTHER })).toEqual({})
  expect(statSync(h.file).mode & 0o777).toBe(0o600)

  const restarted = await setup({ file: h.file })
  const again = await restarted.start()
  expect(again.read({ scope: 'session', id: 'chat-a' })).toEqual({ toolsDisabled: ['mcp:github'] })
  expect(again.resolveModel(SessionId('chat-a'))).toEqual({ provider: 'tokamak', model: 'haiku' })
  expect(again.resolveModel(SessionId('chat-b'))).toBeUndefined()
  expect(again.resolveModel(SessionId('new-chat'), PROJECT)).toEqual({ provider: 'tokamak', model: 'haiku' })
})

it('applies project switches to an unindexed chat under a folder whose name begins with two dots', async () => {
  const settings = await (await setup()).start()
  const unindexed = SessionId('new-chat')
  await settings.write({ scope: 'project', id: PROJECT, values: { toolsDisabled: ['bash'] } })

  expect(settings.resolveToolsDisabled(unindexed, join('/repo/c', '..notes', 'drafts'))).toEqual(['bash'])
  expect(settings.resolveToolsDisabled(unindexed, join('/repo/c', '..', 'c-sibling'))).toEqual([])
})

it('reads back a project that stores a mode or tools without a model after a restart', async () => {
  const h = await setup()
  const settings = await h.start()
  await settings.write({ scope: 'project', id: PROJECT, values: { mode: 'chat' } })
  await settings.write({ scope: 'project', id: OTHER, values: { toolsDisabled: ['bash'] } })

  const again = await (await setup({ file: h.file })).start()
  expect(again.read({ scope: 'project', id: PROJECT })).toEqual({ mode: 'chat' })
  expect(again.read({ scope: 'project', id: OTHER })).toEqual({ toolsDisabled: ['bash'] })
  expect(readdirSync(h.dir).filter(name => name.includes('.invalid-'))).toEqual([])
})

it('removes a key on null or an empty list, and drops a scope with nothing left', async () => {
  const h = await setup()
  const settings = await h.start()
  await settings.write({ scope: 'project', id: PROJECT, values: { mode: 'chat', toolsDisabled: ['bash'] } })
  await settings.write({ scope: 'project', id: PROJECT, values: { mode: null } })
  expect(settings.read({ scope: 'project', id: PROJECT })).toEqual({ toolsDisabled: ['bash'] })
  await settings.write({ scope: 'project', id: PROJECT, values: { toolsDisabled: [] } })
  expect(JSON.parse(readFileSync(h.file, 'utf8'))).toEqual({ version: 1, global: {}, projects: {}, sessions: {} })
})

it('stores, restores and clears a project default agent', async () => {
  const h = await setup()
  const settings = await h.start()
  await settings.write({ scope: 'project', id: PROJECT, values: { agent: 'team/reviewer' } })
  expect(settings.resolveAgent(PROJECT)).toBe('team/reviewer')
  expect(settings.resolveAgent(OTHER)).toBeUndefined()

  const again = await (await setup({ file: h.file })).start()
  expect(again.resolveAgent(PROJECT)).toBe('team/reviewer')
  await again.write({ scope: 'project', id: PROJECT, values: { agent: null } })
  expect(again.resolveAgent(PROJECT)).toBeUndefined()
})

it('refuses keys a scope does not store and projects that do not exist', async () => {
  const settings = await (await setup()).start()
  await expect(settings.write({ scope: 'global', values: { model: { provider: 'p', model: 'm' } } }))
    .rejects.toMatchObject({ code: 'scoped-settings/invalid' })
  await expect(settings.write({ scope: 'session', id: 'chat-a', values: { mode: 'chat' } }))
    .rejects.toMatchObject({ code: 'scoped-settings/invalid' })
  await expect(settings.write({ scope: 'global', values: { agent: 'reviewer' } }))
    .rejects.toMatchObject({ code: 'scoped-settings/invalid' })
  await expect(settings.write({ scope: 'session', id: 'chat-a', values: { agent: 'reviewer' } }))
    .rejects.toMatchObject({ code: 'scoped-settings/invalid' })
  await expect(settings.write({ scope: 'project', id: 'gone', values: { mode: 'chat' } }))
    .rejects.toMatchObject({ code: 'workspace/not-found' })
  expect(() => settings.read({ scope: 'project' })).toThrow(expect.objectContaining({ code: 'scoped-settings/invalid' }))
})

it('moves an unreadable document aside and starts empty', async () => {
  const h = await setup()
  writeFileSync(join(h.dir, 'broken.json'), '{"version":1,"global":{"toolsDisabled":"bash"}}')
  const broken = await setup({ file: join(h.dir, 'broken.json') })
  const warn = vi.spyOn(broken.ctx.logger, 'warn').mockImplementation(() => broken.ctx.logger)
  const settings = await broken.start()
  expect(settings.read({ scope: 'global' })).toEqual({})
  const kept = readdirSync(h.dir).filter(name => name.startsWith('broken.json.invalid-'))
  expect(kept).toHaveLength(1)
  expect(readFileSync(join(h.dir, kept[0]!), 'utf8')).toContain('"toolsDisabled":"bash"')
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('started empty'))
})

it('switches tools off as the union of every scope and lifts the switch when it is removed', async () => {
  const h = await setup()
  const inProject = await h.addAgent('chat-a', '/repo/c')
  const elsewhere = await h.addAgent('chat-b', '/repo/d')
  const settings = await h.start()
  const all = ['bash', 'mcp__github__issue', 'mcp__github__search', 'read']
  expect(h.visible(inProject)).toEqual(all)

  await settings.write({ scope: 'global', values: { toolsDisabled: ['read'] } })
  await settings.write({ scope: 'project', id: PROJECT, values: { toolsDisabled: ['mcp:github'] } })
  await settings.write({ scope: 'session', id: 'chat-a', values: { toolsDisabled: ['bash'] } })
  expect(settings.resolveToolsDisabled(SessionId('chat-a'))).toEqual(['bash', 'mcp:github', 'read'])
  expect(h.visible(inProject)).toEqual([])
  expect(h.visible(elsewhere)).toEqual(['bash', 'mcp__github__issue', 'mcp__github__search'])

  await settings.write({ scope: 'project', id: PROJECT, values: { toolsDisabled: null } })
  await settings.write({ scope: 'global', values: { toolsDisabled: null } })
  expect(h.visible(inProject)).toEqual(['mcp__github__issue', 'mcp__github__search', 'read'])
  expect(h.visible(elsewhere)).toEqual(all)
})

it('combines a profile allowlist with global tool switches and refreshes when the profile changes', async () => {
  const h = await setup()
  const reviewer = await h.addAgent('chat-a', '/repo/c')
  const plain = await h.addAgent('chat-b', '/repo/d')
  let limits: AgentToolLimits = { allow: ['read'], deny: [] }
  h.ctx.provide('agentProfiles', {
    toolLimitsFor: (agent: Agent): AgentToolLimits => agent === reviewer ? limits : { deny: [] },
  } as never)
  const settings = await h.start()
  expect(h.visible(reviewer)).toEqual(['read'])
  expect(h.visible(plain)).toContain('bash')

  await settings.write({ scope: 'global', values: { toolsDisabled: ['read'] } })
  expect(h.visible(reviewer)).toEqual([])
  expect(h.visible(plain)).not.toContain('read')

  limits = { allow: ['mcp:github'], deny: ['mcp__github__issue'] }
  h.ctx.emit('agent-profiles/changed')
  expect(h.visible(reviewer)).toEqual(['mcp__github__search'])
})

it('keeps an empty expanded profile allowlist distinct from no allowlist', async () => {
  const h = await setup()
  const chat = await h.addAgent('chat-a', '/repo/c')
  let limits: AgentToolLimits = { deny: [] }
  h.ctx.provide('agentProfiles', { toolLimitsFor: () => limits } as never)
  await h.start()
  expect(h.visible(chat)).toContain('read')

  limits = { allow: ['mcp:absent'], deny: [] }
  h.ctx.emit('agent-profiles/changed')
  expect(h.visible(chat)).toEqual([])

  limits = { deny: [] }
  h.ctx.emit('agent-profiles/changed')
  expect(h.visible(chat)).toContain('read')
})

it('applies switches to an agent created later and to MCP tools that register later', async () => {
  const h = await setup()
  const settings = await h.start()
  await settings.write({ scope: 'project', id: PROJECT, values: { toolsDisabled: ['mcp:github'] } })
  const late = await h.addAgent('new-chat', '/repo/c')
  await h.ctx.serial('agent/created' as never, { agent: late, source: 'new' } as never)
  expect(h.visible(late)).toEqual(['bash', 'read'])

  await registerMcpTools(h.ctx, ['pulls'])
  expect(h.visible(late)).toEqual(['bash', 'read'])
  expect(await settings.toolCatalog()).toEqual({ tools: ['bash', 'read'], mcpServers: ['github'] })
})

it('lists the tools a new chat gets from its preset, and releases the preset afterwards', async () => {
  const h = await setup()
  let released = 0
  const key = { id: 'preset-scope' }
  await h.ctx.plugin(Object.assign((inner: Context) => {
    createScope(inner, key).ctx.tools.register(tool('shell'))
  }, { inject: ['tools'] }))
  h.ctx.provide('agentPresets', {
    acquireScope: async () => ({ key, [Symbol.asyncDispose]: async () => { released++ } }),
  } as never)
  const settings = await h.start()
  expect(await settings.toolCatalog()).toEqual({ tools: ['bash', 'read', 'shell'], mcpServers: ['github'] })
  expect(released).toBe(1)
})

it('uses a project mode only while that preset exists', async () => {
  const settings = await (await setup({ presets: [{ id: 'chat' }, { id: 'broken', broken: 'mount failed' }] })).start()
  expect(await settings.resolveMode(PROJECT)).toBeUndefined()
  await settings.write({ scope: 'project', id: PROJECT, values: { mode: 'chat' } })
  expect(await settings.resolveMode(PROJECT)).toBe('chat')
  await settings.write({ scope: 'project', id: PROJECT, values: { mode: 'broken' } })
  expect(await settings.resolveMode(PROJECT)).toBeUndefined()
  await settings.write({ scope: 'project', id: PROJECT, values: { mode: 'removed' } })
  expect(await settings.resolveMode(PROJECT)).toBeUndefined()
  expect(await settings.resolveMode(undefined)).toBeUndefined()
})

it('skips saved built-in coding presets while Coding Tools is disabled without clearing the choice', async () => {
  const h = await setup({ presets: [{ id: 'ptc' }, { id: 'minimal' }, { id: 'standard' }] })
  let enabled = true
  h.ctx.provide('settings', {
    configure: () => () => {},
    describe: () => [{ ns: 'ui-settings', value: { enabled } }],
  } as never)
  const settings = await h.start()
  await settings.write({ scope: 'project', id: PROJECT, values: { mode: 'ptc' } })
  await settings.write({ scope: 'project', id: OTHER, values: { mode: 'minimal' } })
  expect(await settings.resolveMode(PROJECT)).toBe('ptc')

  enabled = false
  expect(await settings.resolveMode(PROJECT)).toBeUndefined()
  expect(await settings.resolveMode(OTHER)).toBeUndefined()
  expect(settings.read({ scope: 'project', id: PROJECT }).mode).toBe('ptc')
  expect(settings.read({ scope: 'project', id: OTHER }).mode).toBe('minimal')

  await settings.write({ scope: 'project', id: OTHER, values: { mode: 'standard' } })
  expect(await settings.resolveMode(OTHER)).toBe('standard')
  enabled = true
  expect(await settings.resolveMode(PROJECT)).toBe('ptc')
})

it('hides skills switched off at any scope from each lookup and lists them per scope with the wider switches', async () => {
  const h = await setup()
  const skill = (folder: string, name: string) => ({ name, description: `${name} skill`, path: `${folder}/${name}/SKILL.md` }) as never
  const all: { name: string; path: string }[] = [
    skill('/home/u/.agents/skills', 'review'), skill('/home/u/.agents/skills', 'deploy'),
    skill('/repo/c/.agents/skills', 'look'), skill('/repo/c/.agents/skills', 'lint'),
  ]
  let filter: { resolve(options: { cwd?: string; scope?: unknown }): ((s: unknown) => boolean) | undefined } | undefined
  let refreshes = 0
  h.ctx.provide('skills', {
    registerFilter: (value: typeof filter) => { filter = value; return () => { filter = undefined } },
    refresh: () => { refreshes += 1 },
    list: async (options: { cwd?: string; scope?: unknown; unfiltered?: boolean }) => {
      const keep = options.unfiltered === true ? undefined : filter?.resolve(options)
      return keep === undefined ? all : all.filter(keep)
    },
  } as never)
  const chat = await h.addAgent('chat-a', '/repo/c')
  const settings = await h.start()
  const names = async (options: { cwd?: string; scope?: unknown }) =>
    (await h.ctx.skills.list(options as never)).map(entry => entry.name)

  await settings.write({ scope: 'global', values: { skillsDisabled: ['deploy'] } })
  await settings.setSwitch({ scope: 'project', id: PROJECT }, 'skillFoldersDisabled', '/repo/c/.agents/skills/', true)
  await settings.setSwitch({ scope: 'session', id: 'chat-a' }, 'skillsDisabled', 'review', true)
  expect(refreshes).toBe(3)
  expect(settings.read({ scope: 'project', id: PROJECT })).toEqual({ skillFoldersDisabled: ['/repo/c/.agents/skills'] })

  expect(await names({ cwd: '/repo/c', scope: chat })).toEqual([])
  expect(await names({ cwd: '/repo/c/src' })).toEqual(['review'])
  expect(await names({ cwd: '/repo/d' })).toEqual(['review', 'look', 'lint'])

  const catalog = await settings.skillCatalog({ scope: 'session', id: 'chat-a' })
  expect(catalog.folders.map(folder => [folder.path, folder.off, folder.offAt, folder.skills.map(s => `${s.name}:${String(s.off)}:${s.offAt ?? '-'}`)])).toEqual([
    ['/home/u/.agents/skills', false, undefined, ['review:true:-', 'deploy:false:global']],
    ['/repo/c/.agents/skills', false, 'project', ['look:false:project', 'lint:false:project']],
  ])

  await settings.setSwitch({ scope: 'project', id: PROJECT }, 'skillFoldersDisabled', '/repo/c/.agents/skills', false)
  expect(await names({ cwd: '/repo/c/src' })).toEqual(['review', 'look', 'lint'])
  await expect(settings.setSwitch({ scope: 'global' }, 'skillFoldersDisabled', 'skills', true)).rejects.toMatchObject({ code: 'scoped-settings/invalid' })
})

it('keeps every concurrent switch', async () => {
  const settings = await (await setup()).start()
  await Promise.all(['a', 'b', 'c'].map(name => settings.setSwitch({ scope: 'project', id: PROJECT }, 'skillsDisabled', name, true)))
  expect(settings.read({ scope: 'project', id: PROJECT })).toEqual({ skillsDisabled: ['a', 'b', 'c'] })
})

it('normalizes hand-edited skill folders when the document loads', async () => {
  const h = await setup()
  writeFileSync(join(h.dir, 'edited.json'), JSON.stringify({ version: 1, global: { skillFoldersDisabled: ['/home/u/skills/', '/home/u/x/../skills'] }, projects: {}, sessions: {} }))
  const settings = await (await setup({ file: join(h.dir, 'edited.json') })).start()
  expect(settings.read({ scope: 'global' })).toEqual({ skillFoldersDisabled: ['/home/u/skills'] })
})
