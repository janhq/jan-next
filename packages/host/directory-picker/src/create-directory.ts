/**
 * Host filesystem primitives every backend shares: the fully-qualified path
 * fence and one-child directory creation. A native chooser backend creates
 * folders the same way the browse backend does, so the menu's New folder
 * works whichever backend the Host composes.
 */
import { mkdir } from 'node:fs/promises'
import { join, posix, resolve, win32 } from 'node:path'
import { DirectoryPickerError } from './error.ts'

/**
 * True when the path names one fixed filesystem location regardless of
 * process state: POSIX-absolute on POSIX; on Windows only drive-qualified
 * (`C:\…`) or complete UNC (`\\server\share…`) forms. Rooted drive-less
 * forms (`\foo`, `/foo`) and incomplete UNC prefixes (`\\`, `\\server`)
 * pass `isAbsolute` yet still resolve against the process's current drive.
 * @param path - candidate path.
 * @param platform - replaces `process.platform` for deterministic tests.
 * @returns whether the path is fully qualified on the platform.
 */
export function fullyQualified(path: string, platform: NodeJS.Platform = process.platform): boolean {
  return platform === 'win32'
    ? win32.isAbsolute(path) && /^(?:[A-Za-z]:[\\/]|[\\/]{2}[^\\/]+[\\/]+[^\\/]+)/.test(path)
    : posix.isAbsolute(path)
}

/**
 * Create one child directory under an existing parent.
 * @param path - absolute existing parent directory.
 * @param name - single non-blank path segment (no separators, not `.`/`..`).
 * @returns the created directory's absolute path.
 * @throws {DirectoryPickerError} `directory-exists` for an existing child,
 * `directory-create-failed` for a parent that is not fully qualified or any other failure.
 */
export async function createChildDirectory(path: string, name: string): Promise<string> {
  // Never rebase a parent under the cwd or the current drive.
  if (!fullyQualified(path)) {
    throw new DirectoryPickerError('directory-create-failed', path, `cannot create under "${path}": not a fully qualified parent path`)
  }
  const parent = resolve(path)
  // The backend owns segment validation; the Remote controller also refuses
  // invalid wire input, but direct service consumers must hit the same fence.
  if (name.trim() === '' || name === '.' || name === '..' || /[/\\]/.test(name)) {
    throw new DirectoryPickerError('directory-create-failed', join(parent, name), `"${name}" is not a single path segment`)
  }
  const target = join(parent, name)
  try {
    // Non-recursive: a missing parent is a real failure, not a level to invent.
    await mkdir(target)
    return target
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST') {
      throw new DirectoryPickerError('directory-exists', target, `${target} already exists`)
    }
    /* v8 ignore next -- node:fs rejects with Error instances; the String arm only satisfies the unknown narrowing. */
    const message = error instanceof Error ? error.message : String(error)
    throw new DirectoryPickerError('directory-create-failed', target, `cannot create ${target}: ${message}`)
  }
}
