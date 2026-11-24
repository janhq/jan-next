/** Settings that resolve per chat, then per project, then globally. */
import { Context, Service } from '@janhq/cordis'
import z from '@janhq/schemastery'
import { Remote, RemoteError, TypertRemoteService } from '@janhq/jan-typert-protocol'
import { mcpToolOrigin } from '@janhq/jan-mcp-client'
import type { Agent } from '@janhq/jan-agent'
import type { SessionId } from '@janhq/jan-session'
import type {} from '@janhq/jan-tools'
import type { WorkspaceId } from '@janhq/jan-workspace'
import type {} from '@janhq/jan-agent-preset-registry'
import type {} from '@janhq/jan-settings'
import type { SkillViewOptions } from '@janhq/jan-skill'
import { skillCatalog, skillVisibility, within, type SkillSwitches } from './skills.ts'
import { checkPatch, emptyDocument, loadDocument, patchValues, saveDocument } from './store.ts'
import {
  MCP_SERVER_PREFIX, type InheritedOff, type ScopeAddress, type ScopeListKey, type ScopedModel, type ScopedSettingsDocument,
  type ScopedSkillCatalog, type ScopedToolCatalog, type ScopedValues, type ScopedValuesPatch, type ScopedWriteRequest,
} from './types.ts'

export type * from './types.ts'
export { MCP_SERVER_PREFIX } from './types.ts'

/** Where the document lives. */
export interface Config {
  /** Absolute path of the scoped-settings document. */
  file: string
}

declare module '@janhq/cordis' {
  interface Context {
    /** Chat, project and global values for model, mode, tools and skills. */
    scopedSettings: ScopedSettings
  }

  interface Events {
    /**
     * One scope's stored values changed.
     * @param address - the scope that was written.
     * @mode emit
     */
    'scoped-settings/changed'(address: ScopeAddress): void
  }
}

interface Restriction {
  /** Sorted deny list the restriction was built from. */
  readonly key: string
  lift?: () => void
}

/**
 * Stores per-scope values in one document, applies the tool switches to every live agent and
 * hides switched-off skills from every lookup. Chat model and mode already live in each chat's
 * own log; this service adds the project layer for new chats and the switches for every scope.
 */
export default class ScopedSettings extends TypertRemoteService {
  static inject = ['agents', 'workspaceRegistry', 'tools']
  static Config: z<Config> = z.object({
    file: z.string().required().description('Absolute path of the scoped-settings document.'),
  })

