/** The GitHub account behind a Workspace folder's `origin`, read from Git's own files without running Git. */
import { constants } from 'node:fs'
import { open, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

const MAX_METADATA_BYTES = 1024 * 1024
const owners = new Map<string, Promise<string | undefined>>()

/**
 * The owner login of the folder's `origin` remote when it points at github.com.
 * Read once per path for the life of the process; a remote added later shows after a restart.
 * @param directory - canonical Workspace directory, the repository root or any folder inside it.
 * @returns the owner, e.g. `janhq`, or undefined outside a GitHub checkout.
 */
export function githubOwnerOf(directory: string): Promise<string | undefined> {
  let owner = owners.get(directory)
  if (owner === undefined) {
    owner = readGithubOwner(directory)
    owners.set(directory, owner)
  }
  return owner
}

async function readGithubOwner(directory: string): Promise<string | undefined> {
  const gitDir = await findGitDir(directory)
  if (gitDir === undefined) return undefined
  const config = await readText(join(gitDir, 'config'))
  if (config === undefined) return undefined
  const section = /^[ \t]*\[remote[ \t]+"origin"\][ \t\r]*$([\s\S]*?)(?=^[ \t]*\[|(?![\s\S]))/m.exec(config)?.[1]
  const url = section === undefined ? undefined : /^[ \t]*url[ \t]*=[ \t]*(\S+)[ \t\r]*$/m.exec(section)?.[1]
  if (url === undefined) return undefined
  // scp-like `git@github.com:owner/repo.git`, `ssh://git@github.com/owner/repo` and `https://github.com/owner/repo.git`.
  return /^(?:[\w+.-]+:\/\/)?(?:[^@/]+@)?github\.com(?::\d+)?[:/]([a-z0-9][a-z0-9-]{0,38})\/[\w.-]+?\/?$/i.exec(url)?.[1]
}

/** The nearest `.git` directory at or above `directory`; a worktree's `.git` file leads to its shared common directory. */
async function findGitDir(directory: string): Promise<string | undefined> {
  for (let current = directory; ; current = dirname(current)) {
    const candidate = join(current, '.git')
    const kind = await entryKind(candidate)
    if (kind === 'directory') return candidate
    if (kind === 'file') {
      const pointer = /^gitdir:([^\r\n]*)/m.exec(await readText(candidate) ?? '')?.[1]?.trim()
      if (pointer === undefined || pointer === '') return undefined
      const worktreeDir = resolve(current, pointer)
      const common = (await readText(join(worktreeDir, 'commondir')))?.trim()
      return common === undefined || common === '' ? worktreeDir : resolve(worktreeDir, common)
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
