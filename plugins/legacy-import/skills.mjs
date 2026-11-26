// Skills, the global instruction file, and the items that stay behind, read from another agent app.
import { constants } from 'node:fs'
import { copyFile, cp, lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join, relative, isAbsolute } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'

// A copied skill leaves out installed dependencies and version-control data; the skill folder works without them.
const NOT_COPIED = new Set(['node_modules', '.git'])
const missing = error => error?.code === 'ENOENT'
const digest = data => createHash('sha256').update(data).digest('hex')

/**
 * Where one app keeps its skills, its global instruction file, and app-only items Jan cannot run.
 * @param {string} source App id.
 * @param {{ home: string, env: Record<string, string | undefined> }} options Home folder and environment.
 * @returns {{ skills?: string, instructions?: string, others: { label: string, path: string, kind: 'entries' | 'files' }[] }} Paths; absent ones are not used by that app.
 */
export function skillSpecs(source, { home, env }) {
  const claude = env.CLAUDE_CONFIG_DIR || join(home, '.claude')
  const codex = env.CODEX_HOME || join(home, '.codex')
  const omp = join(home, '.omp', 'agent')
  switch (source) {
    case 'omp': return {
      skills: join(omp, 'skills'), instructions: join(omp, 'AGENTS.md'), others: [
        { label: 'OMP plugins', path: join(omp, 'plugins'), kind: 'entries' },
        { label: 'OMP commands', path: join(omp, 'commands'), kind: 'entries' },
        { label: 'OMP rules', path: join(omp, 'rules'), kind: 'entries' },
      ]
    }
    case 'claude': return {
      skills: join(claude, 'skills'), instructions: join(claude, 'CLAUDE.md'), others: [
        { label: 'Claude Code plugins', path: join(claude, 'plugins'), kind: 'entries' },
        { label: 'Claude Code commands', path: join(claude, 'commands'), kind: 'entries' },
        { label: 'Claude Code sub-agents', path: join(claude, 'agents'), kind: 'entries' },
      ]
    }
    case 'codex': return { skills: join(codex, 'skills'), instructions: join(codex, 'AGENTS.md'), others: [] }
    case 'cursor': return { skills: join(home, '.cursor', 'skills'), others: [] }
    default: return { others: [] }
  }
}

const entriesOf = async path => {
  try { return await readdir(path, { withFileTypes: true }) } catch (error) { if (missing(error)) return undefined; throw error }
}
const exists = async path => {
  try { await stat(path); return true } catch (error) { if (missing(error)) return false; throw error }
}
const regularFile = async path => {
  try { return (await lstat(path)).isFile() } catch (error) { if (missing(error) || error?.code === 'ENOTDIR') return false; throw error }
}
const realOrSelf = async path => { try { return await realpath(path) } catch { return path } }
const inside = (parent, child) => {
  const path = relative(parent, child)
  return path === '' || (!path.startsWith('..') && !isAbsolute(path))
}

/**
 * Read one app's skills and instruction file and compare them with what Jan already loads.
 * Nothing is written. A skill is a folder holding `SKILL.md`; one whose name Jan already
 * loads from its own or the shared skills folder is already here.
 * @param {string} source App id.
 * @param {{ janHome: string, agentsHome: string, home?: string, env?: Record<string, string | undefined> }} options Jan's folders, and the home and environment the source paths come from.
 * @returns {Promise<object>} Folders read, skill rows, the instruction file row, items that stay behind, and why skills cannot be copied when that is the case.
 */
export async function readSkillSource(source, { janHome, agentsHome, home = homedir(), env = process.env, approval = false }) {
  const spec = skillSpecs(source, { home, env })
  const target = join(janHome, 'skills')
  const looked = [spec.skills, spec.instructions].filter(Boolean)
  const known = new Set()
  for (const folder of [target, join(agentsHome, 'skills')]) for (const entry of await entriesOf(folder) ?? []) known.add(entry.name)
  const skills = []
  if (spec.skills) {
    const sourceReal = await realOrSelf(spec.skills)
    for (const entry of (await entriesOf(spec.skills) ?? []).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
      const path = await realOrSelf(join(spec.skills, entry.name))
      const definition = join(path, 'SKILL.md')
      if (!await regularFile(definition)) continue
      skills.push({ name: entry.name, path, status: known.has(entry.name) ? 'already here' : 'ready',
        ...(approval ? { digest: digest(await readFile(definition)) } : {}) })
    }
    // Jan's skills folder can be a link to this app's folder or to a folder outside Jan's home; copying
    // there would write into another app's files, so skills are left where they are.
    const targetReal = await realOrSelf(target)
    if (targetReal === sourceReal) for (const row of skills) row.status = 'already here'
    else if (await exists(target) && !inside(await realOrSelf(janHome), targetReal) && skills.some(row => row.status === 'ready')) {
      return { looked, target, skills, linked: targetReal, instructions: await instructionRow(spec.instructions, janHome, approval), others: await otherRows(spec.others) }
    }
  }
  return { looked, target, skills, instructions: await instructionRow(spec.instructions, janHome, approval), others: await otherRows(spec.others) }
}

async function instructionRow(path, janHome, approval) {
  if (!path) return undefined
  let source, text
  try {
    source = await realpath(path)
    text = await readFile(source, 'utf8')
  } catch (error) { if (missing(error)) return undefined; throw error }
  const target = join(janHome, 'AGENTS.md')
  let current
  try { current = await readFile(target, 'utf8') } catch (error) { if (!missing(error)) throw error }
  const status = current === undefined ? 'ready' : current === text ? 'already here' : 'kept yours'
  return { name: basename(path), path: source, target, status, bytes: Buffer.byteLength(text), ...(approval ? { digest: digest(text) } : {}) }
}

