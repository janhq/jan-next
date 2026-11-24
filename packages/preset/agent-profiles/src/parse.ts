/**
 * Read one agent file of any supported tool into an {@link AgentProfile}, and write Jan profile files.
 * Pure: no file system access.
 * @module @janhq/jan-agent-profiles/parse
 */
import { parse as parseToml } from 'smol-toml'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import type {
  AgentProfile, AgentProfileDraft, AgentProfileModel, AgentProfileSandbox, AgentProfileScope, AgentProfileSource, AgentProfileUse,
} from './types.ts'

/** Pattern every profile id matches; `/` allows opencode subfolders. */
export const PROFILE_ID = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$/

/** Maximum number of directories below an agent root before the profile file. */
export const MAX_PROFILE_DIRECTORY_DEPTH = 8

/** Where one file was found. */
export interface ProfileFile {
  readonly source: AgentProfileSource
  readonly scope: AgentProfileScope
  readonly writable: boolean
  /** Absolute path. */
  readonly path: string
  /** Path relative to its root, `/`-separated, with the extension. */
  readonly relative: string
  readonly text: string
}

/** A profile, or the reason the file is not one. */
export type ParsedProfile = { readonly profile: AgentProfile } | { readonly problem: string }

const CLAUDE_TOOLS: Readonly<Record<string, readonly string[]>> = {
  read: ['read'], write: ['write'], edit: ['edit', 'apply_patch'], multiedit: ['edit', 'apply_patch'], bash: ['bash'],
  grep: ['grep'], glob: ['glob'], webfetch: ['web_fetch'], websearch: ['web_search'], todowrite: ['todo_write'],
  agent: ['subagent'], task: ['subagent'],
}

const OPENCODE_TOOLS: Readonly<Record<string, readonly string[]>> = {
  edit: ['edit', 'write', 'apply_patch'], write: ['edit', 'write', 'apply_patch'], patch: ['edit', 'write', 'apply_patch'],
  shell: ['bash'], bash: ['bash'], webfetch: ['web_fetch'], websearch: ['web_search'], read: ['read'], glob: ['glob'], grep: ['grep'],
}

/** Jan name -> Claude name for the writer; names without one are written as Jan names. */
const CLAUDE_NAMES: Readonly<Record<string, string>> = {
  read: 'Read', write: 'Write', edit: 'Edit', bash: 'Bash', grep: 'Grep', glob: 'Glob', web_fetch: 'WebFetch',
  web_search: 'WebSearch', todo_write: 'TodoWrite', subagent: 'Agent',
}

const IGNORED: Readonly<Record<AgentProfileSource, readonly string[]>> = {
  jan: ['skills', 'hooks', 'mcpServers', 'permissionMode', 'memory', 'isolation', 'maxTurns'],
  agents: ['skills', 'hooks', 'mcpServers', 'permissionMode', 'memory', 'isolation', 'maxTurns'],
  claude: ['skills', 'hooks', 'mcpServers', 'permissionMode', 'memory', 'isolation', 'maxTurns'],
  builtin: [],
  opencode: ['steps', 'hidden'],
  codex: ['skills'],
}

/** Keys Jan reads, per source; `color` is presentation-only in Claude and opencode and is skipped silently. */
const KNOWN: Readonly<Record<AgentProfileSource, readonly string[]>> = {
  jan: ['name', 'description', 'mode', 'model', 'effort', 'tools', 'disallowedTools', 'sandbox', 'color'],
  agents: ['name', 'description', 'mode', 'model', 'effort', 'tools', 'disallowedTools', 'sandbox', 'color'],
  builtin: ['name', 'description', 'mode', 'model', 'effort', 'tools', 'disallowedTools', 'sandbox', 'color'],
  claude: ['name', 'description', 'model', 'effort', 'tools', 'disallowedTools', 'color'],
  opencode: ['description', 'mode', 'model', 'tools', 'permission', 'permissions', 'color'],
  codex: ['name', 'description', 'developer_instructions', 'model', 'model_reasoning_effort', 'features', 'sandbox_mode'],
}

const SANDBOXES: readonly AgentProfileSandbox[] = ['read-only', 'workspace-write', 'danger-full-access']

const USES: readonly AgentProfileUse[] = ['primary', 'subagent', 'all']

/**
 * Read one agent file.
 * @param file - the file, its root's source and scope, and its text.
 * @returns the profile with every unmapped key and value in `warnings`, or why the file is not a profile.
 */
