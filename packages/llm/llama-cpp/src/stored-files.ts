import type { Stats } from 'node:fs'
import { lstat, readdir, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'

/**
 * Whether a path lies strictly inside a root.
 * @param root - containing directory.
 * @param path - candidate path.
 * @returns true when the path is below the root and not the root itself.
 */
export function isBelow(root: string, path: string): boolean {
  const rel = relative(root, path)
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

/**
 * Treat a missing file as absent instead of an error.
 * @param operation - file system call.
 * @returns its result, or undefined when the path does not exist.
 */
export async function ifPresent<T>(operation: Promise<T>): Promise<T | undefined> {
  try { return await operation }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return undefined
  }
}

/**
 * Resolve the Jan home once, but never follow links below it, even to another Jan-owned root.
 * @param home - Jan data folder.
 * @param root - Jan-owned directory below it.
 * @returns the canonical directory, or undefined when absent, linked, or outside the home.
 */
export async function managedRoot(home: string, root: string): Promise<string | undefined> {
  if (!isBelow(home, root)) return undefined
  const base = await ifPresent(realpath(home))
  if (base === undefined) return undefined
  const expected = join(base, relative(home, root))
  if (await ifPresent(realpath(expected)) !== expected) return undefined
  return (await ifPresent(lstat(expected)))?.isDirectory() ? expected : undefined
}

/**
 * A regular file below a managed root that is neither linked nor hard-linked elsewhere.
 * @param root - canonical managed directory.
 * @param file - candidate file.
 * @returns its stats, or undefined when it must not be listed or deleted.
 */
export async function managedFile(root: string, file: string): Promise<Stats | undefined> {
  if (!isBelow(root, file) || await ifPresent(realpath(file)) !== file) return undefined
  const info = await ifPresent(lstat(file))
  return info?.isFile() && info.nlink === 1 ? info : undefined
}

/**
 * The downloader uses this two-level layout, including artifacts left before an install committed.
 * @param root - canonical models directory.
 * @returns each model file with its model id and whether it is a partial download.
 */
export async function* modelFiles(root: string): AsyncIterable<{ id: string; file: string; partial: boolean }> {
  for (const dir of await ifPresent(readdir(root, { withFileTypes: true })) ?? []) {
    if (!dir.isDirectory() || !/^[a-z0-9_][a-z0-9._-]*$/.test(dir.name)) continue
    const path = join(root, dir.name)
    if (await ifPresent(realpath(path)) !== path) continue
    for (const file of await ifPresent(readdir(path, { withFileTypes: true })) ?? []) {
      if (!file.isFile() || !/^(?:mmproj-)?[0-9a-f]{16}\.gguf(?:\.partial)?$/.test(file.name)) continue
      yield { id: dir.name, file: join(path, file.name), partial: file.name.endsWith('.partial') }
    }
  }
}
