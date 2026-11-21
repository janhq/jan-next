// The /migrate skill and its two tools: an agent-led import from the earlier
// Jan app and from Claude Code, Codex and OMP. The tools reuse the importer the
// Settings card runs, so a chat brought over by either path is the same chat.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { BUNDLED_SKILL_RANK } from '@janhq/jan-skill'

export const SOURCES = ['jan', 'claude', 'codex', 'omp']
const NAMES = { jan: 'the earlier Jan app', claude: 'Claude Code', codex: 'Codex', omp: 'OMP' }
const DAY = 24 * 60 * 60 * 1000
const DEFAULT_DAYS = 30
const SKILL = 'migrate'
const PROVIDER = 'jan-legacy-import'
const EXAMPLES = 5
const errorText = error => error instanceof Error ? error.message : String(error)
const eligible = (source, thread) => !thread.error && !thread.alreadyImported && (source !== 'jan' || thread.messageCount > 0)
const days = value => Number.isInteger(value) && value > 0 ? value : DEFAULT_DAYS

/**
 * Register the bundled /migrate skill.
 * @param {any} ctx Plugin context with `skills`.
 * @param {string} [root] Folder holding `migrate/SKILL.md`.
 */
export function registerMigrateSkill(ctx, root = fileURLToPath(new URL('./skills/', import.meta.url))) {
  const candidate = {
    name: SKILL, provider: PROVIDER, source: 'bundled', rank: BUNDLED_SKILL_RANK,
    description: 'Bring chats and settings over from the earlier Jan app, Claude Code, Codex or OMP. Scans this computer, asks what to bring, imports after the user approves, then reports what came over.',
    invocation: { modelInvocable: true, userInvocable: true },
    resourceBase: { kind: 'directory', path: join(root, SKILL) },
    locator: join(root, SKILL, 'SKILL.md'),
  }
  return ctx.skills.registerProvider(() => ({
    name: PROVIDER,
    list: async () => [candidate],
    async get(item, options = {}) {
      if (item.name !== SKILL) return undefined
      const body = await readFile(candidate.locator, { encoding: 'utf8', signal: options.signal })
      return { ...candidate, content: body.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/u, '').trim() }
    },
  }))
}

/**
 * Register `migrate_scan` and `migrate_import`, and ask the user before an import runs.
 * @param {any} ctx Plugin context with `tools`.
 * @param {{ list: (request: object) => Promise<any>, importSelected: (request: object) => Promise<any> }} importer The importer the Settings card uses.
 */