  private document: ScopedSettingsDocument = emptyDocument()
  private tail: Promise<void> = Promise.resolve()
  private readonly restrictions = new Map<Agent, Restriction>()

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'scopedSettings', { namespace: 'scopedSettings' })
    ctx.inject(['settings'], (child) => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)) })
  }

  protected async [Service.init](): Promise<void> {
    const loaded = await loadDocument(this.config.file)
    if (loaded.quarantined !== undefined) {
      this.ctx.logger.warn(`scoped settings: ${loaded.problem ?? 'unreadable document'}; moved it to ${loaded.quarantined} and started empty`)
    }
    this.document = loaded.document
    const refresh = (): void => { for (const agent of this.ctx.agents.list()) this.applyTools(agent) }
    this.ctx.on('agent/created', ({ agent }) => { this.applyTools(agent); return undefined }, { global: true })
    this.ctx.on('agent/disposed', ({ agent }) => { this.restrictions.delete(agent) }, { global: true })
    this.ctx.on('tools/change', refresh)
    this.ctx.on('scoped-settings/changed', refresh)
    // Skill catalogs are cached per lookup; a switch change must reach the next turn's catalog.
    this.ctx.on('scoped-settings/changed', () => { this.ctx.get('skills')?.refresh() })
    this.ctx.inject(['skills'], (child) => {
      child.effect(() => child.skills.registerFilter({ name: 'scoped-settings', resolve: options => this.skillFilter(options) }),
        'scoped-settings.skills')
    })
    this.ctx.effect(() => () => {
      for (const restriction of this.restrictions.values()) restriction.lift?.()
      this.restrictions.clear()
    }, 'scoped-settings.restrictions')
    refresh()
  }

  /**
   * Find the project a chat belongs to.
   * @param sessionId - the chat.
   * @param cwd - the chat's folder, for a chat the project list has not indexed yet.
   * @returns the project id, or undefined outside any project.
   */
  projectOf(sessionId: SessionId, cwd?: string): WorkspaceId | undefined {
    return this.ctx.workspaceRegistry.list().find(workspace => workspace.sessionIds.includes(sessionId))?.id
      ?? (cwd === undefined ? undefined : this.projectAt(cwd))
  }

  /**
   * Find the project whose folder holds a path; the innermost one wins when projects nest.
   * @param path - absolute folder or file.
   * @returns the project id, or undefined outside every project folder.
   */
  projectAt(path: string): WorkspaceId | undefined {
    let best: { id: WorkspaceId; path: string } | undefined
    for (const workspace of this.ctx.workspaceRegistry.list()) {
      if (within(workspace.path, path) && (best === undefined || workspace.path.length > best.path.length)) best = workspace
    }
    return best?.id
  }

  /**
   * Model a chat starts on from its project. A model the chat picked itself is recorded in its log and wins.
   * @param sessionId - the chat.
   * @param workspaceHint - the project a chat being created joins.
   * @returns the project's model, or undefined to use the global default.
   */
  resolveModel(sessionId: SessionId, workspaceHint?: WorkspaceId): ScopedModel | undefined {
    const project = workspaceHint ?? this.projectOf(sessionId)
    return project === undefined ? undefined : this.document.projects[project]?.model
  }

  /**
   * Mode (agent preset) a new chat in a project starts in.
   * @param workspaceId - the project, or undefined outside any project.
   * @returns the project's mode while that preset exists, else undefined.
   */
  async resolveMode(workspaceId: WorkspaceId | undefined): Promise<string | undefined> {
    const mode = workspaceId === undefined ? undefined : this.document.projects[workspaceId]?.mode
    const presets = this.ctx.get('agentPresets')
    if (mode === undefined || presets === undefined) return undefined
    return (await presets.list()).some(preset => preset.id === mode && preset.broken === undefined) ? mode : undefined
  }

  /**
   * Tool switches in effect for a chat: any scope that switches a tool off switches it off for every narrower one.
   * @param sessionId - the chat.
   * @param cwd - the chat's folder, for a chat the project list has not indexed yet.
   * @returns sorted tool names and `mcp:<server>` entries.
   */
  resolveToolsDisabled(sessionId: SessionId, cwd?: string): string[] {
    const project = this.projectOf(sessionId, cwd)
    return [...new Set([
      ...this.document.global.toolsDisabled ?? [],
      ...project === undefined ? [] : this.document.projects[project]?.toolsDisabled ?? [],
      ...this.document.sessions[sessionId]?.toolsDisabled ?? [],
    ])].sort()
  }

  /**
   * List every skill a chat in one scope could load, grouped by folder, with that scope's switches and the
   * wider scopes' ones. A global listing reads the skill folders outside any project.
   * @param address - the scope and, for a project or chat, its id.
   * @returns folders with their skills.
   */
  @Remote
  async skillCatalog(address: ScopeAddress): Promise<ScopedSkillCatalog> {
    const id = this.checkAddress(address)
    const registry = this.ctx.get('skills')
    if (registry === undefined) return { folders: [] }
    const agent = address.scope === 'session' ? this.ctx.agents.list().find(candidate => candidate.id === id) : undefined
    const project = address.scope === 'project' ? id as WorkspaceId
      : address.scope === 'session' ? this.projectOf(id as SessionId, agent?.session.header.cwd) : undefined
    const cwd = agent?.session.header.cwd ?? (project === undefined ? undefined : this.ctx.workspaceRegistry.get(project)?.path)
    // Without a live chat, the default preset's scope adds its own skill folders, as a new chat would see them.
    const lease = agent === undefined ? await this.ctx.get('agentPresets')?.acquireScope().catch(() => undefined) : undefined
    try {
      const skills = await registry.list({ cwd, scope: agent ?? lease?.key, unfiltered: true })
      const wider: { at: InheritedOff; switches: SkillSwitches }[] = []
      if (address.scope !== 'global') wider.push({ at: 'global', switches: this.document.global })
      if (address.scope === 'session' && project !== undefined) wider.push({ at: 'project', switches: this.document.projects[project] ?? {} })
      return skillCatalog(skills, this.stored(address.scope, id) ?? {}, wider)
    } finally {
      await lease?.[Symbol.asyncDispose]()
    }
  }

  /**
   * Skill visibility for one registry lookup: the global, project and chat switches together.
   * The lookup's scope is the chat's agent when a chat asks; a lookup without one uses its folder alone.
   */
  private skillFilter(options: SkillViewOptions): ReturnType<typeof skillVisibility> {
    const agent = options.scope === undefined ? undefined : this.ctx.agents.list().find(candidate => candidate === options.scope)
    const cwd = options.cwd ?? agent?.session.header.cwd
    const project = agent !== undefined ? this.projectOf(agent.id, cwd) : cwd === undefined ? undefined : this.projectAt(cwd)
    return skillVisibility([
      this.document.global,
      ...project === undefined ? [] : [this.document.projects[project] ?? {}],
      ...agent === undefined ? [] : [this.document.sessions[agent.id] ?? {}],
    ])
  }

  /**
   * Read the values one scope stores, without inherited ones.
   * @param address - the scope and, for a project or chat, its id.
   * @returns the stored values; an empty object when the scope stores nothing.
   */
  @Remote
  read(address: ScopeAddress): ScopedValues {
    const id = this.checkAddress(address)
    return this.stored(address.scope, id) ?? {}
  }

  /**
   * Replace or remove values of one scope.
   * @param request - the scope, its id, and the keys to set; `null` or an empty list returns a key to the wider scope.
   * @returns the values the scope stores after the write.
   */
  @Remote
  async write(request: ScopedWriteRequest): Promise<ScopedValues> {
    const id = this.checkAddress(request)
    const patch = this.checkedPatch(request.scope, request.values)
    return this.commit(request.scope, id, () => patch)
  }

  /**
   * Switch one entry of one list off or back on, reading the list inside the write queue so
   * concurrent switches from the editor and the agent never drop each other.
   * @param address - the scope and, for a project or chat, its id.
   * @param key - the list.
   * @param entry - a tool name, `mcp:<server>`, skill name or absolute skill folder.
   * @param off - true adds the entry, false removes it.
   * @returns the values the scope stores after the write.
   */
  @Remote
  async setSwitch(address: ScopeAddress, key: ScopeListKey, entry: string, off: boolean): Promise<ScopedValues> {
    const id = this.checkAddress(address)
    const [checked = entry] = this.checkedPatch(address.scope, { [key]: [entry] })[key] ?? []
    return this.commit(address.scope, id, (current) => {
      const rest = (current[key] ?? []).filter(value => value !== checked)
      return { [key]: off ? [...rest, checked] : rest }
    })
  }

  private checkedPatch(scope: ScopeAddress['scope'], values: ScopedValuesPatch): ScopedValuesPatch {
    try {
      return checkPatch(scope, values)
    } catch (error) {
      const reason = (error as Error).message
      throw new RemoteError('scoped-settings/invalid', reason, { reason })
    }
  }

  private commit(scope: ScopeAddress['scope'], id: string | undefined, change: (current: ScopedValues) => ScopedValuesPatch): Promise<ScopedValues> {
    const run = this.tail.then(async () => {
      const current = this.stored(scope, id) ?? {}
      const next = patchValues(current, change(current))
      const document = this.withValues(scope, id, next)
      await saveDocument(this.config.file, document)
      this.document = document
      this.ctx.emit('scoped-settings/changed', { scope, ...id === undefined ? {} : { id } })
      return next
    })
    this.tail = run.then(() => undefined, () => undefined)
    return run
  }

  /**
   * List what a scope can switch off.
   * @returns global tool names outside MCP and the MCP servers that registered tools.
   */
  @Remote
  toolCatalog(): ScopedToolCatalog {
    const tools = new Set<string>()
    const mcpServers = new Set<string>()
    for (const definition of this.ctx.tools.definitions()) {
      const origin = mcpToolOrigin(definition)
      if (origin === undefined) tools.add(definition.name)
      else mcpServers.add(origin.serverName)
    }
    return { tools: [...tools].sort(), mcpServers: [...mcpServers].sort() }
  }

  private checkAddress(address: ScopeAddress): string | undefined {
    const invalid = (reason: string): RemoteError => new RemoteError('scoped-settings/invalid', reason, { reason })
    if (address.scope === 'global') {
      if (address.id !== undefined) throw invalid('The global scope has no id.')
      return undefined
    }
    if (address.id === undefined || address.id === '') throw invalid(`The ${address.scope} scope needs an id.`)
    const workspaceId = address.id as WorkspaceId
    if (address.scope === 'project' && this.ctx.workspaceRegistry.get(workspaceId) === undefined) {
      throw new RemoteError('workspace/not-found', 'The project no longer exists.', { workspaceId })
    }
    return address.id
  }

  private stored(scope: ScopeAddress['scope'], id: string | undefined): ScopedValues | undefined {
    if (scope === 'global') return this.document.global
    return (scope === 'project' ? this.document.projects : this.document.sessions)[id ?? '']
  }

  private withValues(scope: ScopeAddress['scope'], id: string | undefined, values: ScopedValues): ScopedSettingsDocument {
    if (scope === 'global') return { ...this.document, global: values }
    const key = scope === 'project' ? 'projects' : 'sessions'
    const { [id ?? '']: _replaced, ...rest } = this.document[key]
    return { ...this.document, [key]: Object.keys(values).length === 0 ? rest : { ...rest, [id ?? '']: values } }
  }

  /** Expand `mcp:<server>` entries against the registered tools. */
  private denyList(disabled: readonly string[]): string[] {
    const servers = new Set(disabled.filter(name => name.startsWith(MCP_SERVER_PREFIX)).map(name => name.slice(MCP_SERVER_PREFIX.length)))
    const names = new Set(disabled.filter(name => !name.startsWith(MCP_SERVER_PREFIX)))
    if (servers.size > 0) {
      for (const definition of this.ctx.tools.definitions()) {
        const origin = mcpToolOrigin(definition)
        if (origin !== undefined && servers.has(origin.serverName)) names.add(definition.name)
      }
    }
    return [...names].sort()
  }

  /**
   * Keep one restriction per agent that matches its chat's switches. The key is
   * recorded before the restriction changes, because lifting or adding one emits
   * `tools/change`, which calls back here.
   */
  private applyTools(agent: Agent): void {
    const deny = this.denyList(this.resolveToolsDisabled(agent.id, agent.session.header.cwd))
    const key = deny.join('\n')
    const current = this.restrictions.get(agent)
    if (current?.key === key) return
    const next: Restriction = { key }
    this.restrictions.set(agent, next)
    current?.lift?.()
    if (deny.length === 0) return
    try {
      next.lift = agent.ctx.tools.restrict({ deny }, { allowUnregistered: true })
    } catch (error) {
      this.ctx.logger.warn(`scoped settings: could not switch tools off for ${agent.id}: ${(error as Error).message}`)
    }
  }
}
