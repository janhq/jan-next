import { lstat, readdir, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'

export function isBelow(root: string, path: string): boolean {
  const rel = relative(root, path)
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

export async function ifPresent<T>(operation: Promise<T>): Promise<T | undefined> {
  try { return await operation }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return undefined
  }
}

/** Resolve the Jan home once, but never follow links below it, even to another Jan-owned root. */
export async function managedRoot(home: string, root: string): Promise<string | undefined> {
  if (!isBelow(home, root)) return undefined
  const base = await ifPresent(realpath(home))
  if (base === undefined) return undefined
  const expected = join(base, relative(home, root))
  if (await ifPresent(realpath(expected)) !== expected) return undefined
  return (await ifPresent(lstat(expected)))?.isDirectory() ? expected : undefined
}

export async function managedFile(root: string, file: string) {
  if (!isBelow(root, file) || await ifPresent(realpath(file)) !== file) return undefined
  const info = await ifPresent(lstat(file))
  return info?.isFile() && info.nlink === 1 ? info : undefined
}

/** The downloader uses this two-level layout, including artifacts left before an install committed. */
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
