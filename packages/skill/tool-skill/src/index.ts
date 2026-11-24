/**
 * Durable session skill catalog and model-facing `skill` loader tool.
 *
 * @module @janhq/jan-tool-skill
 */

import type { } from '@janhq/jan-working-directory'
import { createHash } from 'node:crypto'
import type { Context } from '@janhq/cordis'
import z from '@janhq/schemastery'
import { agentEvents, type Agent, type PreStepDecision } from '@janhq/jan-agent'
import type { CommandResult } from '@janhq/jan-commands'
import { CommandDefinitionId } from '@janhq/jan-commands/brand'
import { defineTool } from '@janhq/jan-tools'
import { createUserMessage } from '@janhq/jan-llm'
import { SessionSeq, type UserMessage } from '@janhq/jan-session'
import {
  escapeText,
  isModelInvocable,
  isSkillName,
  isUserInvocable,
  renderSkillContent,
  type SkillInvocationSource,
  type SkillSummary,
} from '@janhq/jan-skill'

export const name = 'tool-skill'
export const inject = ['agents', 'tools', 'skills', 'workingDirectory']

const DEFAULT_CATALOG_DESCRIPTION_MAX_LENGTH = 500
const DEFAULT_SEARCH_RESULT_LIMIT = 8
const DEFAULT_LISTED_DESCRIPTION_MAX_LENGTH = 100
/**
 * Durable provider and item records for one published session skill catalog. The catalog is a
 * `catalog`-form context, so it records the entries it published beside the
 * model-facing prose: a consumer presenting the list must not re-parse the
 * `<available_skills>` block, whose framing exists for the model.
 */
export interface SkillCatalogSource {
  readonly kind: 'skill-catalog'
  readonly form: 'catalog'
  /** Marks a replacement catalog rather than this session's first publication. */
  readonly update?: true
  /** Some discovery failed; entries contain only skills found in this observation. Absence means complete. */
  readonly incomplete?: true
  /**
   * Published in `search` catalog mode: unpinned entries carry a shortened or empty
   * description, and skills absent from `entries` are found through `skill_search`.
   */
  readonly search?: true
  /** Exactly the entries this message published, in catalog order. */
  readonly entries: readonly { readonly name: string; readonly description: string }[]
}

declare module '@janhq/jan-llm' {
  interface MessageSourceMap {
    'skill-catalog': SkillCatalogSource
  }
}

/** Durable entry list mirroring the rendered catalog lines, for non-model consumers. */
function catalogSourceEntries(
  skills: SkillSummary[],
  descriptionMaxLength: number,
): SkillCatalogSource['entries'] {
  return skills.map(skill => ({
    name: skill.name,
    description: catalogDescription(skill.description, descriptionMaxLength),
  }))
}

/**
 * Search-mode entries: pinned skills keep their capped description, and the
 * rest appear with a shortened description, by name alone, or not at all.
 */
function searchCatalogEntries(
  skills: SkillSummary[],
  pinned: ReadonlySet<string>,
  listNames: boolean,
  descriptionMaxLength: number,
  listedDescriptionMaxLength: number,
): SkillCatalogSource['entries'] {
  const entries: { name: string; description: string }[] = []
  for (const skill of skills) {
    if (pinned.has(skill.name)) entries.push({ name: skill.name, description: catalogDescription(skill.description, descriptionMaxLength) })
    else if (listNames) {
      entries.push({
        name: skill.name,
        description: listedDescriptionMaxLength === 0 ? '' : catalogDescription(skill.description, listedDescriptionMaxLength),
      })
    }
  }
  return entries
}