export function parseProfile(file: ProfileFile): ParsedProfile {
  let fields: Record<string, unknown>
  let body: string
  try {
    ({ fields, body } = file.source === 'codex' ? { fields: parseToml(file.text), body: '' } : splitFrontmatter(file.text))
  } catch (error) {
    return { problem: `${file.source === 'codex' ? 'TOML' : 'YAML'} could not be read: ${(error as Error).message}` }
  }
  const warnings: string[] = []
  const id = profileId(file, fields)
  if (id === undefined) return { problem: 'missing name' }
  if (!validProfileId(id)) {
    return { problem: `invalid name "${id}"` }
  }
  for (const key of Object.keys(fields)) {
    if (IGNORED[file.source].includes(key)) warnings.push(`${key} is ignored`)
    else if (!KNOWN[file.source].includes(key)) warnings.push(`unknown key ${key}`)
  }
  const description = text(fields.description, 'description', warnings) ?? ''
  const instructions = (file.source === 'codex' ? text(fields.developer_instructions, 'developer_instructions', warnings) ?? '' : body).trim()
  const use = profileUse(file.source, fields.mode, warnings)
  const model = profileModel(file.source, fields, warnings)
  const allow = file.source === 'codex' || file.source === 'opencode' ? undefined : allowList(fields.tools, warnings)
  const deny = denyList(file.source, fields, warnings)
  const sandbox = profileSandbox(file.source, fields, warnings)
  return {
    profile: {
      id, description, use, scope: file.scope, source: file.source, path: file.path, writable: file.writable,
      ...model === undefined ? {} : { model },
      ...allow === undefined ? {} : { tools: allow },
      disallowedTools: deny, warnings, instructions,
      ...sandbox === undefined ? {} : { sandbox },
    },
  }
}

/**
 * Render a Jan profile file with Claude-compatible keys plus `mode`.
 * @param draft - the profile fields.
 * @returns Markdown with YAML frontmatter.
 */
export function renderProfile(draft: AgentProfileDraft): string {
  const header: Record<string, string> = { name: draft.id, description: draft.description, mode: draft.use }
  if (draft.model !== undefined) {
    if (draft.model.provider === undefined) {
      header.model = draft.model.model
      if (draft.model.reasoningEffort !== undefined) header.effort = draft.model.reasoningEffort
    } else {
      header.model = `${draft.model.provider}/${draft.model.model}${draft.model.reasoningEffort === undefined ? '' : `#${draft.model.reasoningEffort}`}`
    }
  }
  if (draft.tools !== undefined && draft.tools.length > 0) header.tools = writtenTools(draft.tools)
  if (draft.disallowedTools !== undefined && draft.disallowedTools.length > 0) header.disallowedTools = writtenTools(draft.disallowedTools)
  if (draft.sandbox !== undefined) header.sandbox = draft.sandbox
  const instructions = draft.instructions.trim()
  return `---\n${stringifyYaml(header, { lineWidth: 0 })}---\n${instructions === '' ? '' : `${instructions}\n`}`
}

/**
 * Check the fields of a profile to be written.
 * @param draft - fields from a caller.
 * @returns the reason the draft cannot be written, or undefined.
 */
export function draftProblem(draft: AgentProfileDraft): string | undefined {
  if (!validProfileId(draft.id)) {
    return `Name "${draft.id}" must start with a letter or digit and use only letters, digits, ".", "_", "-" and "/", up to 64 characters. Use at most ${MAX_PROFILE_DIRECTORY_DEPTH} nested folders and no empty or dot-prefixed segments.`
  }
  if (!USES.includes(draft.use)) return `Use must be one of ${USES.join(', ')}.`
  if (draft.model !== undefined && draft.model.model.trim() === '') return 'The model needs an id.'
  if (draft.sandbox !== undefined && !SANDBOXES.includes(draft.sandbox)) return `Sandbox must be one of ${SANDBOXES.join(', ')}.`
  return undefined
}

function validProfileId(id: string): boolean {
  if (!PROFILE_ID.test(id)) return false
  const segments = id.split('/')
  return segments.length <= MAX_PROFILE_DIRECTORY_DEPTH + 1 && segments.every(segment => segment !== '' && !segment.startsWith('.'))
}

