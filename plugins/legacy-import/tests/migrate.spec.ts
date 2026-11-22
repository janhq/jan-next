import { expect, it } from 'vitest'
import { migrationPreview, registerMigrateTools } from '../migrate.mjs'

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
  type Question = { id: string; detail?: string; multiSelect?: boolean; options: { label: string }[] }
  type Tool = { name: string; execute(args: object, exec: object): Promise<Record<string, unknown>> }
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
    source: 'omp', ids: ['recent'], providers: false, assistants: false,
    mcp: false, mcpNames: [], skills: true, skillNames: ['writer'], instructions: true,
  }])
  expect(result).toMatchObject({ imported: 1, left: ['1 older chat', 'MCP server connector'] })
})
