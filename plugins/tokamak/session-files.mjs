/**
 * Files the Tokamak tools read from and write to the calling Session's working directory.
 * @module @janhq/jan-tokamak/session-files
 */

import { mkdir, open, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { HarnessError } from '@janhq/jan-llm'

/**
 * @typedef {import('@janhq/cordis').Context} Context
 * @typedef {import('@janhq/jan-tools').ToolExecution} ToolExecution
 * @typedef {{ agent: NonNullable<ToolExecution['agent']>, cwd: string, root: FsTarget }} SessionWorkspace
 * @typedef {import('@janhq/jan-fs').FsTarget} FsTarget Brings `ctx.fs` and filesystem events into the Context type.
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
 * Write media in the Session workspace. Default filenames reserve the whole batch exclusively before writing,
 * so even concurrent calls can keep their numbered files together without replacing another call's output.
 * @param {Context} ctx - with `fs`.
 * @param {SessionWorkspace} at - the Session workspace.
 * @param {string | undefined} requested - the model's path, if any.
 * @param {string} fallback - default relative path.
 * @param {string} extension - the output format's extension with its dot.
 * @param {readonly Uint8Array[]} data - output files in order.
 * @param {ToolExecution} exec - the tool call, including its cancellation and write policy.
 * @returns {Promise<string[]>} the host paths written.
 */
export async function writeOutputs(ctx, at, requested, fallback, extension, data, exec) {
  const { signal } = exec
  const explicit = requested?.trim()
  const base = explicit || fallback
  const lower = base.toLowerCase()
  const path = lower.endsWith(extension) || (extension === '.jpeg' && lower.endsWith('.jpg'))
    ? base : `${base.replace(/\.[A-Za-z0-9]+$/, '')}${extension}`

  /** @param {string} candidate */
  async function resolveOutput(candidate) {
    const target = await ctx.fs.resolve(candidate, { cwd: at.cwd, signal })
    if (!ctx.fs.contains(at.root, target)) throw new HarnessError(`Save files inside the working directory, not at ${candidate}.`, 'TOKAMAK_PATH_OUTSIDE')
    return target
  }

  if (explicit) {
    const files = []
    for (const [index, candidate] of numberedPaths(path, data.length).entries()) {
      const target = await resolveOutput(candidate)
      const file = ctx.fs.processPath(target)
      // This binary writer cannot do version-guarded replacement, so any negotiated guard means no clobber.
      const intent = await ctx.waterfall('fs/write-intent', target, exec, () => undefined)
      await mkdir(dirname(file), { recursive: true })
      try {
        await writeFile(file, /** @type {Uint8Array} */ (data[index]), { signal, flag: intent === undefined ? 'w' : 'wx' })
      } catch (error) {
        if (intent !== undefined && /** @type {NodeJS.ErrnoException} */ (error).code === 'EEXIST') {
          throw new HarnessError(`Cannot overwrite ${candidate}. Choose a new path.`, 'TOKAMAK_PATH_EXISTS')
        }
        throw error
      }
      files.push(file)
    }
    return files
  }

  for (let attempt = 1; ; attempt += 1) {
    const candidate = attempt === 1 ? path : path.replace(/(\.[a-z0-9]+)$/i, `-v${attempt}$1`)
    /** @type {{ file: string, handle: import('node:fs/promises').FileHandle }[]} */
    const reserved = []
    let writing = false
    let written = 0
    try {
      for (const output of numberedPaths(candidate, data.length)) {
        const file = ctx.fs.processPath(await resolveOutput(output))
        await mkdir(dirname(file), { recursive: true })
        signal.throwIfAborted()
        reserved.push({ file, handle: await open(file, 'wx') })
      }
      writing = true
      for (const [index, { handle }] of reserved.entries()) {
        await handle.writeFile(/** @type {Uint8Array} */ (data[index]), { signal })
        written += 1
      }
      return reserved.map(({ file }) => file)
    } catch (error) {
      if (writing || /** @type {NodeJS.ErrnoException} */ (error).code !== 'EEXIST') throw error
    } finally {
      await Promise.all(reserved.map(async ({ file, handle }, index) => {
        await handle.close()
        if (index >= written) await unlink(file)
      }))
    }
  }
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
  if (!ctx.fs.contains(at.root, target)) throw new HarnessError(`Read files inside the working directory, not at ${path}.`, 'TOKAMAK_PATH_OUTSIDE')
  const info = await ctx.fs.stat(target, signal)
  if (info === undefined || info.type !== 'file') throw new HarnessError(`Cannot read ${path}: file not found.`, 'TOKAMAK_INVALID_ARGS')
  return ctx.fs.readBytes(target, signal, maxBytes)
}