/** Model-facing skill catalog configuration. */
export interface Config {
  /** Maximum normalized description length rendered in the session catalog; minimum 3. */
  catalogDescriptionMaxLength?: number
  /**
   * `search` lists `pinnedSkills` with their capped description and the other
   * skills with a shortened one, and registers `skill_search` for finding a
   * skill by its longer description. `full` lists every model-invocable skill
   * with its capped description.
   */
  catalogMode?: 'full' | 'search'
  /** Skills `search` mode lists with their capped description; unknown names are ignored. */
  pinnedSkills?: string[]
  /** Whether `search` mode lists unpinned skills at all. */
  listSkillNames?: boolean
  /** Description length for an unpinned skill listed in `search` mode; 0 lists its name alone, otherwise minimum 3. */
  listedDescriptionMaxLength?: number
  /** Most results one `skill_search` call returns; minimum 1. */
  searchResultLimit?: number
}

/** Validate and default the model-facing skill catalog configuration. */
export const Config: z<Config> = z.object({
  catalogDescriptionMaxLength: z.number().default(DEFAULT_CATALOG_DESCRIPTION_MAX_LENGTH),
  catalogMode: z.union([z.const('full'), z.const('search')]).default('search'),
  pinnedSkills: z.array(z.string()).default([]),
  listSkillNames: z.boolean().default(true),
  listedDescriptionMaxLength: z.number().default(DEFAULT_LISTED_DESCRIPTION_MAX_LENGTH),
  searchResultLimit: z.number().default(DEFAULT_SEARCH_RESULT_LIMIT),
})

