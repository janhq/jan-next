/** Scoped settings: stored values per scope, project defaults, and tool switches applied to live agents. */
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@janhq/cordis'
import type { Agent } from '@janhq/jan-agent'
import { createScope } from '@janhq/jan-scope'
import { SessionId } from '@janhq/jan-session'
import SystemPrompt from '@janhq/jan-system-prompt'
import ToolRuntime, { defineTool } from '@janhq/jan-tools'
import type { Workspace, WorkspaceId } from '@janhq/jan-workspace'
import ScopedSettings from '../src/index.ts'

const mcpServers = vi.hoisted(() => new Map<string, string>())
vi.mock('@janhq/jan-mcp-client', () => ({
  mcpToolOrigin: (definition: { name: string }) => {
    const serverName = mcpServers.get(definition.name)
    return serverName === undefined ? undefined : { serverName, rawName: definition.name }
  },
}))

const roots: Context[] = []
const dirs: string[] = []
afterEach(async () => {
  for (const ctx of roots.splice(0)) await ctx.fiber.dispose()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  mcpServers.clear()
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
  for (const name of ['bash', 'read', 'github_search', 'github_issue']) ctx.tools.register(tool(name))
  mcpServers.set('github_search', 'github').set('github_issue', 'github')
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

it('removes a key on null or an empty list, and drops a scope with nothing left', async () => {
  const h = await setup()
  const settings = await h.start()
  await settings.write({ scope: 'project', id: PROJECT, values: { mode: 'chat', toolsDisabled: ['bash'] } })
  await settings.write({ scope: 'project', id: PROJECT, values: { mode: null } })
  expect(settings.read({ scope: 'project', id: PROJECT })).toEqual({ toolsDisabled: ['bash'] })
  await settings.write({ scope: 'project', id: PROJECT, values: { toolsDisabled: [] } })
  expect(JSON.parse(readFileSync(h.file, 'utf8'))).toEqual({ version: 1, global: {}, projects: {}, sessions: {} })
})

it('refuses keys a scope does not store and projects that do not exist', async () => {
  const settings = await (await setup()).start()
  await expect(settings.write({ scope: 'global', values: { model: { provider: 'p', model: 'm' } } }))
    .rejects.toMatchObject({ code: 'scoped-settings/invalid' })
  await expect(settings.write({ scope: 'session', id: 'chat-a', values: { mode: 'chat' } }))
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
  const all = ['bash', 'github_issue', 'github_search', 'read']
  expect(h.visible(inProject)).toEqual(all)

  await settings.write({ scope: 'global', values: { toolsDisabled: ['read'] } })
  await settings.write({ scope: 'project', id: PROJECT, values: { toolsDisabled: ['mcp:github'] } })
  await settings.write({ scope: 'session', id: 'chat-a', values: { toolsDisabled: ['bash'] } })
  expect(settings.resolveToolsDisabled(SessionId('chat-a'))).toEqual(['bash', 'mcp:github', 'read'])
  expect(h.visible(inProject)).toEqual([])
  expect(h.visible(elsewhere)).toEqual(['bash', 'github_issue', 'github_search'])

  await settings.write({ scope: 'project', id: PROJECT, values: { toolsDisabled: null } })
  await settings.write({ scope: 'global', values: { toolsDisabled: null } })
  expect(h.visible(inProject)).toEqual(['github_issue', 'github_search', 'read'])
  expect(h.visible(elsewhere)).toEqual(all)
})

it('applies switches to an agent created later and to MCP tools that register later', async () => {
  const h = await setup()
  const settings = await h.start()
  await settings.write({ scope: 'project', id: PROJECT, values: { toolsDisabled: ['mcp:github'] } })
  const late = await h.addAgent('new-chat', '/repo/c')
  await h.ctx.serial('agent/created' as never, { agent: late, source: 'new' } as never)
  expect(h.visible(late)).toEqual(['bash', 'read'])

  mcpServers.set('github_pulls', 'github')
  h.ctx.tools.register(tool('github_pulls'))
  expect(h.visible(late)).toEqual(['bash', 'read'])
  expect(settings.toolCatalog()).toEqual({ tools: ['bash', 'read'], mcpServers: ['github'] })
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
