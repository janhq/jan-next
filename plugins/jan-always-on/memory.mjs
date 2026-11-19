import { constants } from 'node:fs'
import { lstat, mkdir, open, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomic } from '@janhq/jan-atomic-write'

const AUTOMATIC = ['instructions.md', 'index.md', 'reported.md']
const FOLDERS = ['notes', 'progress']
const MAX_CONTEXT_BYTES = 4096
const MAX_FILE_BYTES = 32768
const FILE_NAME = /^(?:notes|progress)\/[a-z0-9][a-z0-9_-]{0,79}\.md$/u
const DEVICE_NAME = /^(?:aux|con|nul|prn|com[1-9]|lpt[1-9])\.md$/u

/** @returns Whether this is a portable Markdown path in the workspace memory. */
export function isMemoryPath(path) {
  return typeof path === 'string' && (AUTOMATIC.includes(path)
    || FILE_NAME.test(path) && !DEVICE_NAME.test(path.split('/')[1]))
}

async function safeDirectory(path) {
  await mkdir(path, { mode: 0o700, recursive: true })
  if (!(await lstat(path)).isDirectory()) throw new Error('memory-path')
}

/** @returns A memory file interface confined to the feature directory. */
export function memoryAt(home) {
  const directory = join(home, 'always-on')
  const root = join(directory, 'memory')

  async function prepare() {
    await safeDirectory(directory)
    await safeDirectory(root)
    for (const folder of FOLDERS) await safeDirectory(join(root, folder))
  }
  async function target(path) {
    if (!isMemoryPath(path)) throw new Error('memory-path')
    await prepare()
    const filename = join(root, ...path.split('/'))
    try {
      const existing = await lstat(filename)
      if (!existing.isFile() || existing.nlink !== 1) throw new Error('memory-path')
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    return filename
  }
  async function read(path, limit = MAX_FILE_BYTES) {
    const filename = await target(path)
    try {
      const handle = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
      try {
        const stat = await handle.stat()
        if (!stat.isFile() || stat.nlink !== 1) throw new Error('memory-path')
        const buffer = Buffer.alloc(Math.min(stat.size, limit))
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
        return { text: buffer.toString('utf8', 0, bytesRead), truncated: stat.size > limit }
      } finally { await handle.close() }
    } catch (error) {
      if (error.code === 'ENOENT') return { text: '', truncated: false }
      throw error
    }
  }
  return {
    read,
    async index() {
      await prepare()
      const files = [...AUTOMATIC]
      for (const folder of FOLDERS) {
        for (const entry of await readdir(join(root, folder), { withFileTypes: true })) {
          const path = `${folder}/${entry.name}`
          if (entry.isFile() && isMemoryPath(path)) files.push(path)
        }
      }
      return files.sort()
    },
    async context() {
      return Object.fromEntries(await Promise.all(AUTOMATIC.map(async path => [path, await read(path, MAX_CONTEXT_BYTES)])))
    },
    validate(path, text) {
      if (!isMemoryPath(path)) throw new Error('memory-path')
      if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_FILE_BYTES) throw new Error('memory-size')
    },
    async write(path, text, signal) {
      this.validate(path, text)
      const filename = await target(path)
      signal?.throwIfAborted()
      await writeFileAtomic(filename, text, { mode: 0o600, dirMode: 0o700 })
    },
  }
}
