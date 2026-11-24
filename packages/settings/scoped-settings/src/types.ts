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
  readonly model?: ScopedModel
  /** Agent preset (mode) new chats start in. Project scope only. */
  readonly mode?: string
  /** Tool names, or `mcp:<server>` for every tool of one MCP server, switched off. */
  readonly toolsDisabled?: string[]
}

/** One write: a key set to `null` returns it to the wider scope's value. */
export interface ScopedValuesPatch {
  readonly model?: ScopedModel | null
  readonly mode?: string | null
  readonly toolsDisabled?: string[] | null
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

/** Persisted document at `$JAN_HOME/settings/scoped.json`. */
export interface ScopedSettingsDocument {
  readonly version: 1
  readonly global: Pick<ScopedValues, 'toolsDisabled'>
  readonly projects: Readonly<Record<string, ScopedValues>>
  readonly sessions: Readonly<Record<string, Pick<ScopedValues, 'toolsDisabled'>>>
}

/** Prefix of a `toolsDisabled` entry that names a whole MCP server. */
export const MCP_SERVER_PREFIX = 'mcp:'
