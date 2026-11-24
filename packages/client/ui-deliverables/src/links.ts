/**
 * Shared shape of the `sharedLinks` Session projection: the web links a chat's
 * people and assistant wrote, which the Artifacts library lists beside files.
 * Type-only, so the browser half reads the projection without its fold.
 */

/** One distinct web link a chat mentioned, at its latest mention. */
export interface SharedLinkEntry {
  /** Absolute `http:` or `https:` URL, as `URL.href` spells it. */
  readonly url: string
  /** Markdown link text, when a mention gave one. */
  readonly title?: string
  /** Who wrote the latest mention. */
  readonly from: 'user' | 'assistant'
  /** Message event of the latest mention. */
  readonly seq: number
  /** Unix epoch milliseconds of the latest mention. */
  readonly time: number
}

declare module '@janhq/jan-session-projection/types' {
  interface SessionProjectionMap {
    /** Distinct web links of the Session's own messages, oldest mention first; a repeated link moves to the end. */
    sharedLinks: SharedLinkEntry[]
  }
}
