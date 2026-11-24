/**
 * Wire types of the agent-profile catalog: named profiles read from Jan, `.agents`, Claude Code,
 * opencode and Codex agent folders, and the requests that list, edit and select them.
 * @module @janhq/jan-agent-profiles/types
 */
import type {} from '@janhq/cordis'
import type { SessionId } from '@janhq/jan-session'
import type {} from '@janhq/jan-session-projection/types'
import type {} from '@janhq/jan-typert-protocol'
import type { WorkspaceId } from '@janhq/jan-workspace'

declare module '@janhq/cordis' {
  interface Events {
    /**
     * A profile file was added, changed or removed, or a chat's selected profile changed.
     * Readers re-list profiles and re-apply tool limits.
     * @mode emit
     */
    'agent-profiles/changed'(): void
  }
}

declare module '@janhq/jan-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** No visible profile has the requested id. */
    'agent-profiles/not-found': { readonly id: string }
    /** The request does not name a usable profile, scope or file. */
    'agent-profiles/invalid': { readonly reason: string }
    /** The file belongs to another tool; copy it to a Jan folder to edit it. */
    'agent-profiles/read-only': { readonly path: string }
    /** A turn is open, so the chat's profile cannot change yet. */
    'agent-profiles/locked': { readonly sessionId: SessionId }
    /** The chat is not open. */
    'agent-profiles/session-unavailable': { readonly sessionId: SessionId }
  }
}

declare module '@janhq/jan-session-projection/types' {
  interface SessionProjectionMap {
    /** Agent profile the Session selected, or null for plain Jan. */
    agentProfile: string | null
  }
}

/** Where a profile applies: one project, or every project. */
export type AgentProfileScope = 'project' | 'global'

/** Tool whose folder layout a profile file follows; only `jan` folders are writable. */
export type AgentProfileSource = 'jan' | 'agents' | 'claude' | 'opencode' | 'codex'

/** Whether a profile can run a chat (`primary`), a delegated task (`subagent`), or both. */
export type AgentProfileUse = 'primary' | 'subagent' | 'all'

/**
 * Model a profile asks for. Without `provider` the id is resolved against the model catalog at selection;
 * a Claude alias (`sonnet`, `opus`, `haiku`, `fable`) stays unresolved until then.
 */
export interface AgentProfileModel {
  readonly provider?: string
  readonly model: string
  readonly reasoningEffort?: string
}

/** One profile as listed, without its instructions. */
export interface AgentProfileSummary {
  /** Unique within a scope; may contain `/` for opencode subfolders. */
  readonly id: string
  readonly description: string
  readonly use: AgentProfileUse
  readonly scope: AgentProfileScope
  readonly source: AgentProfileSource
  /** Absolute path of the profile file. */
  readonly path: string
  /** True only for files in a Jan folder. */
  readonly writable: boolean
  readonly model?: AgentProfileModel
  /** Jan tool names and `mcp:<server>` entries that stay visible; absent means every tool. */
  readonly tools?: readonly string[]
  /** Jan tool names and `mcp:<server>` entries removed from visibility. */
  readonly disallowedTools: readonly string[]
  /** Keys and values the file declares that Jan could not map. */
  readonly warnings: readonly string[]
  /** Path of the higher-precedence file with the same id; a shadowed profile is never selected. */
  readonly shadowedBy?: string
}

/** One profile with the instructions it adds to the system prompt. */
export interface AgentProfile extends AgentProfileSummary {
  readonly instructions: string
}

/** A file in an agent folder that could not be read as a profile. */
export interface AgentProfileProblem {
  readonly scope: AgentProfileScope
  readonly path: string
  readonly reason: string
}

/** Profiles visible to one project (project first, then global), and unreadable files. */
export interface AgentProfileList {
  readonly profiles: readonly AgentProfileSummary[]
  readonly problems: readonly AgentProfileProblem[]
}

/** Fields a Jan profile file stores. */
export interface AgentProfileDraft {
  readonly id: string
  readonly description: string
  readonly use: AgentProfileUse
  readonly model?: AgentProfileModel
  readonly tools?: readonly string[]
  readonly disallowedTools?: readonly string[]
  readonly instructions: string
}

/** Request for {@link AgentProfileList}; without a project only global profiles are listed. */
export interface AgentProfileListRequest {
  readonly workspaceId?: WorkspaceId
}

/** Request for one profile by id, resolved with project-over-global precedence. */
export interface AgentProfileGetRequest {
  readonly id: string
  readonly workspaceId?: WorkspaceId
  /** Read this exact listed file, shadowed or not, instead of the precedence winner. */
  readonly path?: string
}

/** Write a Jan profile file into the project or global Jan agent folder. */
export interface AgentProfileSaveRequest {
  readonly scope: AgentProfileScope
  /** Required for the project scope. */
  readonly workspaceId?: WorkspaceId
  readonly profile: AgentProfileDraft
  /** Replace this exact Jan file, which must hold the same id; without it the first Jan file with the id is replaced. */
  readonly path?: string
}

/** Delete a Jan profile file from the project or global Jan agent folder. */
export interface AgentProfileRemoveRequest {
  readonly scope: AgentProfileScope
  readonly workspaceId?: WorkspaceId
  readonly id: string
  /** Delete this exact Jan file, which must hold the same id. */
  readonly path?: string
}

/** Select a profile for a chat at a turn boundary; `null` returns the chat to plain Jan. */
export interface AgentProfileSelectRequest {
  readonly sessionId: SessionId
  readonly id: string | null
  /** Record the selection without switching the chat to the profile's model. */
  readonly keepModel?: boolean
}

/** Tool limits one chat's profile imposes, in Jan tool names and `mcp:<server>` entries. */
export interface AgentToolLimits {
  /** Names that stay visible; absent means every tool. */
  readonly allow?: readonly string[]
  readonly deny: readonly string[]
}