export function registerMigrateTools(ctx, { list, importSelected }) {
  // One source's chats in the window, newest first, with what is already here.
  const scanSource = async (source, window) => {
    const since = source === 'jan' ? undefined : Date.now() - window * DAY
    let listed
    try { listed = await list({ source, since }) } catch (error) {
      if (error?.code === 'ENOENT') return { source, app: NAMES[source], found: false }
      return { source, app: NAMES[source], found: false, error: errorText(error) }
    }
    if (listed.missing) return { source, app: NAMES[source], found: false }
    const ready = listed.threads.filter(thread => eligible(source, thread))
    const row = {
      source, app: NAMES[source], found: true, folder: listed.folder,
      ready: ready.length,
      alreadyImported: listed.threads.filter(thread => thread.alreadyImported).length,
      unreadable: listed.threads.filter(thread => thread.error).length,
      examples: ready.slice(0, EXAMPLES).map(thread => thread.title),
    }
    if (source !== 'jan') return { ...row, days: window, olderThanWindow: listed.older ?? 0 }
    const settings = listed.settings ?? {}
    return {
      ...row,
      settings: {
        providers: (settings.providers ?? []).map(item => item.id),
        mcpServers: settings.mcp?.names ?? [],
        assistants: (settings.assistants ?? []).filter(item => !item.alreadyImported).map(item => item.name),
      },
    }
  }
  // The ids one import covers, resolved here so the model never copies a long id list.
  const selection = async ({ source, days: window, ids }) => {
    const listed = await list({ source, since: source === 'jan' ? undefined : Date.now() - days(window) * DAY })
    const ready = listed.threads.filter(thread => eligible(source, thread))
    if (!Array.isArray(ids) || !ids.length) return ready.map(thread => thread.id)
    const known = new Set(ready.map(thread => thread.id))
    return ids.filter(id => known.has(id))
  }
  const describe = async args => {
    const parts = []
    const count = args.chats === false ? 0 : (await selection(args)).length
    if (count) parts.push(`${count} ${count === 1 ? 'chat' : 'chats'}${args.source === 'jan' ? '' : ` from the last ${days(args.days)} days`}`)
    const settings = [args.providers && 'model providers and their keys', args.mcp && 'MCP servers', args.assistants && 'assistants'].filter(Boolean)
    if (settings.length) parts.push(settings.join(', '))
    return `Import ${parts.join(' and ') || 'nothing'} from ${NAMES[args.source]} into Jan? The source folder is only read, never changed.`
  }
  const scan = {
    name: 'migrate_scan',
    description: 'Find chats and settings that can come over from the earlier Jan app, Claude Code, Codex and OMP on this computer. Read-only. Returns, per app, whether it was found, how many chats are ready to import, how many are already here, a few example titles and, for Jan, the model providers, MCP servers and assistants it holds.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        source: { type: 'string', enum: SOURCES, description: 'Scan one app; omit to scan all four.' },
        days: { type: 'integer', minimum: 1, description: `For Claude Code, Codex and OMP, count sessions updated in this many recent days. Defaults to ${DEFAULT_DAYS}.` },
      },
    },
    output: { schema: {}, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args) {
      const sources = args?.source ? [args.source] : SOURCES
      return { sources: await Promise.all(sources.map(source => scanSource(source, days(args?.days)))) }
    },
    presentCall: () => ({ card: 'generic', title: 'Look for chats to bring over', kind: 'search' }),
  }
  const run = {
    name: 'migrate_import',
    description: 'Import chats, and for the earlier Jan app also its settings, into Jan. Jan asks the user to approve each call; run it only after the user chose what to bring. Without ids it imports every chat migrate_scan reported as ready for that app (for Claude Code, Codex and OMP, those updated in the last `days`). Chats already here are skipped. Returns counts and every failure with its reason.',
    parameters: {
      type: 'object', additionalProperties: false, required: ['source'],
      properties: {
        source: { type: 'string', enum: SOURCES, description: 'The app to import from. One app per call.' },
        chats: { type: 'boolean', description: 'Import chats. Defaults to true; set false to bring only Jan settings.' },
        days: { type: 'integer', minimum: 1, description: `Claude Code, Codex and OMP only: import sessions updated in this many recent days. Defaults to ${DEFAULT_DAYS}.` },
        ids: { type: 'array', items: { type: 'string' }, description: 'Import only these chat ids; omit to import all ready chats.' },
        providers: { type: 'boolean', description: 'Jan only: bring model providers and their API keys.' },
        mcp: { type: 'boolean', description: 'Jan only: bring MCP servers.' },
        assistants: { type: 'boolean', description: 'Jan only: bring assistants as agent presets.' },
      },
    },
    output: { schema: {}, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args) {
      if (args.source !== 'jan' && (args.providers || args.mcp || args.assistants)) throw new Error('Settings come only from the earlier Jan app.')
      const ids = args.chats === false ? [] : await selection(args)
      if (!ids.length && !args.providers && !args.mcp && !args.assistants) return { imported: 0, note: 'Nothing new to import from this app.' }
      const { results, settings } = await importSelected({ source: args.source, ids, providers: args.providers === true, mcp: args.mcp === true, assistants: args.assistants === true })
      const count = status => results.filter(result => result.status === status).length
      return {
        imported: count('imported'), alreadyHere: count('already imported'), emptySkipped: count('skipped'),
        failed: results.filter(result => result.status === 'failed').map(result => ({ id: result.id, reason: result.reason })),
        partlyConverted: results.filter(result => result.losses?.length).length,
        ...args.source === 'jan' ? { settings } : {},
      }
    },
    presentCall: args => ({ card: 'generic', title: `Import from ${NAMES[args?.source] ?? 'another app'}`, kind: 'edit' }),
  }
  return ctx.effect(function* () {
    yield ctx.tools.register(scan)
    yield ctx.tools.register(run)
    yield ctx.on('tools/pre-execute', async (exec, next) => {
      const decision = await next()
      if (decision.kind !== 'allow' || exec.name !== 'migrate_import') return decision
      if (exec.agent !== undefined && approvalPolicy(ctx, exec.agent.session) === 'never') return decision
      const args = exec.arguments ?? {}
      let reason
      try { reason = await describe(args) } catch (error) { reason = `Import from ${NAMES[args.source] ?? 'another app'} into Jan? (${errorText(error)})` }
      return { kind: 'ask', reason }
    })
  }, 'legacy-import: /migrate tools')
}

// Full access sets the Session's approval policy to never, which rejects every ask; it already grants the import.
function approvalPolicy(ctx, session) {
  const approval = ctx.get('approval')
  return approval === undefined ? undefined : approval.overrideOf(session) ?? approval.config.policy ?? 'ask'
}
