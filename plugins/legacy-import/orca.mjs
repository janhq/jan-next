import { execFile } from 'node:child_process'
import { resolve, sep } from 'node:path'
import { promisify } from 'node:util'

/**
 * Orca as an import source. Orca keeps no transcripts of its own: its agents (OMP, Claude Code,
 * Codex) write theirs to their usual folders, and each transcript records the folder it ran in.
 * Orca supplies the workspaces and the projects they belong to, read through its public CLI.
 */

const run = promisify(execFile)

/**
 * The Orca CLI. Orca exports `ORCA_CLI_COMMAND` in the sessions it manages; on Linux the bare
 * `orca` name is the GNOME screen reader, so the desktop app's CLI there is `orca-ide`.
 * @param {NodeJS.ProcessEnv} env - the process environment.
 * @param {NodeJS.Platform} platform - the Host's operating system.
 * @returns {string} the command to run.
 */
export const orcaCommand = (env = process.env, platform = process.platform) =>
  env.ORCA_CLI_COMMAND || (platform === 'linux' ? 'orca-ide' : 'orca')

/**
 * Orca's workspaces on this machine, each with the project it belongs to.
 * @param {(command: string, args: string[], options: object) => Promise<{ stdout: string }>} exec - runs the CLI.
 * @param {string} command - the Orca CLI.
 * @returns {Promise<{ path: string, name: string, project: string }[]>} unarchived local workspaces.
 */
export async function orcaWorkspaces(exec = run, command = orcaCommand()) {
  const call = async args => {
    let stdout
    try {
      ({ stdout } = await exec(command, [...args, '--json'], { timeout: 60_000, maxBuffer: 64 * 1024 * 1024, windowsHide: true }))
    } catch (error) {
      if (error?.code === 'ENOENT') throw new Error(`Orca's \`${command}\` command is not on PATH. Install Orca, or start Jan from an Orca terminal.`)
      throw new Error(`Orca did not answer \`${command} ${args.join(' ')}\`. Open Orca and try again.`)
    }
    let body
    try { body = JSON.parse(stdout) } catch { throw new Error(`Orca printed an unreadable reply to \`${command} ${args.join(' ')}\`.`) }
    if (!body?.ok) throw new Error(body?.error?.message ?? `Orca refused \`${command} ${args.join(' ')}\`.`)
    return body.result
  }
  const [{ repos = [] }, { worktrees = [] }] = await Promise.all([call(['repo', 'list']), call(['worktree', 'list'])])
  const projects = new Map(repos.map(repo => [repo.id, repo.displayName]))
  // Remote hosts' paths name another machine's disk, which this Host cannot read.
  return worktrees
    .filter(tree => !tree.isArchived && (tree.hostId ?? 'local') === 'local' && typeof tree.path === 'string')
    .map(tree => {
      const path = resolve(tree.path)
      return { path, name: String(tree.displayName || path.split(sep).at(-1)), project: String(projects.get(tree.repoId) ?? '') }
    })
}

/**
 * The workspace a session ran in: the one whose folder holds its working directory, the
 * innermost when workspaces nest (a worktree inside a folder workspace).
 * @param {{ path: string }[]} workspaces - from {@link orcaWorkspaces}.
 * @param {string | undefined} cwd - the session's working directory.
 * @param {NodeJS.Platform} platform - the Host's operating system; Windows and macOS paths ignore case.
 * @returns {object | undefined} the workspace, or undefined when the session ran outside every one.
 */
export function workspaceOf(workspaces, cwd, platform = process.platform) {
  if (typeof cwd !== 'string' || !cwd) return undefined
  const key = path => platform === 'linux' ? path : path.toLowerCase()
  const target = key(resolve(cwd))
  let best
  for (const workspace of workspaces) {
    const root = key(resolve(workspace.path))
    const inside = target === root || target.startsWith(root.endsWith(sep) ? root : root + sep)
    if (inside && (!best || workspace.path.length > best.path.length)) best = workspace
  }
  return best
}
