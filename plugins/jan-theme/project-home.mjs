/**
 * Project home, Host half: reads and writes one registered Workspace's
 * instruction files and lists or adds its top-level files. `AGENTS.md` holds
 * the project's standing instructions and `AGENTS.local.md` its private notes
 * (Memory); `jan-agent-instructions` loads both into new Sessions there.
 * Every call names a Workspace id, never a path, so only registered project
 * folders are reachable.
 */
import { readFile, readdir, lstat, writeFile, rename, unlink, open, mkdir } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { registerApi } from '@janhq/jan-plugin-api'

const FILES = { instructions: 'AGENTS.md', memory: 'AGENTS.local.md' }
// The instruction loader's own default budget; a larger file would be truncated for the agent.
const MAX_TEXT_BYTES = 65_536
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024
// Base64 expands uploads by a third; leave room for the JSON envelope and file name.
const MAX_REQUEST_BYTES = 34 * 1024 * 1024
const MAX_LISTED = 300

/** @param {import('@janhq/cordis').Context} ctx @param {unknown} id */
function projectPath(ctx, id) {
  const registry = ctx.get('workspaceRegistry')
  const workspace = typeof id === 'string' ? registry?.get(id) : undefined
  if (workspace === undefined) throw new Error('This project is no longer registered in Jan.')
  return workspace.path
}

async function readText(path) {
  try { return await readFile(path, 'utf8') } catch (error) {
    if (error?.code === 'ENOENT') return ''
    throw error
  }
}

/** Replace a file through a temporary sibling, so a failed write never leaves half a file. */
async function writeAtomic(path, text) {
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, text, 'utf8')
    await rename(temporary, path)
  } catch (error) {
    await unlink(temporary).catch(() => { /* The temporary file may never have been created. */ })
    throw error
  }
}

async function listFiles(root) {
  const entries = await readdir(root, { withFileTypes: true })
  const visible = entries.filter(entry => entry.name !== '.git' && entry.name !== 'node_modules')
  const rows = await Promise.all(visible.slice(0, MAX_LISTED).map(async (entry) => {
    const directory = entry.isDirectory()
    let size
    let modified
    try {
      const info = await lstat(join(root, entry.name))
      size = directory ? undefined : info.size
      modified = info.mtimeMs
    } catch (error) {
      // A file removed or locked between readdir and stat is still listed, without details.
      if (error?.code !== 'ENOENT' && error?.code !== 'EPERM' && error?.code !== 'EBUSY') throw error
    }
    return { name: entry.name, directory, size, modified }
  }))
  rows.sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name))
  return { files: rows, truncated: visible.length > MAX_LISTED }
}

function openWithSystem(path) {
  const [command, args] = process.platform === 'win32' ? ['explorer.exe', [path]]
    : process.platform === 'darwin' ? ['open', [path]] : ['xdg-open', [path]]
  const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true })
  child.on('error', error => { console.error('jan-theme: opening the project folder failed', error) })
  child.unref()
}

/** @param {import('@janhq/cordis').Context} ctx */
export function mountProjectHome(ctx) {
  ctx.effect(() => registerApi(ctx, 'project-home', {
    async read({ workspaceId }) {
      const root = projectPath(ctx, workspaceId)
      const [instructions, memory, listing] = await Promise.all([
        readText(join(root, FILES.instructions)), readText(join(root, FILES.memory)), listFiles(root),
      ])
      return { path: root, instructions, memory, ...listing, maxTextBytes: MAX_TEXT_BYTES }
    },
    async save({ workspaceId, kind, text }) {
      const file = FILES[kind]
      if (file === undefined || typeof text !== 'string') throw new Error('Choose instructions or memory to save.')
      const contents = text.endsWith('\n') ? text : `${text}\n`
      if (Buffer.byteLength(contents) > MAX_TEXT_BYTES) throw new Error(`Keep this under ${MAX_TEXT_BYTES / 1024} KB; the agent reads no more than that.`)
      const target = join(projectPath(ctx, workspaceId), file)
      // An emptied file is removed rather than left behind as an empty AGENTS.md.
      if (text.trim() === '') await unlink(target).catch((error) => { if (error?.code !== 'ENOENT') throw error })
      else await writeAtomic(target, contents)
      return { saved: true }
    },
    async addFile({ workspaceId, name, data }) {
      if (typeof name !== 'string' || typeof data !== 'string') throw new Error('Choose a file to add.')
      const safe = basename(name)
      if (safe === '' || safe === '.' || safe === '..' || safe !== name.split(/[\\/]/).at(-1)) throw new Error('That file name cannot be used.')
      const bytes = Buffer.from(data, 'base64')
      if (bytes.length > MAX_UPLOAD_BYTES) throw new Error(`Files over ${MAX_UPLOAD_BYTES / 1024 / 1024} MB cannot be added here.`)
      const root = projectPath(ctx, workspaceId)
      await mkdir(root, { recursive: true })
      // `wx` refuses to replace a file the project already has.
      let handle
      try { handle = await open(join(root, safe), 'wx') } catch (error) {
        if (error?.code === 'EEXIST') throw new Error(`${safe} is already in this project.`)
        throw error
      }
      try { await handle.writeFile(bytes) } finally { await handle.close() }
      return { added: safe }
    },
    openFolder({ workspaceId }) {
      openWithSystem(projectPath(ctx, workspaceId))
      return { opened: true }
    },
  }, { maxBodyBytes: MAX_REQUEST_BYTES }), 'jan-theme: project home')
}
