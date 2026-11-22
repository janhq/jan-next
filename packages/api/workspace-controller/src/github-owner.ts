/** The GitHub account behind a Workspace folder's `origin`, read from Git's own files without running Git. */
import { readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const owners = new Map<string, string | null>()

/**
 * The owner login of the folder's `origin` remote when it points at github.com.
 * Read once per path for the life of the process; a remote added later shows after a restart.
 * @param directory - canonical Workspace directory, the repository root or any folder inside it.
 * @returns the owner, e.g. `janhq`, or undefined outside a GitHub checkout.
 */
export function githubOwnerOf(directory: string): string | undefined {
  let owner = owners.get(directory)
  if (owner === undefined) {
    owner = readGithubOwner(directory)
    owners.set(directory, owner)
  }
  return owner ?? undefined
}

function readGithubOwner(directory: string): string | null {
  const gitDir = findGitDir(directory)
  if (gitDir === null) return null
  const config = readText(join(gitDir, 'config'))
  if (config === null) return null
  const section = /^\s*\[remote\s+"origin"\]\s*$([\s\S]*?)(?=^\s*\[|(?![\s\S]))/m.exec(config)?.[1]
  const url = section === undefined ? undefined : /^\s*url\s*=\s*(\S+)\s*$/m.exec(section)?.[1]
  if (url === undefined) return null
  // scp-like `git@github.com:owner/repo.git`, `ssh://git@github.com/owner/repo` and `https://github.com/owner/repo.git`.
  return /^(?:[\w+.-]+:\/\/)?(?:[^@/]+@)?github\.com(?::\d+)?[:/]([a-z0-9][a-z0-9-]{0,38})\/[\w.-]+?\/?$/i.exec(url)?.[1] ?? null
}

/** The nearest `.git` directory at or above `directory`; a worktree's `.git` file leads to its shared common directory. */
function findGitDir(directory: string): string | null {
  for (let current = directory; ; current = dirname(current)) {
    const candidate = join(current, '.git')
    const kind = entryKind(candidate)
    if (kind === 'directory') return candidate
    if (kind === 'file') {
      const pointer = /^gitdir:\s*(.+?)\s*$/m.exec(readText(candidate) ?? '')?.[1]
      if (pointer === undefined) return null
      const worktreeDir = resolve(current, pointer)
      const common = readText(join(worktreeDir, 'commondir'))?.trim()
      return common === undefined || common === '' ? worktreeDir : resolve(worktreeDir, common)
    }
    if (dirname(current) === current) return null
  }
}

function entryKind(path: string): 'file' | 'directory' | null {
  try {
    const stats = statSync(path)
    return stats.isDirectory() ? 'directory' : stats.isFile() ? 'file' : null
  } catch {
    return null
  }
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}
