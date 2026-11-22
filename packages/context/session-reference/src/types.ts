/**
 * Public session-reference request, candidate, and preparation records.
 * Imports stay on type-only subpaths so generated Remote clients can consume
 * this module without Host runtime code.
 * @module @janhq/jan-session-reference/types
 */

import type { UserMessage } from '@janhq/jan-llm/message'
import type { ContentBlock } from '@janhq/jan-llm/types'
import type { OptionalSessionSeq, SessionId } from '@janhq/jan-session/types'

/**
 * The chats one direct message pointed at. Their content is not loaded: the
 * model reads a mentioned chat on demand with `read_chat`.
 */
export interface SessionReferencePointerSource {
  kind: 'session-reference'
  /** Material about another session's log (`recall` context form). */
  form: 'recall'
  version: 2
  references: {
    sessionId: string
    label: string
    /** The mentioned chat's project folder; null when it has none or no longer exists. */
    cwd: string | null
    inputIndex: number
  }[]
}

/**
 * Durable source session, cited event seqs, and snapshot facts recorded by
 * Hosts that loaded a bounded preview of each mentioned chat. No longer
 * written; logs that hold it stay readable.
 */
export interface SessionReferenceSnapshotSource {
  kind: 'session-reference'
  /** Material lifted out of another session's log (`recall` context form). */
  form: 'recall'
  version: 1
  references: {
    sessionId: string
    label: string
    /** Source Session format generation; absence identifies version 0. */
    capturedFormatVersion?: number
    capturedThroughSeq: OptionalSessionSeq
    compacted: boolean
    originalMessages: number
    retainedMessages: number
    omittedMessages: number
    omittedBytes: number
    truncated: boolean
    inputIndex: number
  }[]
}

/** Session-reference context in a log: a pointer, or a preview from older Hosts. */
export type SessionReferenceSource = SessionReferencePointerSource | SessionReferenceSnapshotSource

declare module '@janhq/jan-llm' {
  interface MessageSourceMap {
    'session-reference': SessionReferenceSource
  }
}

/** One source session selected by a host. */
export interface SessionReferenceInput {
  /** Opaque source session identity. */
  sessionId: SessionId
  /** Optional user-facing mention label. */
  label?: string
}

/** One host-facing candidate from exact session metadata. */
export interface SessionReferenceCandidate {
  /** Opaque source session identity. */
  sessionId: SessionId
  /** Latest log-backed title, falling back to the opaque session id. */
  label: string
  /** Display and canonical-mention text, preferring a subagent's durable creation label over {@link label}. */
  displayTitle?: string
  /** Source session working directory, when recorded. */
  cwd?: string
  /**
   * True when {@link SessionReferenceCandidate.cwd} is recorded and equals the
   * requesting agent's. Hosts that only surface a distinguishing location
   * read this instead of comparing paths they never received.
   */
  sameWorkspace: boolean
  /** Source session creation time in Unix epoch milliseconds. */
  createdAt: number
}

/** One discovery candidate carrying its canonical prompt mention. */
export interface SessionReferenceMentionCandidate extends SessionReferenceCandidate {
  /** Canonical `@[label](jan-session:…)` mention serialized into the prompt draft. */
  mention: string
}

/** Direct message content and optional referenced-session context. */
export interface PreparedReferencedMessage {
  /** Readable message content after host mention tokens are removed. */
  content: ContentBlock[]
  /** The pointer naming each mentioned chat, absent when the message has no references. */
  additionalContext?: UserMessage
}

/** One message of a mentioned chat as `read_chat` reads it. */
export interface ReferencedConversationItem {
  /** Original message role. */
  role: 'user' | 'assistant'
  /** Visible text of that message. */
  text: string
}
