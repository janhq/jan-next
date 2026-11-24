/**
 * Wire types of the `/context` breakdown: what one chat's next request is made of,
 * split into categories and named entries, against the model's context window.
 * @module @janhq/jan-context-usage/types
 */

/** Category identifiers, in display order. */
export const CONTEXT_CATEGORIES = [
  'systemPrompt',
  'instructionFiles',
  'skills',
  'janTools',
  'mcpTools',
  'injectedContext',
  'userMessages',
  'compactionSummary',
  'assistantMessages',
  'assistantThinking',
  'toolCalls',
  'toolOutput',
] as const

/** One category of request content. */
export type ContextCategoryId = typeof CONTEXT_CATEGORIES[number]

/** One named part of a category, such as a prompt section, a tool or an instruction file. */
export interface ContextUsageEntry {
  /** Display name: a section name, tool name, MCP server, file path or content kind. */
  readonly label: string
  /** Tokens attributed to this entry after scaling to {@link ContextUsage.usedTokens}. */
  readonly tokens: number
}

/** One category's share of the request. */
export interface ContextUsageCategory {
  readonly id: ContextCategoryId
  /** Tokens after scaling the heuristic share to {@link ContextUsage.usedTokens}. */
  readonly tokens: number
  /**
   * Named parts, largest first. Entries are scaled with the same factor as their
   * category, so after rounding they may not add up to it exactly.
   */
  readonly entries: readonly ContextUsageEntry[]
}

/** A chat's context occupancy and composition at one moment. */
export interface ContextUsage {
  /** Model route the figures describe, when the chat has one. */
  readonly model?: { readonly provider: string; readonly model: string }
  /** Route capacity in tokens; absent when no adapter advertises one. */
  readonly contextWindow?: number
  /**
   * Tokens the next request occupies. `provider` anchors the figure to the last
   * provider-reported prompt size plus the estimated change since; `estimate`
   * means no provider has reported usage yet.
   */
  readonly usedTokens: number
  readonly usedSource: 'provider' | 'estimate'
  /** Tokens at which automatic compaction runs; absent when it is off or unknown for this route. */
  readonly autoCompactTokens?: number
  /** Non-empty categories in {@link CONTEXT_CATEGORIES} order; their tokens sum to {@link usedTokens}. */
  readonly categories: readonly ContextUsageCategory[]
}
