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

it('lists the actual MCP selection in approval and imports without requiring chat IDs', async () => {
  type Arguments = { source: string; chats: boolean; mcp: boolean }
  type Decision = { kind: string; reason?: string }
  type Tool = { name: string; execute(args: Arguments): Promise<object> }
  type Listener = (exec: { name: string; arguments: Arguments }, next: () => Promise<Decision>) => Promise<Decision>
  const tools = new Map<string, Tool>()
  let before: Listener | undefined
  const calls: object[] = []
  registerMigrateTools({
    tools: { register: (tool: Tool) => { tools.set(tool.name, tool) } },
    effect: (register: () => Iterable<unknown>) => { for (const _ of register()) { /* Install each registration. */ } },
    on: (_event: string, listener: Listener) => { before = listener },
  }, {
    list: async () => ({ threads: [], settings }),
    importSelected: async (params: object) => {
      calls.push(params)
      return { results: [], settings: { mcp: { imported: 1 } } }
    },
  })
  const args = { source: 'claude-desktop', chats: false, mcp: true }
  const decision = await before?.({ name: 'migrate_import', arguments: args }, async () => ({ kind: 'allow' }))
  expect(decision?.kind).toBe('ask')
  expect(decision?.reason).toContain('connector (2 masked credentials)')
  expect(decision?.reason).toContain('legacy (unsupported transport)')
  expect(decision?.reason).not.toContain('existing')
  expect(await tools.get('migrate_import')?.execute(args)).toMatchObject({ imported: 0, settings: { mcp: { imported: 1 } } })
  expect(calls).toEqual([{ source: 'claude-desktop', ids: [], providers: false, assistants: false, mcp: true }])
})
