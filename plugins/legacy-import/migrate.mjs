// The /migrate skill, its shared preview, and the tools that use the Settings importer.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { BUNDLED_SKILL_RANK } from '@janhq/jan-skill'
import { CONNECTORS_ONLY, MCP_SOURCES, SOURCE_NAMES } from './mcp.mjs'

const DAY = 24 * 60 * 60 * 1000
export const DEFAULT_MIGRATION_DAYS = 30
const SKILL = 'migrate'
const PROVIDER = 'jan-legacy-import'
const eligible = (source, thread) => !thread.error && !thread.alreadyImported && (source !== 'jan' || thread.messageCount > 0)
const days = value => Number.isSafeInteger(value) && value > 0 ? value : DEFAULT_MIGRATION_DAYS
const since = (source, window) => source === 'jan' || CONNECTORS_ONLY.includes(source) ? undefined : Date.now() - days(window) * DAY

const NOT_MOVED = ['Plugin and extension installations', 'App-managed OAuth sign-ins and cloud-only connectors', 'MCP commands or helpers that fetch credentials during setup', 'App settings not listed here']
const CHAT_EXCLUSIONS = {
  jan: 'Audio, video, remote images, per-chat tool settings, streaming timings and assistant sampling settings',
  agent: 'Images, sub-agent side conversations and encrypted reasoning',
}

/**
 * Summarize exactly what is ready and what stays behind, without exposing credential values.
 * @param {Function} list Read-only importer list function.
 * @param {object} [options] One source or all sources, with an optional chat time window.
 * @returns {Promise<object>} One redacted summary per requested source.
 */
export async function migrationPreview(list, { source, days: window } = {}) {
  const sources = source ? [source] : MCP_SOURCES
  if (sources.some(id => !MCP_SOURCES.includes(id))) throw new Error('Choose a supported migration source.')
  return { sources: await Promise.all(sources.map(async id => {
    const connectorOnly = CONNECTORS_ONLY.includes(id)
    const excluded = [...NOT_MOVED, connectorOnly ? 'Chat history' : CHAT_EXCLUSIONS[id === 'jan' ? 'jan' : 'agent']]
    const base = { source: id, app: SOURCE_NAMES[id], found: false, ready: 0, alreadyImported: 0, unreadable: 0, emptySkipped: 0, excluded }
    try {
      const { threads, settings, missing, folder, older, chatError } = await list({ source: id, since: since(id, window) })
      const ready = threads.filter(thread => eligible(id, thread)).length
      return {
        ...base, found: Boolean(settings?.mcp.found || (!connectorOnly && !missing)), folder, settings,
        ready,
        alreadyImported: threads.filter(thread => thread.alreadyImported).length,
        unreadable: threads.filter(thread => thread.error).length,
        emptySkipped: threads.filter(thread => !thread.error && !thread.alreadyImported && thread.messageCount === 0).length,
        ...(chatError ? { error: chatError } : {}),
        ...(id !== 'jan' && !connectorOnly ? { days: days(window), olderThanWindow: older ?? 0 } : {}),
      }
    } catch { return { ...base, error: 'Could not scan this source. Check its files and try again.' } }
  })) }
}

/**
 * Register the bundled /migrate skill.
 * @param {any} ctx Plugin context with `skills`.
 * @param {string} [root] Folder holding `migrate/SKILL.md`.
 */
