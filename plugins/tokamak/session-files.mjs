/**
 * Files the Tokamak tools read from and write to the calling Session's working directory.
 * @module @janhq/jan-tokamak/session-files
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { HarnessError } from '@janhq/jan-llm'

/**
 * @typedef {import('@janhq/cordis').Context} Context
 * @typedef {import('@janhq/jan-tools').ToolExecution} ToolExecution
 * @typedef {{ agent: NonNullable<ToolExecution['agent']>, cwd: any, root: any }} SessionWorkspace
 * @typedef {import('@janhq/jan-fs').FsTarget} FsTarget Brings `ctx.fs` into the Context type.
 * @typedef {import('@janhq/jan-working-directory').WorkingDirectoryService} WorkingDirectoryService Brings `ctx.workingDirectory` into the Context type.
 */

/**
 * The working directory of the calling Session and its filesystem target.
 * @param {Context} ctx - with `agents`, `workingDirectory` and `fs`.
 * @param {ToolExecution} exec - the tool call.
 * @returns {Promise<SessionWorkspace>} the workspace.
 */
export async function sessionWorkspace(ctx, exec) {
  const agent = exec.agent
  if (agent === undefined || ctx.agents.get(agent.id) !== agent) throw new HarnessError('Tokamak tools require a live Jan Session.', 'TOKAMAK_NO_SESSION')
  const cwd = await ctx.workingDirectory.ensure(agent, exec.signal)
  return { agent, cwd, root: await ctx.fs.resolve(cwd, { signal: exec.signal }) }
}

/**
 * Output file names for `count` files: the path, then `-2`, `-3`, ... before its extension.
 * @param {string} path - first file's relative path.
 * @param {number} count - how many files.
 * @returns {string[]} one path per file.
 */
export function numberedPaths(path, count) {
  const dot = path.lastIndexOf('.')
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  const [stem, extension] = dot > slash ? [path.slice(0, dot), path.slice(dot)] : [path, '']
  return Array.from({ length: count }, (_, index) => index === 0 ? path : `${stem}-${index + 1}${extension}`)
}

/**
 * A default relative file name from free text, under `folder/`.
 * @param {string} folder - folder under the working directory, such as `images`.
 * @param {string} text - prompt or text the file is named after.
 * @param {string} extension - extension with its dot.
 * @returns {string} a slash-separated relative path.
 */
export function defaultPath(folder, text, extension) {
  // NFKD splits accented letters into a letter and a combining mark; dropping the mark keeps "chào" as "chao".
  const slug = text.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '')
  return `${folder}/${slug || folder.replace(/s$/, '')}${extension}`
}

/**
 * The paths to write: an explicit path as given (its extension matched to the format), else the default with a
 * `-v2`, `-v3` suffix instead of overwriting an existing file.
 * @param {Context} ctx - with `fs`.
 * @param {SessionWorkspace} at - the Session workspace.
 * @param {string | undefined} requested - the model's path, if any.
 * @param {string} fallback - default relative path.
 * @param {string} extension - the format's extension with its dot.
 * @param {number} count - how many files.
 * @param {AbortSignal} signal - the tool call's signal.
 * @returns {Promise<string[]>} relative paths, one per file.
 */
export async function outputPaths(ctx, at, requested, fallback, extension, count, signal) {
  const explicit = requested?.trim()
  if (explicit) {
    const lower = explicit.toLowerCase()
    const matches = lower.endsWith(extension) || (extension === '.jpeg' && lower.endsWith('.jpg'))
    return numberedPaths(matches ? explicit : `${explicit.replace(/\.[A-Za-z0-9]+$/, '')}${extension}`, count)
  }
  let candidate = fallback
  for (let attempt = 2; await anyExists(ctx, at, numberedPaths(candidate, count), signal); attempt += 1) {
    candidate = fallback.replace(/(\.[a-z0-9]+)$/, `-v${attempt}$1`)
  }
  return numberedPaths(candidate, count)
}

/**
 * Whether any of the paths already exists.
 * @param {Context} ctx - with `fs`.
 * @param {SessionWorkspace} at - the Session workspace.
 * @param {string[]} paths - relative paths.
 * @param {AbortSignal} signal - the tool call's signal.
 */
async function anyExists(ctx, at, paths, signal) {
  for (const path of paths) {
    if (await ctx.fs.stat(await ctx.fs.resolve(path, { cwd: at.cwd, signal }), signal) !== undefined) return true
  }
  return false
}

/**
 * Write one file inside the working directory.
 * @param {Context} ctx - with `fs`.
 * @param {SessionWorkspace} at - the Session workspace.
 * @param {string} path - relative path.
 * @param {Uint8Array} data - file bytes.
 * @param {AbortSignal} signal - the tool call's signal.
 * @returns {Promise<string>} the host path written.
 */
export async function writeInside(ctx, at, path, data, signal) {
  const target = await ctx.fs.resolve(path, { cwd: at.cwd, signal })
  if (!ctx.fs.contains(at.root, target)) throw new HarnessError(`Save files inside the working directory, not at ${path}.`, 'TOKAMAK_PATH_OUTSIDE')
  const hostPath = ctx.fs.processPath(target)
  await mkdir(dirname(hostPath), { recursive: true })
  await writeFile(hostPath, data, { signal })
  return hostPath
}

/**
 * Read one file of the working directory.
 * @param {Context} ctx - with `fs`.
 * @param {SessionWorkspace} at - the Session workspace.
 * @param {string} path - relative path.
 * @param {number} maxBytes - largest file accepted.
 * @param {AbortSignal} signal - the tool call's signal.
 * @returns {Promise<Uint8Array>} the bytes.
 */
export async function readInside(ctx, at, path, maxBytes, signal) {
  const target = await ctx.fs.resolve(path, { cwd: at.cwd, signal })
  const info = await ctx.fs.stat(target, signal)
  if (info === undefined || info.type !== 'file') throw new HarnessError(`Cannot read ${path}: file not found.`, 'TOKAMAK_INVALID_ARGS')
  return ctx.fs.readBytes(target, signal, maxBytes)
}
