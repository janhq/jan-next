/** Reads Workspace Git metadata without running Git. */
import { constants } from 'node:fs'
import { open, realpath, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { WorkspaceView } from './types.ts'

type GitMetadata = Pick<WorkspaceView, 'githubOwner' | 'repository' | 'branch'>
type GitCheckout = { readonly head: string; readonly metadata: GitMetadata }
const MAX_METADATA_BYTES = 1024 * 1024
const checkouts = new Map<string, Promise<GitCheckout | undefined>>()

/**
 * Cache discovered repository identity and the GitHub origin by path; read HEAD on every projection.
 * @param directory - canonical Workspace directory, inside or at the root of a checkout.
 * @returns available Git metadata, or undefined outside a Git checkout.
 */
export async function gitMetadataOf(directory: string): Promise<GitMetadata | undefined> {
  let checkout = checkouts.get(directory)
  if (checkout === undefined) {
    checkout = readCheckout(directory)
    checkouts.set(directory, checkout)
  }
  const git = await checkout
  if (git === undefined) {
    if (checkouts.get(directory) === checkout) checkouts.delete(directory)
    return undefined
  }
  const head = (await readText(git.head))?.trim()
  const branch = head === undefined ? undefined : /^ref: refs\/heads\/(\S+)$/.exec(head)?.[1]
    ?? (/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(head) ? head.slice(0, 7) : undefined)
  return branch === undefined ? git.metadata : { ...git.metadata, branch }
}

async function readCheckout(directory: string): Promise<GitCheckout | undefined> {
  const dirs = await findGitDirs(directory)
  if (dirs === undefined) return undefined
  let repository: string
  try {
    repository = await realpath(dirs.common)
  } catch {
    return undefined
  }
  const githubOwner = githubOriginOwner(await readText(join(repository, 'config')))
  return {
    head: join(dirs.checkout, 'HEAD'),
    metadata: githubOwner === undefined ? { repository } : { repository, githubOwner },
  }
}

function githubOriginOwner(config: string | undefined): string | undefined {
  if (config === undefined) return undefined
  const section = /^[ \t]*\[remote[ \t]+"origin"\][ \t\r]*$([\s\S]*?)(?=^[ \t]*\[|(?![\s\S]))/m.exec(config)?.[1]
  const url = section === undefined ? undefined : /^[ \t]*url[ \t]*=[ \t]*(\S+)[ \t\r]*$/m.exec(section)?.[1]
  if (url === undefined) return undefined
  // scp-like `git@github.com:owner/repo.git`, `ssh://git@github.com/owner/repo` and `https://github.com/owner/repo.git`.
  return /^(?:[\w+.-]+:\/\/)?(?:[^@/]+@)?github\.com(?::\d+)?[:/]([a-z0-9][a-z0-9-]{0,38})\/[\w.-]+?\/?$/i.exec(url)?.[1]
}

/** The nearest `.git` directory at or above `directory`; a worktree's `.git` file leads to its shared common directory. */
async function findGitDirs(directory: string): Promise<{ checkout: string; common: string } | undefined> {
  for (let current = directory; ; current = dirname(current)) {
    const candidate = join(current, '.git')
    const kind = await entryKind(candidate)
    if (kind === 'directory') return { checkout: candidate, common: candidate }
    if (kind === 'file') {
      const pointer = /^gitdir:([^\r\n]*)/m.exec(await readText(candidate) ?? '')?.[1]?.trim()
      if (pointer === undefined || pointer === '') return undefined
      const checkout = resolve(current, pointer)
      const common = (await readText(join(checkout, 'commondir')))?.trim()
      return { checkout, common: common ? resolve(checkout, common) : checkout }
    }
    if (dirname(current) === current) return undefined
  }
}

async function entryKind(path: string): Promise<'file' | 'directory' | undefined> {
  try {
    const stats = await stat(path)
    return stats.isDirectory() ? 'directory' : stats.isFile() ? 'file' : undefined
  } catch {
    return undefined
  }
}

async function readText(path: string): Promise<string | undefined> {
  try {
    // Nonblocking open avoids getting stuck on a FIFO even if the path was
    // replaced after inspection. Only read a regular file from the open handle.
    await using file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK)
    const stats = await file.stat()
    if (!stats.isFile() || stats.size > MAX_METADATA_BYTES) return undefined
    const data = Buffer.allocUnsafe(stats.size + 1)
    let offset = 0
    while (offset < data.length) {
      const { bytesRead } = await file.read(data, offset, data.length - offset, offset)
      if (bytesRead === 0) return data.toString('utf8', 0, offset)
      offset += bytesRead
    }
    // Do not parse a partial config when the file grew after stat.
    return undefined
  } catch {
    return undefined
  }
}
