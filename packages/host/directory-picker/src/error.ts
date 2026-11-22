/** Closed failure vocabulary of the directory primitives (mirrored onto the wire by consumers). */
export type DirectoryPickerErrorCode = 'directory-unreadable' | 'directory-exists' | 'directory-create-failed'

/** Typed failure thrown by directory primitives so consumers can map business codes without string matching. */
export class DirectoryPickerError extends Error {
  /**
   * @param code - closed business code of the failure.
   * @param path - the absolute path the failure is about.
   * @param message - operator-facing description.
   */
  constructor(readonly code: DirectoryPickerErrorCode, readonly path: string, message: string) {
    super(message)
    this.name = 'DirectoryPickerError'
  }
}
