/** Named agent profiles read from Jan, `.agents`, Claude Code, opencode and Codex agent folders. */
import { rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, relative } from 'node:path'
import { Context, Service } from '@janhq/cordis'
import z from '@janhq/schemastery'
import { Remote, RemoteError, TypertRemoteService } from '@janhq/jan-typert-protocol'
import { writeFileAtomic } from '@janhq/jan-atomic-write'
import { resolveAgentsHome, resolveJanHome } from '@janhq/jan-home-paths'
import { ReasoningEffortId } from '@janhq/jan-llm/brand'
import { expandMcpServerEntries } from '@janhq/jan-mcp-client'
import type { Agent, ModelSelection } from '@janhq/jan-agent'
import type { Session } from '@janhq/jan-session'
import type { ProjectionHandle } from '@janhq/jan-session-projection'
import type {} from '@janhq/jan-system-prompt'
import type { ToolRestriction } from '@janhq/jan-tools'
import type { WorkspaceId } from '@janhq/jan-workspace'
import { draftProblem, renderProfile } from './parse.ts'
import { builtinRoot, globalRoots, projectRoots, scanRoot, watchRoot, type AgentRoot, type RootScan, type RootWatch } from './roots.ts'
import { agentProfileChosenProjectionDefinition, agentProfileProjectionDefinition } from './session.ts'
import type {
  AgentProfile, AgentProfileGetRequest, AgentProfileList, AgentProfileListRequest, AgentProfileModel, AgentProfileProblem,
  AgentProfileRemoveRequest, AgentProfileSaveRequest, AgentProfileScope, AgentProfileSelectRequest, AgentProfileSummary, AgentToolLimits,
} from './types.ts'

export type * from './types.ts'
export { agentProfileProjectionDefinition } from './session.ts'

declare module '@janhq/cordis' {
  interface Context {
    /** Agent profiles visible to each project and the profile each chat selected. */
    agentProfiles: AgentProfiles
  }
}

/** Where the agent folders are and how they are read. */
export interface Config {
  /** Jan home; its `agents` folder holds global Jan profiles. Defaults to the resolved Jan home. */
  janHome?: string
  /** Shared agents home; its `agents` folder is read. Defaults to the resolved agents home. */
  agentsHome?: string
  /** User home holding `.claude`, `.config/opencode` and `.codex`. Defaults to the OS home. */
  userHome?: string
  /** Quiet period after the last file event before profiles are re-read. */
  debounceMs: number
  /** Files larger than this are listed as problems and not read. */
  maxFileBytes: number
}

/** Model resolved against the model catalog. */
export interface ResolvedProfileModel {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
}

/** The part of the session controller's model catalog read here. */
interface ModelCatalogSource {
  modelCatalog(): Promise<{ readonly groups: readonly { readonly id: string; readonly models: readonly { readonly id: string }[] }[] }>
}

interface RootState {
  readonly root: AgentRoot
  scan: RootScan
  scanned: Promise<void>
  dirty: boolean
  watch?: RootWatch
}

const CLAUDE_ALIASES = new Set(['sonnet', 'opus', 'haiku', 'fable'])

/**
 * Reads, watches and writes agent profile files, records which profile each chat selected, and adds the
 * selected profile's instructions to the chat's system prompt. Tool limits are applied by scoped settings
 * through {@link AgentProfiles.toolLimitsFor}.
 */
export default class AgentProfiles extends TypertRemoteService {
  static inject = ['workspaceRegistry', 'sessionProjections', 'agents', 'systemPrompt']
  static Config: z<Config> = z.object({
    janHome: z.string().description('Jan home whose agents folder holds global Jan profiles.'),
    agentsHome: z.string().description('Shared agents home whose agents folder is read.'),
    userHome: z.string().description('User home holding .claude, .config/opencode and .codex.'),
    debounceMs: z.natural().default(200).description('Quiet period after file events before profiles are re-read.'),
    maxFileBytes: z.natural().default(64 * 1024).description('Largest profile file that is read.'),
  })