/**
 * Register the model-facing skill loader and its visibility-matched
 * durable session catalog. The catalog is emitted only when the calling agent
 * resolves this plugin's exact tool registration; a restriction or scoped
 * same-name shadow therefore removes both the schema and its call guidance.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const catalogDescriptionMaxLength = config.catalogDescriptionMaxLength ?? DEFAULT_CATALOG_DESCRIPTION_MAX_LENGTH
  assertPositiveInteger('catalogDescriptionMaxLength', catalogDescriptionMaxLength, 3)
  const searchMode = (config.catalogMode ?? 'search') === 'search'
  const pinnedSkills = new Set(config.pinnedSkills ?? [])
  const listSkillNames = config.listSkillNames ?? true
  const listedDescriptionMaxLength = config.listedDescriptionMaxLength ?? DEFAULT_LISTED_DESCRIPTION_MAX_LENGTH
  if (listedDescriptionMaxLength !== 0) assertPositiveInteger('listedDescriptionMaxLength', listedDescriptionMaxLength, 3)
  const searchResultLimit = config.searchResultLimit ?? DEFAULT_SEARCH_RESULT_LIMIT
  assertPositiveInteger('searchResultLimit', searchResultLimit)
  for (const name of pinnedSkills) {
    if (!isSkillName(name)) throw new Error(`tool-skill: pinnedSkills entry "${name}" is not a valid skill name`)
  }

  const skillTool = defineTool({
    name: 'skill',
    description: 'Load the full instructions for a skill. Call it before acting on a task that names or clearly matches a skill in the session skill catalog.',
    parameters: {
      name: { type: 'string', required: true, description: 'The exact skill name from the available skills list.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string', required: true },
          provider: { type: 'string', required: true },
          resourceBase: {
            oneOf: [
              {
                type: 'object',
                additionalProperties: false,
                properties: {
                  kind: { type: 'string', required: true, const: 'directory' },
                  path: { type: 'string', required: true },
                },
              },
              {
                type: 'object',
                additionalProperties: false,
                properties: {
                  kind: { type: 'string', required: true, const: 'url' },
                  url: { type: 'string', required: true },
                },
              },
              {
                type: 'object',
                additionalProperties: false,
                properties: {
                  kind: { type: 'string', required: true, const: 'opaque' },
                  description: { type: 'string', required: true },
                },
              },
            ],
          },
          content: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderSkillContent(value) }],
    },
    async execute(args, exec) {
      if (!isSkillName(args.name)) {
        throw new Error(`invalid skill name "${args.name}"`)
      }
      // The agent is its own scope key, so the lookup resolves the layered
      // registry exactly as this agent's composition sees it.
      const cwd = exec.agent === undefined ? undefined : await ctx.workingDirectory.ensure(exec.agent, exec.signal)
      const lookup = { cwd, signal: exec.signal, scope: exec.agent }
      const summary = (await ctx.skills.list(lookup)).find(skill => skill.name === args.name)
      if (!summary) {
        throw new Error(`skill "${args.name}" is unknown or no longer available`)
      }
      if (!isModelInvocable(summary)) {
        throw new Error(`skill "${args.name}" is not available for model invocation`)
      }
      const skill = await ctx.skills.get(args.name, lookup)
      if (!skill) {
        throw new Error(`skill "${args.name}" is unknown or no longer available`)
      }
      if (!isModelInvocable(skill)) {
        throw new Error(`skill "${args.name}" is not available for model invocation`)
      }
      return {
        name: skill.name,
        provider: skill.provider,
        ...skill.resourceBase !== undefined ? {
          resourceBase: { ...skill.resourceBase },
        } : {},
        content: skill.content,
      }
    },
    presentCall(args) {
      return { card: 'generic', title: `Load skill ${args.name}`, kind: 'read', rawInput: args.name }
    },
  })
  ctx.tools.register(skillTool)

  if (searchMode) {
    ctx.tools.register(defineTool({
      name: 'skill_search',
      description: 'Find skills by what they do when the session skill catalog does not list a matching one. Returns names and descriptions; load one with the `skill` tool.',
      parameters: {
        query: { type: 'string', required: true, description: 'Words describing the task, such as "edit a video" or "review a pull request".' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            matches: {
              type: 'array',
              required: true,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  name: { type: 'string', required: true },
                  description: { type: 'string', required: true },
                },
              },
            },
          },
        },
        render: (args, value) => [{ type: 'text', text: renderSearchResult(args.query, value.matches) }],
      },
      async execute(args, exec) {
        const cwd = exec.agent === undefined ? undefined : await ctx.workingDirectory.ensure(exec.agent, exec.signal)
        const skills = (await ctx.skills.list({ cwd, signal: exec.signal, scope: exec.agent })).filter(isModelInvocable)
        return {
          matches: rankSkills(skills, args.query, searchResultLimit).map(skill => ({
            name: skill.name,
            description: catalogDescription(skill.description, catalogDescriptionMaxLength),
          })),
        }
      },
      presentCall(args) {
        return { card: 'generic', title: `Search skills for ${args.query}`, kind: 'search', rawInput: args.query }
      },
    }))
  }

  // User-explicit skill invocation: a claimed user message whose first line
  // starts with `/<name>` naming a user-invocable skill is a deterministic
  // load gesture. The rendered body enters this step as injected
  // instructions context appended after every other injection — background
  // first (workspace rules, runtime policy, the catalog), the material the
  // model must act on last, closest to its answer. Registration order makes
  // that placement deterministic: this listener registers before the catalog
  // listener, so the waterfall hands it the catalog-bearing list to extend.
  // Only `source.kind === 'user'` messages are scanned — external text
  // cannot forge the gesture — and a token naming no user-invocable skill
  // stays ordinary prose (the command registry is a different closed
  // namespace, resolved client-side before a line ever becomes a prompt).
  // This is the only entry point for `disable-model-invocation` skills; the
  // catalog and the `skill` tool below never see them.
  ctx.on('agent/pre-step', async (
    { agent, messages, signal },
    next,
  ): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind === 'reject') return decision
    const names = invokedSkillNames(messages)
    if (names.length === 0) return decision
    signal.throwIfAborted()
    const lookup = { cwd: await ctx.workingDirectory.ensure(agent, signal), signal, scope: agent }
    const injections: UserMessage[] = []
    for (const name of names) {
      const skill = await ctx.skills.get(name, lookup)
      signal.throwIfAborted()
      // Unknown names and user-disabled skills stay plain prose: the
      // gesture was never a claim this boundary recognizes. The check sits
      // on the loaded definition — the single lookup that produces what is
      // actually injected.
      if (skill === undefined || !isUserInvocable(skill)) continue
      const source: SkillInvocationSource = { kind: 'skill-invocation', name, form: 'instructions' }
      injections.push(createUserMessage({
        content: [{ type: 'text', text: renderSkillContent(skill) }],
        source,
      }))
    }
    if (injections.length === 0) return decision
    return { ...decision, messages: [...decision.messages, ...injections] }
  })

  // Dropping cached catalogs lets the next step's catalog listener publish a replacement catalog,
  // appended after the conversation, for skills changed outside the providers' change detection.
  ctx.on('agent/reload', async ({ agent, signal }, next): Promise<string[]> => {
    const lines = await next()
    if (ctx.tools.get(skillTool.name, agent) !== skillTool) return lines
    ctx.skills.refresh()
    const found = await ctx.skills.list({ cwd: await ctx.workingDirectory.ensure(agent, signal), signal, scope: agent })
    return [...lines, `Skills: ${String(found.length)} found.`]
  })

  // `/reload` lives here because every mode that has anything to re-read mounts the skill loader;
  // other plugins add what they re-read through `agent/reload`.
  ctx.inject(['commands'], (scope) => {
    scope.commands.register({
      definitionId: CommandDefinitionId('@janhq/jan-tool-skill/reload'),
      name: 'reload',
      description: 'Reload instruction files and skills without resetting the cache',
      async handler({ agent, rawInput, signal }): Promise<CommandResult> {
        if (rawInput.trim().length > 0) return { kind: 'error', text: 'Usage: /reload (no arguments)' }
        const lines = await agentEvents(ctx, agent).waterfall('agent/reload', { signal }, () => Promise.resolve([]))
        return { kind: 'success', text: [...lines, 'Changes reach the model with your next message; earlier messages are not resent.'].join(' ') }
      },
    })
  })

  // Register after the tool so reverse teardown removes guidance first. Exact definition
  // identity prevents a scoped shadow merely named `skill` from inheriting this catalog.
  //
  // The comparison is against the definition this plugin registered, not against
  // a lookup of its own name: `register()` files into the CALLING context's
  // scope, so a plugin mounted inside an agent preset registers for that agent
  // alone and an unscoped lookup correctly finds nothing.
  ctx.on('agent/pre-step', async (
    { agent, signal },
    next,
  ): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind === 'reject') return decision
    signal.throwIfAborted()
    const toolVisible = ctx.tools.get(skillTool.name, agent) === skillTool
    const snapshot = toolVisible
      ? await ctx.skills.snapshot({ cwd: await ctx.workingDirectory.ensure(agent, signal), signal, scope: agent })
      : { skills: [], complete: true }
    signal.throwIfAborted()
    const skills = snapshot.skills.filter(isModelInvocable)
    const entries = searchMode
      ? searchCatalogEntries(skills, pinnedSkills, listSkillNames, catalogDescriptionMaxLength, listedDescriptionMaxLength)
      : catalogSourceEntries(skills, catalogDescriptionMaxLength)
    const incomplete = !snapshot.complete
    const digest = digestCatalogEntries(entries, incomplete)
    const history = catalogHistory(agent)
    const existing = catalogMessage(decision.messages)
    if (history.visibleDigest === digest) {
      return existing === undefined
        ? decision
        : { ...decision, messages: decision.messages.filter(message => message.id !== existing.message.id) }
    }
    if (existing !== undefined && digestCatalogEntries(existing.entries, existing.incomplete) === digest) return decision
    if (!history.published && skills.length === 0 && !incomplete) {
      return existing === undefined
        ? decision
        : { ...decision, messages: decision.messages.filter(message => message.id !== existing.message.id) }
    }
    const catalog = history.published
      ? renderCatalogUpdate(entries, incomplete, searchMode)
      : renderCatalogMessage(entries, incomplete, searchMode)
    return {
      ...decision,
      messages: existing === undefined
        ? [...decision.messages, catalog]
        : decision.messages.map(message => message.id === existing.message.id ? catalog : message),
    }
  })
}

function renderCatalogMessage(entries: SkillCatalogSource['entries'], incomplete: boolean, search: boolean): UserMessage {
  if (search) return renderSearchCatalog(entries, incomplete, false)
  return createUserMessage({
    content: [{
      type: 'text',
      text: [
        '<system-reminder>',
        entries.length === 0
          ? 'No skills could be confirmed in this discovery attempt.'
          : 'A skill is a reusable set of task-specific instructions. The following skills are available in this session:',
        '',
        '<available_skills>',
        ...renderCatalogEntries(entries),
        '</available_skills>',
        '',
        ...incomplete ? [incompleteCatalogNotice(), ''] : [],
        entries.length === 0
          ? 'Wait for an updated catalog before calling the `skill` tool. Do not infer skill instructions from an empty catalog.'
          : "If the user names a skill, or the task clearly matches a skill's description, call the `skill` tool with the exact skill name before taking task actions. Load all applicable skills, then follow their full instructions. This catalog contains summaries only; do not infer or follow a skill's instructions until it has been loaded.",
        'A user may also invoke a skill directly; its <skill_content> block then appears in this conversation. Follow it, and do not call the `skill` tool again for that skill.',
        '</system-reminder>',
      ].join('\n'),
    }],
    source: {
      kind: 'skill-catalog',
      form: 'catalog',
      entries,
      ...incomplete ? { incomplete: true } : {},
    },
  })
}

/**
 * The `search`-mode catalog: one list whose descriptions may be shortened or
 * absent, with `skill_search` as the way to read a skill's longer description.
 */