function writtenTools(names: readonly string[]): string {
  const set = new Set(names)
  const written: string[] = []
  for (const name of names) {
    if (name === 'apply_patch' && set.has('edit')) continue
    const claude = name.startsWith('mcp:') ? `mcp__${name.slice(4)}` : CLAUDE_NAMES[name]
    const entry = claude ?? name
    if (!written.includes(entry)) written.push(entry)
  }
  return written.join(', ')
}

function profileSandbox(source: AgentProfileSource, fields: Record<string, unknown>, warnings: string[]): AgentProfileSandbox | undefined {
  if (source === 'claude' || source === 'opencode') return undefined
  const key = source === 'codex' ? 'sandbox_mode' : 'sandbox'
  const value = fields[key]
  if (value === undefined || value === null) return undefined
  if (typeof value === 'string' && (SANDBOXES as readonly string[]).includes(value)) return value as AgentProfileSandbox
  warnings.push(`${key} ${JSON.stringify(value)} is not ${SANDBOXES.join(', ')}`)
  return undefined
}

function splitFrontmatter(source: string): { fields: Record<string, unknown>; body: string } {
  const text = source.replace(/^\uFEFF/, '')
  const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text)
  if (match === null) return { fields: {}, body: text }
  const parsed: unknown = parseYaml(match[1] ?? '')
  if (parsed !== null && parsed !== undefined && (typeof parsed !== 'object' || Array.isArray(parsed))) {
    throw new Error('frontmatter is not a mapping')
  }
  return { fields: (parsed ?? {}) as Record<string, unknown>, body: text.slice(match[0].length) }
}

function profileId(file: ProfileFile, fields: Record<string, unknown>): string | undefined {
  const stripped = file.relative.replace(/\.(md|toml)$/i, '')
  if (file.source === 'opencode') return stripped
  const name = typeof fields.name === 'string' && fields.name.trim() !== '' ? fields.name.trim() : undefined
  if (name !== undefined) return name
  return file.source === 'jan' || file.source === 'agents' || file.source === 'builtin' ? stripped.split('/').pop() : undefined
}

function text(value: unknown, key: string, warnings: string[]): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'string') return value
  warnings.push(`${key} is not text`)
  return undefined
}

function profileUse(source: AgentProfileSource, value: unknown, warnings: string[]): AgentProfileUse {
  if (value === undefined || source === 'claude' || source === 'codex') return 'all'
  if (typeof value === 'string' && (USES as readonly string[]).includes(value)) return value as AgentProfileUse
  warnings.push(`mode ${JSON.stringify(value)} is not primary, subagent or all`)
  return 'all'
}

function profileModel(source: AgentProfileSource, fields: Record<string, unknown>, warnings: string[]): AgentProfileModel | undefined {
  const raw = text(fields.model, 'model', warnings)?.trim()
  if (raw === undefined || raw === '' || raw === 'inherit') return undefined
  const effortKey = source === 'codex' ? 'model_reasoning_effort' : source === 'opencode' ? undefined : 'effort'
  const effortValue = effortKey === undefined ? undefined : text(fields[effortKey], effortKey, warnings)?.trim()
  const effort = effortValue === '' ? undefined : effortValue
  if (source === 'codex' || source === 'claude' || !raw.includes('/')) {
    return { model: raw, ...effort === undefined ? {} : { reasoningEffort: effort } }
  }
  const hash = raw.indexOf('#')
  const route = hash < 0 ? raw : raw.slice(0, hash)
  const routeEffort = hash < 0 ? effort : raw.slice(hash + 1) || effort
  const slash = route.indexOf('/')
  const provider = route.slice(0, slash)
  const model = route.slice(slash + 1)
  if (provider === '' || model === '') {
    warnings.push(`model "${raw}" is not provider/model`)
    return undefined
  }
  return { provider, model, ...routeEffort === undefined ? {} : { reasoningEffort: routeEffort } }
}

function toolList(value: unknown, key: string, warnings: string[]): string[] | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'string') return value.split(',').map(name => name.trim()).filter(name => name !== '')
  if (Array.isArray(value) && value.every(name => typeof name === 'string')) return value.map(name => name.trim()).filter(name => name !== '')
  warnings.push(`${key} is not a list of tool names`)
  return undefined
}