  private projection!: ProjectionHandle<string | null>
  private chosenProjection!: ProjectionHandle<boolean>
  private readonly global: RootState[] = []
  private readonly projects = new Map<WorkspaceId, { readonly path: string; readonly roots: RootState[] }>()
  private readonly selections = new Map<string, Promise<unknown>>()
  /** Selected profile per live chat, as first read; see {@link AgentProfiles.selectedProfile}. */
  private readonly pinned = new Map<string, AgentProfile>()
  /** Model warnings found at selection, by profile file. */
  private readonly modelWarnings = new Map<string, string>()
  private timer: ReturnType<typeof setTimeout> | undefined
  private closing = false

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'agentProfiles', { namespace: 'agentProfiles' })
  }

  protected async [Service.init](): Promise<void> {
    this.projection = await this.ctx.sessionProjections.register(agentProfileProjectionDefinition)
    this.chosenProjection = await this.ctx.sessionProjections.register(agentProfileChosenProjectionDefinition)
    const homes = {
      janHome: resolveJanHome(this.config.janHome),
      agentsHome: resolveAgentsHome(this.config.agentsHome),
      userHome: this.config.userHome ?? homedir(),
    }
    for (const root of [...globalRoots(homes), builtinRoot()]) this.global.push(this.track(root))
    this.ctx.effect(() => () => {
      this.closing = true
      clearTimeout(this.timer)
      const watches = [...this.global, ...[...this.projects.values()].flatMap(project => project.roots)]
      for (const state of watches) void state.watch?.close()
    }, 'agent-profiles.watchers')
    this.ctx.effect(() => this.ctx.systemPrompt.section({
      name: 'agent-profile', order: 10200, interpolate: false,
      text: ({ agent }) => agent === undefined ? '' : this.promptText(agent),
    }), 'agent-profiles.prompt')
    this.ctx.on('agent/created', ({ agent }) => {
      const project = this.projectOf(agent)
      if (project !== undefined) this.projectStates(project)
      return undefined
    }, { global: true })
    this.ctx.on('agent/disposed', ({ agent }) => {
      this.selections.delete(agent.id)
      this.pinned.delete(agent.id)
    }, { global: true })
    this.syncProjects()
    await Promise.all(this.global.map(state => state.scanned))
  }

  /**
   * List the profiles one project sees: its own folders first, then the global ones.
   * @param request - the project, or none for global profiles only.
   * @returns profiles in precedence order, shadowed ones marked, and files that could not be read.
   */
  @Remote
  async list(request: AgentProfileListRequest): Promise<AgentProfileList> {
    const states = this.statesFor(request.workspaceId)
    await this.reread(states)
    return this.compose(states, false)
  }

  /**
   * Follow catalog changes: a file change in any folder, a write, or a chat's selection change.
   * @param signal - stream lifetime.
   * @returns one tick per coalesced batch of changes since the previous read.
   */
  @Remote({ mode: 'stream' })
  async *watchChanges(signal: AbortSignal): AsyncIterable<number> {
    let revision = 0
    let seen = 0
    let wake: (() => void) | undefined
    const stop = this.ctx.on('agent-profiles/changed', () => { revision++; wake?.() })
    const abort = (): void => { wake?.() }
    signal.addEventListener('abort', abort, { once: true })
    try {
      while (!signal.aborted) {
        if (revision > seen) { seen = revision; yield revision; continue }
        await new Promise<void>((resolve) => { wake = resolve })
      }
    } finally {
      stop()
      signal.removeEventListener('abort', abort)
    }
  }

  /**
   * Read one profile with its instructions.
   * @param request - the id, the project it is resolved in, and optionally the exact listed file.
   * @returns the precedence winner, or the named file.
   */
  @Remote
  async get(request: AgentProfileGetRequest): Promise<AgentProfile> {
    const states = this.statesFor(request.workspaceId)
    await this.reread(states)
    const found = this.compose(states, true).profiles.find(profile => profile.id === request.id
      && (request.path === undefined ? profile.shadowedBy === undefined : profile.path === request.path))
    if (found === undefined) throw new RemoteError('agent-profiles/not-found', `No agent named "${request.id}".`, { id: request.id })
    return found as AgentProfile
  }

  /**
   * Write a Jan profile file, replacing a Jan file with the same id in that folder.
   * @param request - the scope, its project, and the fields.
   * @returns the profile as listed after the write.
   */
  @Remote
  async save(request: AgentProfileSaveRequest): Promise<AgentProfileSummary> {
    const problem = draftProblem(request.profile)
    if (problem !== undefined) throw new RemoteError('agent-profiles/invalid', problem, { reason: problem })
    const state = this.janRoot(request.scope, request.workspaceId)
    await this.reread([state])
    const existing = state.scan.profiles.find(profile => profile.id === request.profile.id
      && (request.path === undefined || profile.path === request.path))
    if (request.path !== undefined && existing === undefined) {
      throw new RemoteError('agent-profiles/not-found', `No Jan agent named "${request.profile.id}" at ${request.path}.`, { id: request.profile.id })
    }
    const path = existing?.path ?? join(state.root.path, ...`${request.profile.id}.md`.split('/'))
    if (!inside(state.root.path, path)) throw invalid(`Name "${request.profile.id}" leaves the agents folder.`)
    const text = renderProfile(request.profile)
    if (Buffer.byteLength(text) > this.config.maxFileBytes) {
      throw invalid(`The agent file would be larger than ${Math.floor(this.config.maxFileBytes / 1024)} KiB; shorten its instructions.`)
    }
    await writeFileAtomic(path, text, { mode: 0o644 })
    this.modelWarnings.delete(path)
    await this.rescan([state])
    const saved = this.compose([state], false).profiles.find(profile => profile.path === path)
    if (saved === undefined) throw invalid(`The saved file ${path} could not be read back.`)
    return saved
  }

  /**
   * Delete a Jan profile file.
   * @param request - the scope, its project, and the id.
   */
  @Remote
  async deleteProfile(request: AgentProfileRemoveRequest): Promise<void> {
    const state = this.janRoot(request.scope, request.workspaceId)
    await this.reread([state])
    const existing = state.scan.profiles.find(profile => profile.id === request.id
      && (request.path === undefined || profile.path === request.path))
    if (existing === undefined) {
      const scope = request.scope === 'project' ? request.workspaceId : undefined
      const foreign = (await this.list(scope === undefined ? {} : { workspaceId: scope }))
        .profiles.find(profile => profile.id === request.id && profile.scope === request.scope)
      if (foreign !== undefined) throw new RemoteError('agent-profiles/read-only', `${foreign.path} belongs to another tool.`, { path: foreign.path })
      throw new RemoteError('agent-profiles/not-found', `No Jan agent named "${request.id}".`, { id: request.id })
    }
    await rm(existing.path, { force: true })
    this.modelWarnings.delete(existing.path)
    await this.rescan([state])
  }

  /**
   * Select a profile for a chat at a turn boundary and switch the chat to the profile's model.
   * The selection is logged; the model is applied on every call, the event only when the id changes.
   * @param request - the chat and the profile id, or null for plain Jan.
   */
  @Remote
  async select(request: AgentProfileSelectRequest): Promise<void> {
    const agent = this.ctx.agents.get(request.sessionId)
    if (agent === undefined) {
      throw new RemoteError('agent-profiles/session-unavailable', 'The chat is not open.', { sessionId: request.sessionId })
    }
    const previous = this.selections.get(agent.id) ?? Promise.resolve()
    const run = previous.then(() => this.applySelection(agent, request.id, request.keepModel === true))
    const guard = run.catch(() => undefined)
    this.selections.set(agent.id, guard)
    try {
      await run
    } finally {
      if (this.selections.get(agent.id) === guard) this.selections.delete(agent.id)
    }
  }

  /**
   * Profiles one project sees, from memory; empty for folders not read yet.
   * @param workspaceId - the project, or none for global profiles only.
   * @returns the same result {@link list} returns once every folder is read.
   */
  snapshot(workspaceId?: WorkspaceId): AgentProfileList {
    return this.compose(this.statesFor(workspaceId), false)
  }

  /**
   * Profile id a chat selected.
   * @param session - the chat's session.
   * @returns the id, or null when the chat runs as plain Jan.
   */
  profileForSession(session: Session): string | null {
    return this.projection.stateOf(session)
  }

  /**
   * Whether a chat ever recorded a profile choice, plain Jan included.
   * @param session - the chat's session.
   * @returns true once any selection was logged, so a project default must leave the chat alone.
   */
  hasSelection(session: Session): boolean {
    return this.chosenProjection.stateOf(session)
  }

  /**
   * Project a chat belongs to.
   * @param agent - the chat.
   * @returns the project listing the chat, else the innermost project folder holding its folder.
   */
  projectOf(agent: Agent): WorkspaceId | undefined {
    const workspaces = this.ctx.workspaceRegistry.list()
    const listed = workspaces.find(workspace => workspace.sessionIds.includes(agent.id))
    if (listed !== undefined) return listed.id
    const cwd = agent.session.header.cwd
    if (cwd === undefined) return undefined
    let best: { id: WorkspaceId; path: string } | undefined
    for (const workspace of workspaces) {
      if (inside(workspace.path, cwd) && (best === undefined || workspace.path.length > best.path.length)) best = workspace
    }
    return best?.id
  }

  /**
   * Profile a live chat selected, pinned as first read for the chat's lifetime. Later edits to the file reach the
   * chat only when the profile is picked again or the chat is reopened, so a hot edit never rewrites a running
   * chat's system prompt or tool set and its cached prompt prefix stays reusable.
   * @param agent - the chat.
   * @returns the profile, or undefined for plain Jan or a selection no visible profile matches.
   */
  selectedProfile(agent: Agent): AgentProfile | undefined {
    const id = this.profileForSession(agent.session)
    if (id === null) return undefined
    const pinned = this.pinned.get(agent.id)
    if (pinned?.id === id) return pinned
    const found = this.compose(this.statesFor(this.projectOf(agent)), true).profiles
      .find(profile => profile.id === id && profile.shadowedBy === undefined) as AgentProfile | undefined
    if (found !== undefined) this.pinned.set(agent.id, found)
    return found
  }

  /**
   * Tool limits of a chat's selected profile.
   * @param agent - the chat.
   * @returns Jan tool names and `mcp:<server>` entries; an empty deny list without a profile.
   */
  toolLimitsFor(agent: Agent): AgentToolLimits {
    const profile = this.selectedProfile(agent)
    if (profile === undefined) return { deny: [] }
    return { ...profile.tools === undefined ? {} : { allow: profile.tools }, deny: profile.disallowedTools }
  }

  /**
   * Tool restriction for a delegated agent running one profile, with `mcp:<server>` expanded to tool names.
   * @param profile - the profile.
   * @returns the restriction, or undefined when the profile limits no tool.
   */
  toolRestrictionOf(profile: AgentProfileSummary): ToolRestriction | undefined {
    const definitions = this.ctx.get('tools')?.definitions() ?? []
    const allow = profile.tools === undefined ? undefined : expandMcpServerEntries(profile.tools, definitions)
    const deny = expandMcpServerEntries(profile.disallowedTools, definitions)
    if (allow === undefined && deny.length === 0) return undefined
    return { ...allow === undefined ? {} : { allow }, ...deny.length === 0 ? {} : { deny } }
  }

  /**
   * Resolve a profile's model against the current model catalog. A `provider/model` route must list the model;
   * a bare id takes the first provider listing it; a Claude alias takes the highest `claude-<alias>-<version>` match,
   * comparing from `claude-` on so route prefixes do not decide, with the earlier provider winning a tie.
   * @param model - the profile's model.
   * @returns the route, or undefined when no available model matches.
   */
  async resolveModel(model: AgentProfileModel): Promise<ResolvedProfileModel | undefined> {
    const controller = this.ctx.get('sessionController') as ModelCatalogSource | undefined
    if (controller === undefined) return undefined
    const { groups } = await controller.modelCatalog()
    const effort = model.reasoningEffort === undefined ? {} : { reasoningEffort: model.reasoningEffort }
    if (model.provider !== undefined) {
      const group = groups.find(candidate => candidate.id === model.provider)
      if (group?.models.some(candidate => candidate.id === model.model) !== true) return undefined
      return { provider: group.id, model: model.model, ...effort }
    }
    const exact = groups.find(group => group.models.some(candidate => candidate.id === model.model))
    if (exact !== undefined) return { provider: exact.id, model: model.model, ...effort }
    if (!CLAUDE_ALIASES.has(model.model)) return undefined
    const pattern = new RegExp(`claude-${model.model}-.*$`)
    const matches = groups.flatMap(group => group.models.flatMap((candidate) => {
      const version = pattern.exec(candidate.id)?.[0]
      return version === undefined ? [] : [{ provider: group.id, id: candidate.id, version }]
    }))
    const [newest] = matches.sort((left, right) => left.version < right.version ? 1 : left.version > right.version ? -1 : 0)
    return newest === undefined ? undefined : { provider: newest.provider, model: newest.id, ...effort }
  }

  private async applySelection(agent: Agent, id: string | null, keepModel: boolean): Promise<void> {
    if (this.ctx.agents.turnBoundaryOf(agent.session).openTurnStartSeq !== null) {
      throw new RemoteError('agent-profiles/locked', 'Wait for the running turn to finish before changing the agent.', { sessionId: agent.id })
    }
    // An explicit pick, even of the same profile, takes the file as it is now.
    this.pinned.delete(agent.id)
    let profile: AgentProfileSummary | undefined
    if (id !== null) {
      const workspaceId = this.projectOf(agent)
      const { profiles } = await this.list(workspaceId === undefined ? {} : { workspaceId })
      profile = profiles.find(candidate => candidate.id === id && candidate.shadowedBy === undefined)
      if (profile === undefined) throw new RemoteError('agent-profiles/not-found', `No agent named "${id}".`, { id })
      if (profile.use === 'subagent') throw invalid(`Agent "${id}" only runs delegated tasks.`)
    }
    if (this.profileForSession(agent.session) !== id || !this.hasSelection(agent.session)) {
      agent.session.append('agent-profile/selected', { agentProfile: id })
      this.ctx.emit('agent-profiles/changed')
    }
    if (!keepModel && profile?.model !== undefined) await this.applyModel(agent, profile, profile.model)
  }

  private async applyModel(agent: Agent, profile: AgentProfileSummary, model: AgentProfileModel): Promise<void> {
    const resolved = await this.resolveModel(model)
    const llm = this.ctx.get('llm')
    if (resolved === undefined || llm === undefined) {
      const label = model.provider === undefined ? model.model : `${model.provider}/${model.model}`
      this.modelWarnings.set(profile.path, `model "${label}" is not available`)
      return
    }
    this.modelWarnings.delete(profile.path)
    const selection: ModelSelection = {
      provider: resolved.provider, model: resolved.model,
      ...resolved.reasoningEffort === undefined ? {} : { reasoningEffort: ReasoningEffortId(resolved.reasoningEffort) },
    }
    await llm.resolveCallConfig(selection)
    agent.model.select(selection)
  }

  private promptText(agent: Agent): string {
    const profile = this.selectedProfile(agent)
    if (profile === undefined) return ''
    return [`Agent: ${profile.id}`, profile.description.trim(), profile.instructions].filter(part => part !== '').join('\n\n')
  }

  private compose(states: readonly RootState[], withInstructions: boolean): AgentProfileList {
    const winners = new Map<string, string>()
    const profiles: AgentProfileSummary[] = []
    const problems: AgentProfileProblem[] = []
    for (const state of [...states].sort((left, right) => left.root.rank - right.root.rank)) {
      for (const profile of state.scan.profiles) {
        const { instructions, ...summary } = profile
        const winner = winners.get(profile.id)
        if (winner === undefined) winners.set(profile.id, profile.path)
        const warning = this.modelWarnings.get(profile.path)
        profiles.push({
          ...summary,
          ...withInstructions ? { instructions } : {},
          ...warning === undefined ? {} : { warnings: [...summary.warnings, warning] },
          ...winner === undefined ? {} : { shadowedBy: winner },
        })
      }
      problems.push(...state.scan.problems)
    }
    return { profiles, problems }
  }

  private statesFor(workspaceId: WorkspaceId | undefined): RootState[] {
    if (workspaceId === undefined) return this.global
    if (this.ctx.workspaceRegistry.get(workspaceId) === undefined) {
      throw new RemoteError('workspace/not-found', 'The project no longer exists.', { workspaceId })
    }
    return [...this.projectStates(workspaceId), ...this.global]
  }

  private janRoot(scope: AgentProfileScope, workspaceId: WorkspaceId | undefined): RootState {
    if (scope === 'project' && workspaceId === undefined) throw invalid('The project scope needs a project.')
    const states = scope === 'global' ? this.global : this.statesFor(workspaceId).filter(state => state.root.scope === 'project')
    const jan = states.find(state => state.root.source === 'jan')
    if (jan === undefined) throw invalid(`No Jan agents folder for the ${scope} scope.`)
    return jan
  }

  /** Track the folders of every registered project and drop those of removed ones. */
  private syncProjects(): void {
    const current = new Set(this.ctx.workspaceRegistry.list().map(workspace => workspace.id))
    for (const [id, project] of this.projects) {
      if (current.has(id)) continue
      for (const state of project.roots) void state.watch?.close()
      this.projects.delete(id)
    }
    for (const id of current) this.projectStates(id)
  }

  private projectStates(workspaceId: WorkspaceId): RootState[] {
    const path = this.ctx.workspaceRegistry.get(workspaceId)?.path
    const known = this.projects.get(workspaceId)
    if (known !== undefined && known.path === path) return known.roots
    if (known !== undefined) for (const state of known.roots) void state.watch?.close()
    if (path === undefined) {
      this.projects.delete(workspaceId)
      return []
    }
    const roots = projectRoots(path).map(root => this.track(root))
    this.projects.set(workspaceId, { path, roots })
    if (known === undefined) void Promise.all(roots.map(state => state.scanned)).then(() => { this.changed() })
    return roots
  }

  private track(root: AgentRoot): RootState {
    const state: RootState = { root, scan: { profiles: [], problems: [] }, scanned: Promise.resolve(), dirty: false }
    state.scanned = this.read(state)
    // Shipped profiles change only with an update, which restarts the Host.
    if (root.source === 'builtin') return state
    state.watch = watchRoot(root.path, () => {
      state.dirty = true
      this.schedule()
    }, (error) => { this.ctx.logger.warn(`agent-profiles: watching ${root.path} failed: ${(error as Error).message}`) })
    return state
  }

  private async read(state: RootState): Promise<void> {
    try {
      state.scan = await scanRoot(state.root, this.config.maxFileBytes)
    } catch (error) {
      state.scan = { profiles: [], problems: [{ scope: state.root.scope, path: state.root.path, reason: `could not be read: ${(error as Error).message}` }] }
    }
  }

  private schedule(): void {
    if (this.closing) return
    clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.syncProjects()
      const dirty = [...this.global, ...[...this.projects.values()].flatMap(project => project.roots)].filter(state => state.dirty)
      void this.rescan(dirty)
    }, this.config.debounceMs)
  }

  private async rescan(states: readonly RootState[]): Promise<void> {
    await this.reread(states)
    this.changed()
  }

  /** Read folders again so a list reflects the disk even before the watcher reports a change. */
  private async reread(states: readonly RootState[]): Promise<void> {
    await Promise.all(states.map((state) => {
      state.dirty = false
      state.scanned = state.scanned.then(() => this.read(state))
      return state.scanned
    }))
  }

  private changed(): void {
    if (!this.closing) this.ctx.emit('agent-profiles/changed')
  }
}

function invalid(reason: string): RemoteError {
  return new RemoteError('agent-profiles/invalid', reason, { reason })
}

function inside(parent: string, child: string): boolean {
  const rest = relative(parent, child)
  return rest === '' || (!rest.startsWith('..') && !isAbsolute(rest))
}