function renderSearchCatalog(entries: SkillCatalogSource['entries'], incomplete: boolean, update: boolean): UserMessage {
  return createUserMessage({
    content: [{
      type: 'text',
      text: [
        '<system-reminder>',
        update
          ? 'The available skill catalog changed. This catalog replaces every earlier available-skills list in this session.'
          : 'A skill is a reusable set of task-specific instructions.',
        'Descriptions in this list may be shortened, and some skills may not be listed. Before acting on a task that a skill could cover, load the matching skill with the `skill` tool; when no listed skill clearly matches, call `skill_search` with a few words about the task.',
        ...entries.length > 0
          ? ['', '<available_skills>', ...entries.map(entry => entry.description === '' ? `- \`${entry.name}\`` : `- \`${entry.name}\`: ${escapeText(entry.description)}`), '</available_skills>']
          : [],
        '',
        ...incomplete ? [incompleteCatalogNotice(), ''] : [],
        'If the user names a skill, call the `skill` tool with that exact name. Do not infer or follow a skill\'s instructions until it has been loaded.',
        'A user may also invoke a skill directly; its <skill_content> block then appears in this conversation. Follow it, and do not call the `skill` tool again for that skill.',
        '</system-reminder>',
      ].join('\n'),
    }],
    source: {
      kind: 'skill-catalog',
      form: 'catalog',
      search: true,
      ...update ? { update: true } : {},
      entries,
      ...incomplete ? { incomplete: true } : {},
    },
  })
}