function janToolNames(names: readonly string[], key: string, warnings: string[]): string[] {
  const mapped = new Set<string>()
  for (const name of names) {
    const claude = CLAUDE_TOOLS[name.toLowerCase()]
    const mcp = /^mcp__([^_](?:(?!__).)*)$/.exec(name)
    if (claude !== undefined) for (const tool of claude) mapped.add(tool)
    else if (mcp !== null) mapped.add(`mcp:${mcp[1] ?? ''}`)
    else if (/^mcp:[^\s]+$/.test(name) || (/^[a-z][a-z0-9_]*$/.test(name) && !name.startsWith('mcp__'))) mapped.add(name)
    else warnings.push(`${key} entry ${name} is not supported`)
  }
  return [...mapped]
}

function allowList(value: unknown, warnings: string[]): string[] | undefined {
  const names = toolList(value, 'tools', warnings)
  if (names === undefined) return undefined
  const mapped = janToolNames(names, 'tools', warnings)
  if (mapped.length > 0) return mapped
  warnings.push('tools names no supported tool, so every tool stays available')
  return undefined
}

function denyList(source: AgentProfileSource, fields: Record<string, unknown>, warnings: string[]): string[] {
  const deny = new Set<string>()
  if (source === 'codex') {
    const features = fields.features
    if (features !== undefined && (typeof features !== 'object' || features === null || Array.isArray(features))) {
      warnings.push('features is not a table')
    } else if (features !== undefined) {
      for (const [key, value] of Object.entries(features)) {
        if (key === 'shell_tool' && value === false) deny.add('bash')
        else if (key !== 'shell_tool') warnings.push(`features.${key} is ignored`)
      }
    }
    return [...deny]
  }
  if (source === 'opencode') {
    opencodeTools(fields.tools, deny, warnings)
    opencodePermission(fields.permission, deny, warnings)
    opencodePermissions(fields.permissions, deny, warnings)
    return [...deny]
  }
  const names = toolList(fields.disallowedTools, 'disallowedTools', warnings)
  for (const name of names === undefined ? [] : janToolNames(names, 'disallowedTools', warnings)) deny.add(name)
  return [...deny]
}

function opencodeName(name: string, origin: string, warnings: string[]): readonly string[] {
  const mapped = OPENCODE_TOOLS[name.toLowerCase()]
  if (mapped === undefined) warnings.push(`${origin} for ${name} is not supported`)
  return mapped ?? []
}

function opencodeTools(value: unknown, deny: Set<string>, warnings: string[]): void {
  if (value === undefined) return
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    warnings.push('tools is not a map of tool switches')
    return
  }
  for (const [name, enabled] of Object.entries(value)) {
    if (enabled === false) for (const tool of opencodeName(name, 'tools', warnings)) deny.add(tool)
    else if (enabled !== true) warnings.push(`tools.${name} is not true or false`)
  }
}

function opencodePermission(value: unknown, deny: Set<string>, warnings: string[]): void {
  if (value === undefined) return
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    warnings.push('permission is not a map')
    return
  }
  for (const [name, rule] of Object.entries(value as Record<string, unknown>)) {
    const denied = rule === 'deny' || (typeof rule === 'object' && rule !== null && !Array.isArray(rule)
      && Object.keys(rule).length === 1 && (rule as Record<string, unknown>)['*'] === 'deny')
    if (denied) for (const tool of opencodeName(name, 'permission', warnings)) deny.add(tool)
    else warnings.push(`permission.${name} is ignored`)
  }
}

function opencodePermissions(value: unknown, deny: Set<string>, warnings: string[]): void {
  if (value === undefined) return
  if (!Array.isArray(value)) {
    warnings.push('permissions is not a list of rules')
    return
  }
  // Rules are ordered and the last match wins, so only the final whole-resource rule per action decides.
  const last = new Map<string, unknown>()
  for (const rule of value) {
    const fields = typeof rule === 'object' && rule !== null && !Array.isArray(rule) ? rule as Record<string, unknown> : undefined
    if (fields === undefined || typeof fields.action !== 'string') {
      warnings.push('a permissions rule has no action')
      continue
    }
    if (fields.resource === '*' || fields.resource === undefined) last.set(fields.action, fields.effect)
    else {
      const resource = typeof fields.resource === 'string' ? fields.resource : JSON.stringify(fields.resource)
      warnings.push(`permissions rule for ${fields.action} on ${resource} is ignored`)
    }
  }
  for (const [action, effect] of last) {
    if (effect === 'deny') for (const tool of opencodeName(action, 'permissions', warnings)) deny.add(tool)
    else if (effect !== 'allow') warnings.push(`permissions rule for ${action} is ignored`)
  }
}
