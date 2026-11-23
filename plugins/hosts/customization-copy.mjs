/**
 * Report the receiving Jan's customizations for older peers. Setup sync also uses this module
 * to find installed skills and identify the MCP settings section.
 */
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, join, relative, sep } from 'node:path'

/** Settings namespace (profile entry id) of the MCP manager. */
export const MCP_NS = 'mcp-manager'
const SKILL_NAME = /^[a-z0-9][a-z0-9._-]*$/i

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function serversOf(descriptor) {
  const servers = descriptor?.value?.servers
  return isRecord(servers) ? servers : {}
}

function realPath(path) {
  try { return realpathSync(path) } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR' || error.code === 'ELOOP') return undefined
    throw error
  }
}

function existsInside(root, path) {
  const fromRoot = relative(root, path)
  return !isAbsolute(fromRoot) && fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`)
}

/**
 * This computer's skill folders under `root`, each a directory holding `SKILL.md`.
 * @param {string} root - a skills folder.
 * @returns {Array<{ name: string, dir: string, description: string }>} the skills, by name.
 */
export function skillFolders(root) {
  if (!existsSync(root)) return []
  const base = realpathSync(root)
  const skills = []
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    if (!SKILL_NAME.test(entry.name)) continue
    const dir = join(base, entry.name)
    const source = entry.isSymbolicLink() ? realPath(dir) : dir
    if (source === undefined || (!entry.isDirectory() && (!entry.isSymbolicLink() || !statSync(source).isDirectory()))) continue
    const skillFile = realPath(join(source, 'SKILL.md'))
    if (skillFile === undefined || !existsInside(source, skillFile) || !statSync(skillFile).isFile()) continue
    const head = readFileSync(skillFile, 'utf8').slice(0, 4000)
    const description = /^description:\s*["']?(.+?)["']?\s*$/m.exec(head)?.[1] ?? ''
    skills.push({ name: entry.name, dir, description })
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * What the other Jan has: answered by the other computer.
 * @param {{ settings: object, janHome: string, pluginManager?: object }} ctx - its settings, Jan home and plugin manager.
 * @returns {Promise<{ servers: string[], skills: string[], bundles: Record<string, { installed: boolean, enabled: boolean }> }>}
 */
export async function customizationState({ settings, janHome, pluginManager }) {
  const servers = Object.keys(serversOf(settings.describe().find(descriptor => descriptor.ns === MCP_NS)))
  const skills = skillFolders(join(janHome, 'skills')).map(skill => skill.name)
  const bundles = {}
  for (const bundle of pluginManager === undefined ? [] : await pluginManager.listBundles()) {
    bundles[bundle.name] = { installed: bundle.installed || bundle.availability === 'installation', enabled: bundle.enabled }
  }
  return { servers, skills, bundles, plugins: pluginManager !== undefined }
}