function renderCatalogUpdate(entries: SkillCatalogSource['entries'], incomplete: boolean, search: boolean): UserMessage {
  if (search) return renderSearchCatalog(entries, incomplete, true)
  const availability = entries.length === 0
    ? [
      incomplete
        ? 'No skills could be confirmed in this discovery attempt. Do not use names from earlier skill catalogs.'
        : 'No skills are currently available through the `skill` tool. Do not use names from earlier skill catalogs.',
      'A user may still invoke a skill directly; its <skill_content> block then appears in this conversation. Follow it, and do not call the `skill` tool for it.',
    ]
    : [
      'Use only names in this replacement catalog. If the user names a listed skill, or the task clearly matches its description, call the `skill` tool with the exact name before acting.',
      'A user may also invoke a skill directly; its <skill_content> block then appears in this conversation. Follow it, and do not call the `skill` tool again for that skill.',
    ]
  return createUserMessage({
    content: [{
      type: 'text',
      text: [
        '<system-reminder>',
        incomplete
          ? 'Skill discovery is incomplete. This catalog of currently available skills replaces every earlier available-skills list in this session:'
          : 'The available skill catalog changed. This complete catalog replaces every earlier available-skills list in this session:',
        '',
        '<available_skills>',
        ...renderCatalogEntries(entries),
        '</available_skills>',
        '',
        ...incomplete ? [incompleteCatalogNotice(), ''] : [],
        ...availability,
        '</system-reminder>',
      ].join('\n'),
    }],
    source: {
      kind: 'skill-catalog',
      form: 'catalog',
      update: true,
      entries,
      ...incomplete ? { incomplete: true } : {},
    },
  })
}

