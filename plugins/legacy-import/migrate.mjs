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
    description: 'Preview and import chats, MCP servers and connectors with configured credentials, skills, global instructions, and supported settings from other apps.',
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
 * The ticked-by-default choices for one app, and what each choice imports.
 * @param {object} listed Importer list result for the whole history, so older chats can be offered.
 * @param {string} source App id.
 * @param {number} window Chat window in days.
 * @returns {{ options: { label: string, description?: string, recommended: boolean, pick: object }[], detail: string }} Form options and the markdown shown above them.
 */
export function migrationForm(listed, source, window) {
  const options = []
  const add = (label, description, recommended, pick) => options.push({ label: recommended ? `${label} (Recommended)` : label, description, recommended, pick })
  const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`
  const ready = listed.threads.filter(thread => eligible(source, thread))
  const cutoff = since(source, window)
  const recent = cutoff === undefined ? ready : ready.filter(thread => (thread.updated ?? 0) >= cutoff)
  const older = cutoff === undefined ? [] : ready.filter(thread => (thread.updated ?? 0) < cutoff)
  if (recent.length) add(cutoff === undefined ? plural(recent.length, 'chat') : `${plural(recent.length, 'chat')} from the last ${window} days`, 'They open in Chats, in the project folder each one ran in.', true, { ids: recent.map(thread => thread.id) })
  if (older.length) add(`${plural(older.length, 'older chat')}`, `Updated more than ${window} days ago.`, false, { ids: older.map(thread => thread.id) })
  const settings = listed.settings
  const masks = count => count ? `, ${plural(count, 'masked credential')}` : ''
  for (const row of settings?.mcp.rows.filter(item => item.status === 'ready') ?? []) {
    add(`MCP server ${row.name}`, `Added turned off, so you can review it in Settings first${masks(row.credentials)}.`, true, { mcp: [row.name] })
  }
  for (const row of settings?.providers.filter(item => !item.alreadyImported || (item.hasKey && !item.keyAlreadyConfigured)) ?? []) {
    add(`Model provider ${row.id}`, row.hasKey && !row.keyAlreadyConfigured ? 'With its saved API key.' : undefined, true, { providers: true })
  }
  const assistants = settings?.assistants.filter(item => !item.alreadyImported) ?? []
  if (assistants.length) add(plural(assistants.length, 'assistant'), `As agent presets: ${assistants.map(item => item.name).join(', ')}.`, true, { assistants: true })
  const skills = settings?.skills
  const readySkills = skills?.linked ? [] : skills?.skills?.filter(row => row.status === 'ready') ?? []
  if (readySkills.length) add(plural(readySkills.length, 'skill'), `Copied into ${skills.target}: ${readySkills.slice(0, 6).map(row => row.name).join(', ')}${readySkills.length > 6 ? ', …' : ''}.`, true, { skills: readySkills.map(row => row.name) })
  if (skills?.instructions?.status === 'ready') add(`Global instructions ${skills.instructions.name}`, `Copied to ${skills.instructions.target}.`, true, { instructions: true })

  const lines = []
  const looked = [listed.folder, ...(settings?.mcp.files ?? []), ...(skills?.looked ?? [])].filter(Boolean)
  if (looked.length) lines.push(`**Read from:** ${[...new Set(looked)].map(path => `\`${path}\``).join(', ')}`)
  const here = []
  const already = listed.threads.filter(thread => thread.alreadyImported).length
  if (already) here.push(plural(already, 'chat'))
  const mcpHere = settings?.mcp.rows.filter(row => row.status === 'already here').length ?? 0
  if (mcpHere) here.push(plural(mcpHere, 'MCP server'))
  const skillsHere = skills?.skills?.filter(row => row.status === 'already here').length ?? 0
  if (skillsHere) here.push(plural(skillsHere, 'skill'))
  if (skills?.instructions && skills.instructions.status !== 'ready') here.push(`${skills.instructions.name} (${skills.instructions.status === 'kept yours' ? 'Jan has its own, kept' : 'same file'})`)
  if (here.length) lines.push(`**Already in Jan:** ${here.join(', ')}.`)
  const behind = []
  if (skills?.linked && skills.skills?.some(row => row.status === 'ready')) behind.push(`skills (Jan's skills folder links to \`${skills.linked}\`)`)
  for (const row of settings?.mcp.skipped ?? []) behind.push(`MCP server ${row.sourceName} (${row.reason})`)
  for (const row of skills?.others ?? []) behind.push(`${row.label}: ${row.names.join(', ')} (Jan can't run them)`)
  behind.push(CONNECTORS_ONLY.includes(source) ? 'chat history' : source === 'jan' ? CHAT_EXCLUSIONS.jan.toLowerCase() : CHAT_EXCLUSIONS.agent.toLowerCase(), 'sign-ins and unlisted settings')
  lines.push(`**Stays behind:** ${behind.join('; ')}.`)
  lines.push('Nothing in the source app is changed.')
  return { options, detail: lines.join('\n\n') }
}

/**
 * Register `migrate_scan` and `migrate_import`. `migrate_import` shows one form with every ready item
 * ticked; the user's submitted ticks are the approval and decide what is imported.
 * @param {any} ctx Plugin context with `tools`.
 * @param {{ list: (request: object) => Promise<any>, importSelected: (request: object) => Promise<any> }} importer The importer the Settings card uses.
 */
export function registerMigrateTools(ctx, { list, importSelected }) {
  const scan = {
    name: 'migrate_scan',
    description: 'Read-only preview of chats, named MCP servers and connectors, masked credential counts, skills, the global instruction file, and supported settings from Earlier Jan, Claude Code, Claude Desktop, Codex, OMP and Cursor. Returns the folders and files read, ready and already imported items, skipped entries with reasons, and what cannot be migrated.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        source: { type: 'string', enum: MCP_SOURCES, description: 'Scan one app; omit to scan all supported apps.' },
        days: { type: 'integer', minimum: 1, description: `For Claude Code, Codex and OMP, count sessions updated in this many recent days. Defaults to ${DEFAULT_MIGRATION_DAYS}.` },
      },
    },
    output: { schema: {}, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: args => migrationPreview(list, args),
    presentCall: () => ({ card: 'generic', title: 'Preview chats, MCP servers, skills, and settings', kind: 'search' }),
  }
  const run = {
    name: 'migrate_import',
    description: 'Show the user one form listing everything ready to import from one app, each item ticked, then import only what the user leaves ticked and submits. Call it right after migrate_scan; do not ask in text first. MCP servers arrive turned off and existing names, skills and files are kept. Returns the actual result per item, or that the user chose nothing.',
    parameters: {
      type: 'object', additionalProperties: false, required: ['source'],
      properties: {
        source: { type: 'string', enum: MCP_SOURCES, description: 'The app to import from. One app per call.' },
        days: { type: 'integer', minimum: 1, description: `Claude Code, Codex and OMP only: chats updated in this many recent days are ticked; older ones are offered unticked. Defaults to ${DEFAULT_MIGRATION_DAYS}.` },
      },
    },
    output: { schema: {}, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args, exec) {
      const questions = ctx.get('userQuestions')
      if (!questions) throw new Error('This chat cannot show the import form. Use Settings -> Built-in plugins -> Import sessions instead.')
      const window = days(args.days)
      const listed = await list({ source: args.source })
      const { options, detail } = migrationForm(listed, args.source, window)
      if (!options.length) return { imported: 0, note: `Nothing new to import from ${SOURCE_NAMES[args.source]}.`, detail }
      const answer = await questions.ask({
        questions: [{ id: 'migrate', header: `Import from ${SOURCE_NAMES[args.source]}`, question: 'Untick anything you want to leave behind, then submit.', detail, multiSelect: true,
          options: options.map(({ label, description }) => description ? { label, description } : { label }) }],
        ...(exec?.agent !== undefined ? { agent: exec.agent } : {}),
        signal: exec?.signal,
      })
      const ticked = new Set(answer.answers.find(item => item.id === 'migrate')?.selected ?? [])
      const picks = options.filter(option => ticked.has(option.label)).map(option => option.pick)
      if (!picks.length) return { imported: 0, note: 'The user ticked nothing, so nothing was imported.' }
      const ids = picks.flatMap(pick => pick.ids ?? [])
      const mcp = picks.flatMap(pick => pick.mcp ?? [])
      const skills = picks.flatMap(pick => pick.skills ?? [])
      const { results, settings } = await importSelected({
        source: args.source, ids, providers: picks.some(pick => pick.providers), assistants: picks.some(pick => pick.assistants),
        mcp: mcp.length > 0, mcpNames: mcp, skills: skills.length > 0, skillNames: skills, instructions: picks.some(pick => pick.instructions),
      })
      const count = status => results.filter(result => result.status === status).length
      return {
        chosen: options.filter(option => ticked.has(option.label)).map(option => option.label.replace(/ \(Recommended\)$/u, '')),
        left: options.filter(option => !ticked.has(option.label)).map(option => option.label.replace(/ \(Recommended\)$/u, '')),
        imported: count('imported'), alreadyHere: count('already imported'), emptySkipped: count('skipped'),
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
  }, 'legacy-import: /migrate tools')
}
