/**
 * Configuration vocabulary for the replay-aware basic compaction backend.
 *
 * @module @janhq/jan-compaction-basic/types
 */

declare module '@janhq/jan-llm/types' {
  interface LlmRequestPurposeMap {
    'compaction': true
  }
}

import type { LlmCallConfig } from '@janhq/jan-llm'
import type { Volatile } from '@janhq/cordis'

/** Policy fields shared by the default policy and exact model overrides. */
export interface CompactionPolicyConfig {
  /** Window fraction for pressure; capped at context window minus reserved output and `headroomTokens`. Defaults to `0.8`. */
  thresholdRatio?: number
  /**
   * Additional pressure headroom beyond the routed output reservation. Non-negative integer.
   * Unset, each window keeps its share above `thresholdRatio` (at least a tenth), capped at `65536`.
   */
  headroomTokens?: number
  /** Recent context retained as a fraction of context window minus reserved output tokens. Defaults to `0.16`. */
  retainRatio?: number
  /** Absolute recent-context budget; mutually exclusive with `retainRatio`. */
  retainTokens?: number
  /** Summary provider; set together with `summarizationModel`, or inherit the conversation target. */
  summarizationProvider?: string
  /** Summary model; set together with `summarizationProvider`, or inherit the conversation target. */
  summarizationModel?: string
  /**
   * Provider generation cap for summarization; an explicit cap must be positive. Defaults to an
   * explicit `headroomTokens`, else to the default headroom of the summarizing model's window.
   */
  maxTokens?: number
  /** Extra attempts after the first compaction when pressure remains above threshold. Defaults to `1`. */
  compactionRetries?: number
  /** Maximum retries after canonical context overflow; `0` disables recovery. Defaults to `1`. */
  maxOverflowRetries?: number
}

/** Exact provider/model override merged over the default compaction policy. */
export interface ModelCompactPolicyConfig extends CompactionPolicyConfig {
  /** Registered provider route to match. */
  provider: string
  /** Exact routed model id to match within `provider`. */
  model: string
}

/** Basic compaction configuration with an optional exact-target policy table. */
export interface BasicCompactionConfig extends CompactionPolicyConfig {
  /** Exact provider/model overrides; duplicate targets fail plugin load. */
  modelPolicies?: ModelCompactPolicyConfig[]
  /** Enable automatic step-boundary pressure and overflow-recovery listeners. Defaults to `true`. */
  auto?: boolean
}

/** Four top-level settings accept plain values or Loader-managed live references. */
export interface BasicCompactionRuntimeConfig extends Omit<BasicCompactionConfig,
  'auto' | 'thresholdRatio' | 'summarizationProvider' | 'summarizationModel'> {
  /** Live toggle for automatic compaction; manual compaction remains available. */
  auto?: boolean | Volatile<boolean | undefined>
  /** Live context-window pressure fraction. */
  thresholdRatio?: number | Volatile<number | undefined>
  /** Live summary provider, paired with summarizationModel. */
  summarizationProvider?: string | Volatile<string | undefined>
  /** Live summary model, paired with summarizationProvider. */
  summarizationModel?: string | Volatile<string | undefined>
}

/** Exactly one validated retention form. */
export type ResolvedRetention =
  | { readonly retainRatio: number; readonly retainTokens?: never }
  | { readonly retainRatio?: never; readonly retainTokens: number }

/** Validated policy fields shared before and after exact-target matching. */
interface ResolvedPolicyFields {
  readonly thresholdRatio: number
  /** Absent when unset: the default then scales with each model window. */
  readonly headroomTokens?: number
  readonly summarizationProvider: string
  readonly summarizationModel: string
  /** Absent when neither it nor `headroomTokens` is set: the cap then follows the summarizing window. */
  readonly maxTokens?: number
  readonly compactionRetries: number
  readonly maxOverflowRetries: number
}

/** Validated immutable config whose target-specific defaults remain unresolved. */
export type ResolvedConfig = ResolvedPolicyFields & ResolvedRetention & {
  readonly modelPolicies: readonly Readonly<ModelCompactPolicyConfig>[]
  readonly auto: boolean
}

/** Fully merged policy for one routed conversation target, before capacity scaling. */
export type ResolvedTargetPolicy = ResolvedPolicyFields & ResolvedRetention & {
  readonly target: Pick<LlmCallConfig, 'provider' | 'model'>
}

/** One routed model's concrete pressure and retention budget. */
export type ResolvedCompactSpec = Omit<ResolvedTargetPolicy, 'retainRatio' | 'retainTokens' | 'headroomTokens' | 'maxTokens'> & {
  /** Adapter-declared full window; token budgets below exclude reserved output tokens. */
  readonly contextWindow: number
  readonly thresholdTokens: number
  readonly retainTokens: number
  /** Summary cap for this target: the policy's cap, else its effective headroom. */
  readonly maxTokens: number
}