async function otherRows(others) {
  const rows = []
  for (const other of others) {
    const entries = (await entriesOf(other.path) ?? []).filter(entry => !entry.name.startsWith('.'))
    if (entries.length) rows.push({ label: other.label, path: other.path, names: entries.map(entry => entry.name.replace(/\.md$/u, '')).sort() })
  }
  return rows
}

/**
 * Copy the ready skills and, when chosen, the instruction file into Jan's home.
 * An existing skill folder or instruction file is never overwritten. Each skill lands
 * through a temporary sibling folder, so a failed copy leaves no half-written skill.
 * @param {object} scan Result of {@link readSkillSource}.
 * @param {{ skills: boolean, names?: string[], instructions: boolean }} choice What the user ticked; `names` limits skills to those, absent brings every ready one.
 * @returns {Promise<object>} Skills imported, already here and failed, and the instruction file outcome.
 */
export async function importSkills(scan, { skills, names, instructions }) {
  const result = { imported: [], already: [], failed: [] }
  const chosen = names === undefined ? undefined : new Set(names)
  if (skills) {
    if (scan.linked) result.error = `Jan's skills folder links to ${scan.linked}, so skills were not copied into it.`
    else for (const row of scan.skills) {
      if (chosen !== undefined && !chosen.has(row.name)) continue
      if (row.status !== 'ready') { result.already.push(row.name); continue }
      const destination = join(scan.target, row.name)
      if (await exists(destination)) { result.already.push(row.name); continue }
      const staging = join(scan.target, `.${row.name}.importing-${randomUUID()}`)
      try {
        await cp(row.path, staging, {
          recursive: true, errorOnExist: true, force: false,
          // An approved skill root may be linked, but nothing inside it may be a link.
          filter: async path => !NOT_COPIED.has(basename(path)) && !(await lstat(path)).isSymbolicLink(),
        })
        if (!await regularFile(join(staging, 'SKILL.md'))) throw new Error('The skill no longer has a regular SKILL.md. Scan the source again.')
        await rename(staging, destination)
        result.imported.push(row.name)
      } catch (error) {
        await rm(staging, { recursive: true, force: true }).catch(() => { })
        result.failed.push({ name: row.name, reason: error instanceof Error ? error.message : String(error) })
      }
    }
  }
  if (instructions && scan.instructions) {
    const row = scan.instructions
    if (row.status !== 'ready' || await exists(row.target)) result.instructions = { name: row.name, status: row.status === 'kept yours' ? 'kept yours' : 'already here' }
    else {
      try {
        await copyFile(row.path, row.target, constants.COPYFILE_EXCL)
        result.instructions = { name: row.name, status: 'imported' }
      } catch (error) { result.instructions = { name: row.name, status: 'failed', reason: error instanceof Error ? error.message : String(error) } }
    }
  }
  return result
}

const skillSlug = name => {
  const slug = name.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '').slice(0, 64).replace(/-+$/g, '')
  return /^(?:aux|con|nul|prn|com[1-9]|lpt[1-9])$/u.test(slug) ? `skill-${slug}` : slug
}

/** Install complete user-invocable export skills without replacing any existing skill. */
export async function installExportSkills(entries, { janHome, agentsHome, skills }) {
  const failed = reason => entries.map(({ id, name, botId }) => ({ id, name, botId, status: 'failed', reason }))
  if (!skills) return failed('skills-unavailable')
  let root, known
  try {
    await mkdir(janHome, { recursive: true, mode: 0o700 })
    const home = await realpath(janHome), target = join(home, 'skills')
    try { await mkdir(target, { mode: 0o700 }) } catch (error) { if (error.code !== 'EEXIST') throw error }
    root = await realpath(target)
    if (root === home || !inside(home, root)) return failed('skills-outside-home')
    known = new Set((await skills.list?.() ?? []).map(row => row.name.toLowerCase()))
    for (const folder of [root, ...(agentsHome ? [join(agentsHome, 'skills')] : [])]) {
      for (const entry of await entriesOf(folder) ?? []) known.add(entry.name.replace(/\.md$/iu, '').toLowerCase())
    }
  } catch { return failed('skill-import-failed') }
  const outcomes = []
  for (const { id, name, botId, description, instruction } of entries) {
    const row = { id, name, botId }
    const slug = skillSlug(name)
    if (!slug) { outcomes.push({ ...row, status: 'failed', reason: 'skill-name-unsupported' }); continue }
    if (known.has(slug)) { outcomes.push({ ...row, status: 'already-here' }); continue }
    const folder = join(root, slug)
    let created = false
    try {
      await mkdir(folder, { mode: 0o700 })
      created = true
      await writeFile(join(folder, 'SKILL.md'), `---\nname: ${JSON.stringify(slug)}\ndescription: ${JSON.stringify(description || name)}\ndisable-model-invocation: true\n---\n\n${instruction}\n`, { flag: 'wx', mode: 0o600 })
      known.add(slug)
      outcomes.push({ ...row, status: 'imported' })
    } catch (error) {
      if (!created && error.code === 'EEXIST') { outcomes.push({ ...row, status: 'already-here' }); continue }
      if (created) await rm(folder, { recursive: true, force: true }).catch(() => {})
      outcomes.push({ ...row, status: 'failed', reason: 'skill-import-failed' })
    }
  }
  if (outcomes.some(row => row.status === 'imported')) {
    try { await skills.refresh() } catch {
      for (const row of outcomes) if (row.status === 'imported') row.reason = 'skill-refresh-failed'
    }
  }
  return outcomes
}
