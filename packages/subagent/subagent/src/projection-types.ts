/**
 * Pure client-safe subagent projection vocabulary.
 *
 * @module @janhq/jan-subagent/projection-types
 */

import type { SessionId, SessionSeq } from '@janhq/jan-session/types'

/** Known child modes with their creation labels and names, shared by catalog views. */
export type KnownSubagentCatalogFields =
  | {
    /** A terminal one-shot child. */
    readonly mode: 'one-shot'
    /** Optional durable creation label from the parent catalog. */
    readonly label?: string
  }
  | {
    /** An external execution without a local child Session. */
    readonly mode: 'external'
    /** Optional durable creation label from the parent catalog. */
    readonly label?: string
    /** Name unique among the parent's children; absent on historical entries. */
    readonly name?: string
  }
  | {
    /** A resumable conversation. */
    readonly mode: 'continuable'
    /** Durable creation label from the parent catalog. */
    readonly label: string
    /** Name unique among the parent's children; absent on historical entries. */
    readonly name?: string
    /** Effective sandbox mode fixed at delegation, when a profile supplied a cap. */
    readonly sandboxMode?: 'read-only' | 'workspace-write' | 'danger-full-access'
  }

/** One current direct-child discovery row materialized from parent facts. */
export type SubagentCatalogEntry =
  & {
    readonly id: SessionId
    readonly createdAt: number
    /** Profile id selected at creation; absent when none was recorded. */
    readonly agent?: string
  }
  & (
    | KnownSubagentCatalogFields
    | { readonly mode: 'unknown'; readonly label?: string }
  )

/** Durable active-turn timing for one descriptor-backed child session. */
export interface SubagentTimingProjection {
  /** Milliseconds accumulated across completed turns after the child's own descriptor. */
  settledMs: number
  /** Same-cut bounds of the currently open turn, when one has not reached `turn/end`. */
  active?: {
    /** Start of the open turn. */
    since: number
    /** Latest event time folded into this projection cut. */
    through: number
  }
  /**
   * Whether the latest closed turn after the child's own descriptor completed
   * normally; absent while a turn is open or before one closes.
   */
  lastTurnCompleted?: boolean
}

/** One observed activity, with only a safe tool identifier on tool calls. */
export type SubagentActivityEntry = {
  readonly at: number
  /** Sequence number in the child's log; orders events sharing a timestamp. */
  readonly seq: number
} & (
  | { readonly kind: 'calling-tool'; readonly tool: string | null }
  | { readonly kind: 'preparing' | 'requesting-model' | 'working' | 'waiting-inbox' | 'messaging-parent' | 'finished' | 'failed' | 'stopped' }
)

/** Current stage and the last six observed stage starts, oldest first. */
export interface SubagentActivityProjection {
  readonly current: SubagentActivityEntry
  readonly recent: readonly SubagentActivityEntry[]
}

/**
 * Durable identity of one descriptor-backed subagent session: lifecycle mode
 * plus the creation label and optional profile id, folded last-wins from `subagent/descriptor` events.
 * Label strength follows the descriptor schema: a continuable child always
 * carries one, a one-shot child may omit it.
 */
export type SubagentIdentityProjection =
  | {
    /** A terminal one-shot child. */
    mode: 'one-shot'
    /** Optional durable creation label from the child's descriptor. */
    label?: string
    /**
     * Seq of the `subagent/descriptor` event this identity was folded from.
     * `session.isOwnSeq(seq)` proves the identity comes from the child's
     * OWN log suffix — where a descriptor is immutable once appended — and
     * not from a fork seed's replayed ancestor descriptor.
     */
    seq: SessionSeq
  }
  | {
    /** A resumable conversation. */
    mode: 'continuable'
    /** Durable creation label from the child's descriptor. */
    label: string
    /** Profile id selected at creation; absent when none was recorded. */
    agent?: string
    /** Seq of the folded descriptor event; see the one-shot arm for the own-suffix proof. */
    seq: SessionSeq
  }

declare module '@janhq/jan-session-projection/types' {
  interface SessionProjectionMap {
    /** Direct children in parent catalog event order, excluding fork-inherited facts. */
    subagentCatalog: SubagentCatalogEntry[]
    /** Active-turn duration and latest closed-turn completion for a descriptor-backed subagent session. */
    subagentTiming: SubagentTimingProjection
    /** Bounded activity of a session-backed child; null until its own descriptor is observed. */
    subagentActivity: SubagentActivityProjection | null
    /**
     * Identity of a descriptor-backed subagent session. `null` ⟺ no valid
     * descriptor (missing, malformed, or unrecognized-version — deliberately
     * undistinguished). The sentinel is deliberately serializable: a
     * value pushed over JSON transports must survive `JSON.stringify`
     * losslessly, where an `undefined` field would be dropped and a stale
     * identity would survive on the receiving side. The entry itself stays
     * non-optional.
     */
    subagent: SubagentIdentityProjection | null
  }
}
