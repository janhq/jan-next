/** Configuration and stable diagnostics for session references. */

/** Hard maximum references accepted by one message. */
export const MAX_REFERENCES = 3
/** Default number of discovery candidates returned to a host. */
export const DEFAULT_CANDIDATE_LIMIT = 50

/** Session-reference service configuration. */
export interface Config {
  /** Maximum distinct source sessions referenced by one message, from one to three. */
  maxReferences?: number
  /** Default host candidate-list limit. */
  candidateLimit?: number
}

/** Stable failure codes exposed to host adapters and `read_chat` callers. */
export type SessionReferenceErrorCode =
  | 'SESSION_REFERENCE_INVALID_CONFIG'
  | 'SESSION_REFERENCE_INVALID_REFERENCE'
  | 'SESSION_REFERENCE_SELF_REFERENCE'
  | 'SESSION_REFERENCE_TOO_MANY'
  | 'SESSION_REFERENCE_NOT_MENTIONED'
  | 'SESSION_REFERENCE_READ_FAILED'
  | 'SESSION_REFERENCE_CANCELLED'

/** Typed session-reference failure suitable for host protocol error mapping. */
export class SessionReferenceError extends Error {
  /** @param message Human-readable diagnosis. @param code Stable routing code. @param options Optional cause. */
  constructor(
    message: string,
    readonly code: SessionReferenceErrorCode,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'SessionReferenceError'
  }
}
