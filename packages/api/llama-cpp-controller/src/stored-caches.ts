import { lstat, readdir, realpath, rm, unlink } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import type { StoredDownload } from '@janhq/jan-llama-cpp/types'

// Only filenames emitted by the shipped SenseVoice downloader. Other configured model paths are user files.
const SPEECH_ROOT = 'speech-to-text/sensevoice/models'
const SPEECH_FILES = [
  ['sensevoice-onnx/model.int8.onnx', 'SenseVoice speech model (INT8)'],
  ['sensevoice-onnx/model.onnx', 'SenseVoice speech model (FP32)'],
  ['sensevoice-onnx/tokens.txt', 'SenseVoice speech vocabulary'],
  ['silero/silero_vad.onnx', 'Silero voice detection model'],
] as const

/** One deletable cache entry of the Downloads inventory. */
export interface StoredCache {
  readonly item: StoredDownload
  delete(): Promise<void>
}

async function ifPresent<T>(operation: Promise<T>): Promise<T | undefined> {
  try { return await operation }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return undefined
  }
}

// Paths are constructed only from fixed directories and validated directory entries, not RPC arguments.
// Reject links below the canonical home, even if they happen to point to another Jan-owned root.
async function owned(path: string) {
  if (await ifPresent(realpath(path)) !== path) return undefined
  return await ifPresent(lstat(path))
}

/**
 * List cached files that remain on disk even when the optional voice bundle is disabled.
 * @param home - Jan data folder.
 * @param inUse - reason deletion is refused while speech input runs.
 * @returns the cached speech model files.
 */
export async function speechCaches(home: string, inUse?: string): Promise<StoredCache[]> {
  const root = await ifPresent(realpath(home))
  if (root === undefined) return []
  const result: StoredCache[] = []
  for (const [subpath, name] of SPEECH_FILES) {
    const path = `${SPEECH_ROOT}/${subpath}`
    const file = join(root, path)
    const info = await owned(file)
    if (!info?.isFile() || info.nlink !== 1) continue
    result.push({ item: { name, kind: 'cache', path, bytes: info.size, ...inUse === undefined ? {} : { inUse } },
      async delete() {
        if (inUse !== undefined) throw new Error(inUse)
        const current = await owned(file)
        if (!current?.isFile() || current.nlink !== 1 || current.dev !== info.dev || current.ino !== info.ino) {
          throw new Error('This cache changed on disk. Refresh the list and try again.')
        }
        await unlink(file)
      },
    })
  }
  return result
}

/** The active market service supplies the directory and serializes deletion with its repository fetches. */
export interface RepositoryCacheOwner {
  readonly downloadCacheDirectory: string
  deleteDownloadCache(repository: string, remove: () => Promise<void>): Promise<void>
}

/**
 * List the plugin market's fetched Git repositories inside the Jan data folder.
 * @param home - Jan data folder.
 * @param owner - the market service that owns the repositories.
 * @returns one entry per cached repository.
 */
export async function repositoryCaches(home: string, owner: RepositoryCacheOwner): Promise<StoredCache[]> {
  const rel = relative(home, owner.downloadCacheDirectory)
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || join(home, rel) !== owner.downloadCacheDirectory) return []
  const root = await ifPresent(realpath(home))
  if (root === undefined) return []
  const cache = join(root, rel)
  if (!(await owned(cache))?.isDirectory()) return []
  const result: StoredCache[] = []
  for (const dir of await ifPresent(readdir(cache, { withFileTypes: true })) ?? []) {
    if (!dir.isDirectory() || !/^[0-9a-f]{24}$/.test(dir.name)) continue
    const file = join(cache, dir.name)
    const info = await owned(file)
    if (!info?.isDirectory()) continue
    const bytes = await repositoryBytes(file)
    if (bytes === undefined) continue
    result.push({ item: { name: `Plugin repository cache (${dir.name.slice(0, 8)})`, kind: 'cache',
      path: relative(root, file).split(sep).join('/'), bytes, lastUsed: info.mtimeMs },
    delete: () => owner.deleteDownloadCache(dir.name, async () => {
      const current = await owned(file)
      if (!current?.isDirectory() || current.dev !== info.dev || current.ino !== info.ino || await repositoryBytes(file) === undefined) {
        throw new Error('This cache changed on disk. Refresh the list and try again.')
      }
      await rm(file, { recursive: true })
    }),
    })
  }
  return result
}

async function repositoryBytes(path: string): Promise<number | undefined> {
  if (!(await owned(join(path, 'HEAD')))?.isFile() || !(await owned(join(path, 'objects')))?.isDirectory()) return undefined
  return repositoryTreeBytes(path)
}

async function repositoryTreeBytes(path: string): Promise<number | undefined> {
  const entries = await ifPresent(readdir(path, { withFileTypes: true }))
  if (entries === undefined) return undefined
  let bytes = 0
  for (const entry of entries) {
    const child = join(path, entry.name)
    const info = await owned(child)
    if (info?.isFile() && info.nlink === 1) bytes += info.size
    else if (info?.isDirectory()) {
      const subtree = await repositoryTreeBytes(child)
      if (subtree === undefined) return undefined
      bytes += subtree
    } else return undefined
  }
  return bytes
}
