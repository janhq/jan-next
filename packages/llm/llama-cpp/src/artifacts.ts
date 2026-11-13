/** A verified download: its digest and size decide whether the bytes are accepted. */
export interface Artifact {
  readonly url: string
  /** Lowercase hex sha256 of the whole file. */
  readonly sha256: string
  readonly bytes: number
}
