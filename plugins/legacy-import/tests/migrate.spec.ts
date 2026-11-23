import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { apply } from '../index.mjs'
import { readJanKey } from '../jan-secrets.mjs'
import { migrationPreview, registerMigrateTools } from '../migrate.mjs'

vi.mock(import('../jan-secrets.mjs'), async importOriginal => ({
  ...(await importOriginal()),
  readJanKey: vi.fn(async (_folder: string, id: string) => ({ key: `${id}-test-key`, source: 'file' })),
}))

const roots: string[] = []
afterEach(async () => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

type Question = { id: string; detail?: string; multiSelect?: boolean; options: { label: string }[] }
type Tool = { name: string; execute(args: object, exec: object): Promise<Record<string, unknown>> }

async function janMigration(select: (labels: string[], source: string) => string[] | Promise<string[]>) {
  const home = await mkdtemp(join(tmpdir(), 'jan-migrate-'))
  roots.push(home)
  for (const name of ['HOME', 'APPDATA', 'XDG_DATA_HOME']) vi.stubEnv(name, home)
  const source = process.platform === 'darwin' ? join(home, 'Library', 'Application Support', 'Jan', 'data') : join(home, 'Jan', 'data')
  await mkdir(source, { recursive: true })
  const tools = new Map<string, Tool>()
  const writeRoutes = vi.fn()
  const writeKey = vi.fn()
  const writeMcp = vi.fn(async () => ({ added: ['connector'] }))
  const services: Record<string, unknown> = {
    userQuestions: {
      ask: async ({ questions: [question] }: { questions: Question[] }) => ({
        answers: [{ id: question.id, selected: await select(question.options.map(option => option.label), source) }],
      }),
    },
    settings: { describe: () => [{ ns: 'llm-pi-ai', value: { providers: {} } }], mutate: writeRoutes },
    credentials: { describe: async () => ({ configured: false }), set: writeKey },
    janMcpSettings: { configuredNames: () => [], importMissing: writeMcp },
  }
  const createSession = vi.fn(async () => ({ append: async () => {}, flush: async () => {}, close: async () => {} }))
  apply({
    fiber: {},
    sessions: { get: () => undefined, prepare: (id: string) => ({ header: { id }, inheritedEventCount: 0 }) },
    sessionPersistence: { stat: async () => undefined, create: createSession },
    workspaceRegistry: {},
    workspaceController: { initializeDefault: async () => {} },
    effect: () => {},
    inject: ([service]: string[], install: (ctx: object) => void) => {
      if (service === 'tools') install({
        tools: { register: (tool: Tool) => { tools.set(tool.name, tool) } },
        effect: (register: () => Iterable<unknown>) => { for (const _ of register()) { /* Install each registration. */ } },
        get: (name: string) => services[name],
      })
    },
    get: (name: string) => services[name],
  })
  return { source, writeRoutes, writeKey, writeMcp, createSession, execute: () => tools.get('migrate_import')!.execute({ source: 'jan' }, {}) }
}

const writeMcpConfig = (source: string, mcpServers: object) => writeFile(join(source, 'mcp_config.json'), JSON.stringify({ mcpServers }))
const writeChat = async (source: string, id: string) => {
  const folder = join(source, 'threads', id)
  await mkdir(folder, { recursive: true })
  await writeFile(join(folder, 'thread.json'), JSON.stringify({ id, title: id, created: 1000 }))
  await writeFile(join(folder, 'messages.jsonl'), JSON.stringify({ id: 'msg', role: 'user', created_at: 1000000, content: [{ type: 'text', text: { value: 'Hello' } }] }))
}
const settings = {
  providers: [], assistants: [],
  mcp: {
    found: true, files: [], issues: [], names: ['connector'],
    rows: [
      { name: 'connector', sourceName: 'connector', credentials: 2, status: 'ready', omitted: [] },
      { name: 'existing', sourceName: 'existing', credentials: 1, status: 'already here', omitted: [] },
    ],
    skipped: [{ sourceName: 'legacy', reason: 'unsupported transport' }],
  },
}

it('reports connectors even when the coding agent has no chats and omits chat contents', async () => {
  const preview = await migrationPreview(async () => ({ threads: [], missing: true, settings }), { source: 'claude' })
  expect(preview.sources[0]).toMatchObject({ app: 'Claude Code', found: true, ready: 0, days: 30, settings })

  const chatPreview = await migrationPreview(async () => ({ threads: [{ title: 'private chat title', messageCount: 1 }], settings }), { source: 'jan' })
  expect(chatPreview.sources[0]).toMatchObject({ ready: 1 })
  expect(JSON.stringify(chatPreview)).not.toContain('private chat title')
})

it('ticks every ready item in one form and imports only what the user leaves ticked', async () => {
  const tools = new Map<string, Tool>()
  const asked: Question[] = []
  const calls: object[] = []
  const now = Date.now()
  const listed = {
    folder: '/home/me/.omp/agent/sessions',
    threads: [
      { id: 'recent', updated: now, messageCount: 1 },
      { id: 'old', updated: now - 90 * 24 * 60 * 60 * 1000, messageCount: 1 },
      { id: 'here', updated: now, messageCount: 1, alreadyImported: true },
    ],
    settings: {
      ...settings,
      skills: {
        looked: ['/home/me/.omp/agent/skills'], target: '/jan/skills',
        skills: [{ name: 'writer', status: 'ready' }, { name: 'shared', status: 'already here' }],
        instructions: { name: 'AGENTS.md', target: '/jan/AGENTS.md', status: 'ready' },
        others: [{ label: 'OMP plugins', names: ['gitingest'] }],
      },
    },
  }
  registerMigrateTools({
    tools: { register: (tool: Tool) => { tools.set(tool.name, tool) } },
    effect: (register: () => Iterable<unknown>) => { for (const _ of register()) { /* Install each registration. */ } },
    get: () => ({
      ask: async ({ questions }: { questions: Question[] }) => {
        asked.push(...questions)
        // The user unticks the MCP server and keeps the other recommended items.
        const selected = questions[0].options.map(option => option.label).filter(label => label.endsWith('(Recommended)') && !label.includes('connector'))
        return { answers: [{ id: 'migrate', selected }] }
      },
    }),
  }, {
    list: async () => listed,
    importSelected: async (params: object) => {
      calls.push(params)
      return { results: [{ id: 'recent', status: 'imported' }], settings: {} }
    },
  })
  const result = await tools.get('migrate_import')?.execute({ source: 'omp' }, {})
  const labels = asked[0].options.map(option => option.label)
  expect(asked[0].multiSelect).toBe(true)
  expect(labels).toEqual([
    '1 chat from the last 30 days (Recommended)', '1 older chat', 'MCP server connector (Recommended)',
    '1 skill (Recommended)', 'Global instructions AGENTS.md (Recommended)',
  ])
  expect(asked[0].detail).toContain('/home/me/.omp/agent/skills')
  expect(asked[0].detail).toContain('OMP plugins: gitingest')
  expect(asked[0].detail).toContain('legacy (unsupported transport)')
  expect(calls).toEqual([{
    source: 'omp', folder: listed.folder, ids: ['recent'], providerIds: [], assistantIds: [],
    mcp: false, mcpNames: [], skills: true, skillNames: ['writer'], instructions: true,
  }])
  expect(result).toMatchObject({ imported: 1, left: ['1 older chat', 'MCP server connector'] })
})

it('imports only the checked provider and never reads the unchecked provider key', async () => {
  const { source, execute, writeRoutes, writeKey } = await janMigration(labels => {
    expect(labels).toContain('Model provider anthropic (Recommended)')
    return labels.filter(label => label.includes('openai'))
  })
  const providers = [{ provider: 'openai' }, { provider: 'anthropic' }]
  await writeFile(join(source, 'settings.json'), JSON.stringify({ 'model-provider': JSON.stringify({ state: { providers } }) }))
  await writeFile(join(source, 'provider_secrets.index.json'), JSON.stringify(['openai', 'anthropic']))

  expect(await execute()).toMatchObject({ chosen: ['Model provider openai'], left: ['Model provider anthropic'], settings: { providers: [{ id: 'openai', key: 'imported' }] } })
  expect(vi.mocked(readJanKey).mock.calls.map(([, id]) => id)).toEqual(['openai'])
  expect(writeRoutes).toHaveBeenCalledExactlyOnceWith('llm-pi-ai', [expect.objectContaining({ path: ['providers', 'openai'] })])
  expect(writeKey).toHaveBeenCalledExactlyOnceWith(expect.anything(), 'openai-test-key')
})

it('refuses to import a selected connector whose definition changed after the form opened', async () => {
  const { source, execute, writeMcp } = await janMigration(async (labels, folder) => {
    expect(labels).toEqual(['MCP server connector (Recommended)'])
    await writeMcpConfig(folder, { connector: { url: 'https://changed.example.com/mcp', headers: { Token: 'new-value' } } })
    return labels
  })
  await writeMcpConfig(source, { connector: { url: 'https://original.example.com/mcp', headers: { Token: 'original-value' } } })

  await expect(execute()).rejects.toThrow(/MCP.*changed.*try again/i)
  expect(writeMcp).not.toHaveBeenCalled()
})

it('does not import a connector that appeared after the form opened', async () => {
  const connector = { command: 'fixture-connector' }
  const { source, execute, writeMcp } = await janMigration(async (labels, folder) => {
    expect(labels).toEqual(['MCP server connector (Recommended)'])
    await writeMcpConfig(folder, { added: { command: 'another-connector' }, connector })
    return labels
  })
  await writeMcpConfig(source, { connector })

  expect(await execute()).toMatchObject({ settings: { mcp: { imported: 1, names: ['connector'] } } })
  expect(writeMcp).toHaveBeenCalledExactlyOnceWith({ connector: expect.objectContaining(connector) })
})

it('imports only the chats counted in the selected form option', async () => {
  const { source, execute, createSession } = await janMigration(async (labels, folder) => {
    expect(labels).toEqual(['1 chat (Recommended)'])
    await writeChat(folder, 'new-chat')
    return labels
  })
  await writeChat(source, 'reviewed-chat')

  expect(await execute()).toMatchObject({ imported: 1, failed: [] })
  expect(createSession).toHaveBeenCalledExactlyOnceWith({ id: 'jan-reviewed-chat' })
})
