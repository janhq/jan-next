/**
 * Agent folders of each supported tool, how one folder is read, and how it is watched.
 * @module @janhq/jan-agent-profiles/roots
 */
import { lstat, readdir, readFile, stat } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import chokidar from 'chokidar'
import { parseProfile } from './parse.ts'
import type { AgentProfile, AgentProfileProblem, AgentProfileScope, AgentProfileSource } from './types.ts'

/** One agent folder. A lower rank wins when two folders define the same id. */
export interface AgentRoot {
  readonly source: AgentProfileSource
  readonly scope: AgentProfileScope
  readonly path: string
  readonly format: 'md' | 'toml'
  readonly writable: boolean
  readonly rank: number
}

/** Home folders the global roots live in. */
export interface AgentHomes {
  readonly janHome: string
  readonly agentsHome: string
  readonly userHome: string
}

/** Profiles and unreadable files found in one folder, in path order. */
export interface RootScan {
  readonly profiles: readonly AgentProfile[]
  readonly problems: readonly AgentProfileProblem[]
}

/** Folders below a root deeper than this are not read. */
const MAX_DEPTH = 8

/**
 * Agent folders of one project, highest precedence first.
 * @param project - absolute project folder.
 * @returns the five project roots.
 */
export function projectRoots(project: string): AgentRoot[] {
  return [
    { source: 'jan', scope: 'project', path: join(project, '.jan', 'agents'), format: 'md', writable: true, rank: 100 },
    { source: 'agents', scope: 'project', path: join(project, '.agents', 'agents'), format: 'md', writable: false, rank: 110 },
    { source: 'claude', scope: 'project', path: join(project, '.claude', 'agents'), format: 'md', writable: false, rank: 120 },
    { source: 'opencode', scope: 'project', path: join(project, '.opencode', 'agents'), format: 'md', writable: false, rank: 130 },
    { source: 'codex', scope: 'project', path: join(project, '.codex', 'agents'), format: 'toml', writable: false, rank: 140 },
  ]
}

/**
 * Agent folders shared by every project, highest precedence first.
 * @param homes - Jan home, shared agents home and user home.
 * @returns the five global roots.
 */
export function globalRoots(homes: AgentHomes): AgentRoot[] {
  return [
    { source: 'jan', scope: 'global', path: join(homes.janHome, 'agents'), format: 'md', writable: true, rank: 200 },
    { source: 'agents', scope: 'global', path: join(homes.agentsHome, 'agents'), format: 'md', writable: false, rank: 210 },
    { source: 'claude', scope: 'global', path: join(homes.userHome, '.claude', 'agents'), format: 'md', writable: false, rank: 220 },
    { source: 'opencode', scope: 'global', path: join(homes.userHome, '.config', 'opencode', 'agents'), format: 'md', writable: false, rank: 230 },
    { source: 'codex', scope: 'global', path: join(homes.userHome, '.codex', 'agents'), format: 'toml', writable: false, rank: 240 },
  ]
}

/**
 * Profiles Jan ships, read from this package's `agents` folder. They rank below every user folder, so a Jan,
 * Claude, opencode or Codex file with the same id replaces one, and they are never written.
 * @returns the built-in root.
 */
export function builtinRoot(): AgentRoot {
  return { source: 'builtin', scope: 'global', path: fileURLToPath(new URL('../agents/', import.meta.url)), format: 'md', writable: false, rank: 300 }
}

/**
 * Read every profile file below one root. A missing root reads as empty.
 * @param root - the folder.
 * @param maxBytes - files larger than this are listed as problems and not read.
 * @returns profiles and problems in path order.
 */
export async function scanRoot(root: AgentRoot, maxBytes: number): Promise<RootScan> {
  const files = await listFiles(root.path, `.${root.format}`)
  const profiles: AgentProfile[] = []
  const problems: AgentProfileProblem[] = []
  for (const path of files) {
    const problem = (reason: string): void => { problems.push({ scope: root.scope, path, reason }) }
    try {
      const info = await stat(path)
      if (info.size > maxBytes) {
        problem(`larger than ${Math.floor(maxBytes / 1024)} KiB`)
        continue
      }
      const text = await readFile(path, 'utf8')
      const parsed = parseProfile({
        source: root.source, scope: root.scope, writable: root.writable, path,
        relative: relative(root.path, path).split(sep).join('/'), text,
      })
      if ('problem' in parsed) problem(parsed.problem)
      else profiles.push(parsed.profile)
    } catch (error) {
      problem(`could not be read: ${(error as Error).message}`)
    }
  }
  return { profiles, problems }
}

async function listFiles(folder: string, extension: string, depth = 0): Promise<string[]> {
  let entries
  try {
    entries = await readdir(folder, { withFileTypes: true })
  } catch (error) {
    // A root that does not exist, or stopped existing during the walk, holds no profiles.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' || (error as NodeJS.ErrnoException).code === 'ENOTDIR') return []
    throw error
  }
  const files: string[] = []
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.name.startsWith('.')) continue
    const path = join(folder, entry.name)
    if (entry.isDirectory() && depth < MAX_DEPTH) files.push(...await listFiles(path, extension, depth + 1))
    else if ((entry.isFile() || entry.isSymbolicLink()) && entry.name.toLowerCase().endsWith(extension)) files.push(path)
  }
  return files
}

/** A running watch on one root. */
export interface RootWatch {
  close(): Promise<void>
}

/**
 * Watch one root for added, changed and removed files. While the root does not exist its nearest existing
 * ancestor is watched one level deep, and the watch moves down as folders appear.
 * @param path - the root folder.
 * @param changed - called for every relevant file system event and once each time watching starts; callers debounce.
 * @param failed - called when the watcher reports an error; the watch keeps running.
 * @returns a handle that stops the watch.
 */
export function watchRoot(path: string, changed: () => void, failed: (error: unknown) => void): RootWatch {
  const target = resolve(path)
  let closed = false
  let current: { close(): Promise<void> } | undefined
  let opening = Promise.resolve()
  const reopen = (): void => {
    opening = opening.then(async () => {
      await current?.close()
      current = undefined
      if (!closed) current = await open()
    }).catch(failed)
  }
  const open = async (): Promise<{ close(): Promise<void> }> => {
    const anchor = await nearestExisting(target)
    const depth = anchor === target ? MAX_DEPTH : 0
    const watcher = chokidar.watch(anchor, { persistent: true, ignoreInitial: true, atomic: true, depth })
    watcher.on('error', failed)
    watcher.on('all', (event, changedPath) => {
      const at = resolve(changedPath)
      if (anchor === target) {
        changed()
        if (at === target && event === 'unlinkDir') reopen()
      } else if ((event === 'addDir' || event === 'add') && (target === at || target.startsWith(`${at}${sep}`))) {
        changed()
        reopen()
      }
    })
    // Files that changed while the watcher was starting are not reported; one re-read once it is ready covers them.
    watcher.once('ready', changed)
    return {
      close: () => {
        // A late poll after close can still report an error; keep a listener so it is never rethrown.
        const closing = watcher.close()
        watcher.on('error', () => undefined)
        return closing
      },
    }
  }
  reopen()
  return {
    close: async () => {
      closed = true
      await opening
      await current?.close()
      current = undefined
    },
  }
}

async function nearestExisting(path: string): Promise<string> {
  let candidate = path
  for (;;) {
    try {
      if ((await lstat(candidate)).isDirectory() || candidate === path) return candidate
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && (error as NodeJS.ErrnoException).code !== 'ENOTDIR') throw error
    }
    const parent = dirname(candidate)
    if (parent === candidate) return candidate
    candidate = parent
  }
}