function incompleteCatalogNotice(): string {
  return 'Some skills could not be checked. Only confirmed skills are listed; a lower-priority definition of the same name may be selected when a preferred source is unavailable. Discovery will be retried on the next request.'
}

/**
 * Model-facing catalog lines, projected from the same entries the source records.
 * The pseudo-XML escaping belongs to this frame, not to the published fact, so it
 * is applied here and never stored. Names are `isSkillName`-validated and carry
 * no escapable character.
 */
function renderCatalogEntries(entries: SkillCatalogSource['entries']): string[] {
  return entries.map(entry => `- \`${entry.name}\`: ${escapeText(entry.description)}`)
}

/**
 * Catalog identity includes durable entries and completeness so recovery clears
 * a discovery warning even when the entries are unchanged.
 */
function digestCatalogEntries(entries: SkillCatalogSource['entries'], incomplete = false): string {
  // JSON per entry rather than a separator character: every separator is itself
  // a legal description character, so only quoting makes the boundary exact.
  const canonical = entries.map(entry => JSON.stringify([entry.name, entry.description])).join('\n')
  return createHash('sha256')
    .update(incomplete ? 'incomplete\n' : '')
    .update(canonical)
    .digest('hex')
}

/**
 * Entries of one durable catalog message, or undefined when the record is not a
 * usable catalog.
 *
 * `agent.session.snapshotEvents()` may contain a resumed, forked, or externally written seed,
 * and seed validation only guarantees a source object with a non-empty `kind`;
 * no per-kind field is checked there. An unreadable record is therefore treated
 * as "not this plugin's catalog" — the posture the replaced content digest had —
 * rather than throwing inside the step listener, which would fail every
 * subsequent turn of that session.
 */
function readCatalogEntries(source: unknown): SkillCatalogSource['entries'] | undefined {
  const entries = (source as { entries?: unknown }).entries
  if (!Array.isArray(entries)) return undefined
  const readable: { name: string; description: string }[] = []
  for (const entry of entries as readonly unknown[]) {
    if (typeof entry !== 'object' || entry === null) return undefined
    const { name, description } = entry as { name?: unknown; description?: unknown }
    if (typeof name !== 'string' || name === '' || typeof description !== 'string') return undefined
    readable.push({ name, description })
  }
  return readable
}

function catalogHistory(agent: Agent): { visibleDigest?: string; published: boolean } {
  const visible = new Set(agent.session.surface.nodes)
  let published = false
  for (let index = agent.session.seq - 1; index >= 0; index -= 1) {
    // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
    const event = agent.session.eventAt(SessionSeq(index))
    if (event === undefined) {
      throw new Error(`skill catalog cannot read seq ${String(index)} below the current Session length`)
    }
    if (event.type !== 'user/message' || event.data.source.kind !== 'skill-catalog') continue
    const entries = readCatalogEntries(event.data.source)
    if (entries === undefined) continue
    const digest = digestCatalogEntries(entries, event.data.source.incomplete === true)
    published = true
    if (visible.has(event.seq)) return { visibleDigest: digest, published }
  }
  return { published }
}

function catalogMessage(
  messages: readonly UserMessage[],
): { message: UserMessage; entries: SkillCatalogSource['entries']; incomplete: boolean } | undefined {
  for (const message of messages) {
    if (message.source.kind !== 'skill-catalog') continue
    const entries = readCatalogEntries(message.source)
    if (entries !== undefined) return { message, entries, incomplete: message.source.incomplete === true }
  }
  return undefined
}