export function registerMigrateSkill(ctx, root = fileURLToPath(new URL('./skills/', import.meta.url))) {
  const candidate = {
    name: SKILL, provider: PROVIDER, source: 'bundled', rank: BUNDLED_SKILL_RANK,
    description: 'Preview and import chats, MCP servers and connectors with configured credentials, and supported settings from other apps.',
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
  const selectedIds = ({ source, chats, ids }, listed) => {
    if (chats === false || CONNECTORS_ONLY.includes(source)) return []
    const ready = listed.threads.filter(thread => eligible(source, thread)).map(thread => thread.id)
    if (!Array.isArray(ids)) return ready
    const known = new Set(ready)
    return [...new Set(ids.filter(id => known.has(id)))]
  }
  const describe = async args => {
    const listed = await list({ source: args.source, since: since(args.source, args.days) })
    const count = selectedIds(args, listed).length
    const parts = [`${count} ${count === 1 ? 'chat' : 'chats'}`]
    const settings = listed.settings
    const masks = count => count ? ` (${count} masked ${count === 1 ? 'credential' : 'credentials'})` : ''
    const mcp = args.mcp ? settings?.mcp.rows.filter(row => row.status === 'ready').map(row => row.name + masks(row.credentials)) : []
    const providers = args.providers ? settings?.providers.filter(row => !row.alreadyImported || (row.hasKey && !row.keyAlreadyConfigured))
      .map(row => row.id + masks(row.hasKey && !row.keyAlreadyConfigured ? 1 : 0)) : []
    const assistants = args.assistants ? settings?.assistants.filter(row => !row.alreadyImported).map(row => row.name) : []
    if (mcp?.length) parts.push(`MCP servers (added disabled): ${mcp.join(', ')}`)
    if (providers?.length) parts.push(`Model providers: ${providers.join(', ')}`)
    if (assistants?.length) parts.push(`Assistants: ${assistants.join(', ')}`)
    const skipped = args.mcp ? settings?.mcp.skipped.map(row => `${row.sourceName} (${row.reason})`) : []
    if (skipped?.length) parts.push(`MCP servers left behind: ${skipped.join(', ')}`)
    return `Import from ${SOURCE_NAMES[args.source]}? ${parts.join('; ')}. Installed plugins, OAuth sign-ins, and unlisted settings stay behind. Source files are never changed.`
  }
  const scan = {
    name: 'migrate_scan',
    description: 'Read-only preview of chats, named MCP servers and connectors, masked credential counts, and supported settings from Earlier Jan, Claude Code, Claude Desktop, Codex, OMP and Cursor. Returns ready and already imported items, skipped entries with reasons, and what cannot be migrated.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        source: { type: 'string', enum: MCP_SOURCES, description: 'Scan one app; omit to scan all supported apps.' },
        days: { type: 'integer', minimum: 1, description: `For Claude Code, Codex and OMP, count sessions updated in this many recent days. Defaults to ${DEFAULT_MIGRATION_DAYS}.` },
      },
    },
    output: { schema: {}, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: args => migrationPreview(list, args),
    presentCall: () => ({ card: 'generic', title: 'Preview chats, MCP servers, and settings', kind: 'search' }),
  }
  const run = {
    name: 'migrate_import',
    description: 'Import approved chats, MCP servers and configured credentials, and supported settings into Jan. Run only after the user chooses what to bring. Without ids, imports all ready chats in the chosen window. MCP servers arrive disabled and existing names are kept. Returns the actual result per item.',
    parameters: {
      type: 'object', additionalProperties: false, required: ['source'],
      properties: {
        source: { type: 'string', enum: MCP_SOURCES, description: 'The app to import from. One app per call.' },
        chats: { type: 'boolean', description: 'Import chats when the source supports them. Defaults to true; set false to import only MCP servers or settings.' },
        days: { type: 'integer', minimum: 1, description: `Claude Code, Codex and OMP only: import sessions updated in this many recent days. Defaults to ${DEFAULT_MIGRATION_DAYS}.` },
        ids: { type: 'array', items: { type: 'string' }, description: 'Import only these chat ids; omit to import all ready chats.' },
        providers: { type: 'boolean', description: 'Jan only: bring model providers and their API keys.' },
        mcp: { type: 'boolean', description: 'Bring configured MCP servers and connectors, including their env and header credentials.' },
        assistants: { type: 'boolean', description: 'Jan only: bring assistants as agent presets.' },
      },
    },
    output: { schema: {}, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args) {
      if (args.source !== 'jan' && (args.providers || args.assistants)) throw new Error('Model providers and assistants come only from the earlier Jan app.')
      const listed = await list({ source: args.source, since: since(args.source, args.days) })
      const ids = selectedIds(args, listed)
      const requested = Array.isArray(args.ids) ? new Set(args.ids) : undefined
      const already = args.chats === false ? 0 : listed.threads.filter(thread => thread.alreadyImported && (!requested || requested.has(thread.id))).length
      if (!ids.length && !args.providers && !args.mcp && !args.assistants) return { imported: 0, alreadyHere: already, note: 'Nothing new to import from this app.' }
      const { results, settings } = await importSelected({ source: args.source, ids, providers: args.providers === true, mcp: args.mcp === true, assistants: args.assistants === true })
      const count = status => results.filter(result => result.status === status).length
      return {
        imported: count('imported'), alreadyHere: already + count('already imported'), emptySkipped: count('skipped'),
        failed: results.filter(result => result.status === 'failed').map(result => ({ id: result.id, reason: result.reason })),
        partlyConverted: results.filter(result => result.losses?.length).length,
        losses: [...new Set(results.flatMap(result => result.losses ?? []))],
        settings,
      }
    },
    presentCall: args => ({ card: 'generic', title: `Import from ${SOURCE_NAMES[args?.source] ?? 'another app'}`, kind: 'edit' }),
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
      try { reason = await describe(args) } catch { return { kind: 'deny', reason: 'Could not review the migration selection. Scan the source again before importing.' } }
      return { kind: 'ask', reason }
    })
  }, 'legacy-import: /migrate tools')
}

// Full access sets the Session's approval policy to never, which rejects every ask; it already grants the import.
function approvalPolicy(ctx, session) {
  const approval = ctx.get('approval')
  return approval === undefined ? undefined : approval.overrideOf(session) ?? approval.config.policy ?? 'ask'
}
