/** Wire and storage shapes of settings that resolve per chat, then per project, then globally. */
import type {} from '@janhq/jan-typert-protocol'

declare module '@janhq/jan-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** The scope address or the values do not fit the scope written. */
    'scoped-settings/invalid': { readonly reason: string }
  }
}

/** Where one stored value applies: every chat, the chats of one project, or one chat. */
export type SettingScope = 'global' | 'project' | 'session'

/** Default model of a project's new chats. */
export interface ScopedModel {
  /** Provider route id. */
  readonly provider: string
  /** Model id on that route. */
  readonly model: string
  /** Reasoning effort the route accepts; absent keeps the model's default. */
  readonly reasoningEffort?: string
}

/** Values one scope stores; an absent key inherits from the next wider scope. */
export interface ScopedValues {
  /** Model new chats start on. Project scope only. */
  readonly model?: ScopedModel | undefined
  /** Agent preset (mode) new chats start in. Project scope only. */
  readonly mode?: string
  /** Agent profile id new chats select by default. Project scope only. */
  readonly agent?: string | undefined
  /** Tool names, or `mcp:<server>` for every tool of one MCP server, switched off. */
  readonly toolsDisabled?: string[]
  /** Skill names switched off. */
  readonly skillsDisabled?: string[]
  /** Absolute skill folders (the root that holds `<name>/SKILL.md` or `<name>.md`) whose skills are switched off. */
  readonly skillFoldersDisabled?: string[]
}

/** One write: a key set to `null` returns it to the wider scope's value. */
export interface ScopedValuesPatch {
  readonly model?: ScopedModel | null
  readonly mode?: string | null
  /** Default agent profile id, or `null` to clear it. Project scope only. */
  readonly agent?: string | null
  readonly toolsDisabled?: string[] | null
  readonly skillsDisabled?: string[] | null
  readonly skillFoldersDisabled?: string[] | null
}

/** Address of one stored scope; `id` names the project or chat and is absent for `global`. */
export interface ScopeAddress {
  readonly scope: SettingScope
  readonly id?: string
}

/** A write to one scope. */
export interface ScopedWriteRequest extends ScopeAddress {
  readonly values: ScopedValuesPatch
}

/** Tools a scope can switch off: ordinary tools by name and MCP servers as a whole. */
export interface ScopedToolCatalog {
  /** Global tool names that come from no MCP server. */
  readonly tools: readonly string[]
  /** Names of MCP servers with at least one registered tool. */
  readonly mcpServers: readonly string[]
}

/** Wider scope that switched a skill or folder off, so a narrower scope cannot turn it back on. */
export type InheritedOff = 'global' | 'project'

/** One skill a scope can switch off. */
export interface ScopedSkillEntry {
  readonly name: string
  readonly description: string
  /** Off at the scope being read. */
  readonly off: boolean
  /** Off at a wider scope, by name or by its folder; absent when no wider scope switched it off. */
  readonly offAt?: InheritedOff
}

/** Skills grouped by the folder that holds them. */
export interface ScopedSkillFolder {
  /** Absolute folder path; `null` for skills without a file (built in to a plugin). */
  readonly path: string | null
  /** Path shown to people, `~/...` under the home directory; `null` with `path`. */
  readonly label: string | null
  /** Folder off at the scope being read; always false without a path. */
  readonly off: boolean
  /** Folder off at a wider scope. */
  readonly offAt?: InheritedOff
  readonly skills: readonly ScopedSkillEntry[]
}

/** Every skill a chat in a scope could load, with that scope's and wider scopes' switches. */
export interface ScopedSkillCatalog {
  readonly folders: readonly ScopedSkillFolder[]
}

/** Switch lists every scope stores; each resolves as the union of the scopes that apply. */
export type ScopeListKey = 'toolsDisabled' | 'skillsDisabled' | 'skillFoldersDisabled'

/** Keys of {@link ScopeListKey}, in storage order. */
export const SCOPE_LIST_KEYS: readonly ScopeListKey[] = ['toolsDisabled', 'skillsDisabled', 'skillFoldersDisabled']

/** Persisted document at `$JAN_HOME/settings/scoped.json`. */
export interface ScopedSettingsDocument {
  readonly version: 1
  readonly global: Pick<ScopedValues, ScopeListKey>
  readonly projects: Readonly<Record<string, ScopedValues>>
  readonly sessions: Readonly<Record<string, Pick<ScopedValues, ScopeListKey>>>
}

/** Prefix of a `toolsDisabled` entry that names a whole MCP server. */
export const MCP_SERVER_PREFIX = 'mcp:'