/** Lowercase word tokens; letters and digits of any script, so Vietnamese or Japanese queries match too. */
function searchTokens(text: string): string[] {
  return text.toLowerCase().normalize('NFKC').match(/[\p{L}\p{N}]+/gu) ?? []
}

/**
 * Rank skills against a query with BM25 over name and description, the name
 * counted three times so a direct name hit outranks a passing mention.
 * @returns at most `limit` skills with a positive score, best first, ties by name.
 */
function rankSkills(skills: readonly SkillSummary[], query: string, limit: number): SkillSummary[] {
  const terms = [...new Set(searchTokens(query))]
  if (terms.length === 0) return []
  const documents = skills.map((skill) => {
    const nameTokens = searchTokens(skill.name)
    const tokens = [...nameTokens, ...nameTokens, ...nameTokens, ...searchTokens(skill.description), ...searchTokens(skill.whenToUse ?? '')]
    const counts = new Map<string, number>()
    for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1)
    return { skill, counts, length: tokens.length }
  })
  const averageLength = documents.reduce((sum, document) => sum + document.length, 0) / Math.max(1, documents.length)
  const idfs = new Map(terms.map((term) => {
    const containing = documents.filter(document => document.counts.has(term)).length
    return [term, Math.log(1 + (documents.length - containing + 0.5) / (containing + 0.5))]
  }))
  const k1 = 1.2
  const b = 0.75
  const scored = documents.map((document) => {
    let score = 0
    for (const [term, idf] of idfs) {
      const frequency = document.counts.get(term) ?? 0
      if (frequency === 0) continue
      score += idf * (frequency * (k1 + 1)) / (frequency + k1 * (1 - b + b * document.length / averageLength))
    }
    return { skill: document.skill, score }
  })
  return scored
    .filter(entry => entry.score > 0)
    .sort((left, right) => right.score - left.score || (left.skill.name < right.skill.name ? -1 : 1))
    .slice(0, limit)
    .map(entry => entry.skill)
}

/** Model-facing `skill_search` result text. */
function renderSearchResult(query: string, matches: readonly { name: string; description: string }[]): string {
  if (matches.length === 0) {
    return `No skill matches "${escapeText(query)}". Try other words, or continue without a skill.`
  }
  return [
    `Skills matching "${escapeText(query)}", best first. Load a skill with the \`skill\` tool before following it.`,
    ...renderCatalogEntries(matches),
  ].join('\n')
}

function catalogDescription(value: string, maxLength: number): string {
  const normalized = value.replaceAll(/\s+/g, ' ').trim()
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 3)}...`
}

function assertPositiveInteger(name: string, value: number, minimum = 1): void {
  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(`tool-skill: ${name} must be an integer greater than or equal to ${minimum}`)
  }
}

/**
 * A whitespace-bounded `/name` token (the public skill-name grammar) anywhere
 * in the text — the same word-boundary shape the transcript chip decoration
 * uses, so a gesture reads as one wherever it sits in the sentence. A second
 * `/` or any non-boundary character breaks the match, which keeps file paths
 * (`/usr/bin`) and fractions (`5/8`) out.
 */
const SKILL_GESTURE = /(^|\s)\/([a-z0-9]+(?:-[a-z0-9]+)*)(?=\s|$)/g

/**
 * `/name` gesture tokens from the claimed user messages, deduplicated in
 * first-seen order. Every text block of direct user input is scanned; no
 * other source can forge a gesture.
 * @param messages - the step's claimed batch.
 * @returns candidate skill names, unvalidated against the registry.
 */
function invokedSkillNames(messages: readonly UserMessage[]): string[] {
  const names: string[] = []
  for (const message of messages) {
    if ((message.source as { kind?: unknown }).kind !== 'user') continue
    for (const block of message.content) {
      if (block.type !== 'text') continue
      for (const match of block.text.matchAll(SKILL_GESTURE)) {
        const name = match[2]
        if (name !== undefined && !names.includes(name)) names.push(name)
      }
    }
  }
  return names
}
