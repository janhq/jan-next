/**
 * Bring this computer's customizations to a Jan that Hosts started over SSH: MCP servers, skills
 * and plugin bundles, each chosen item by item. Model providers have their own copy in
 * `setup-copy.mjs`. MCP servers and plugins go through the other Jan's own settings and plugin
 * manager, signed in with the tunnel's token; skill folders go as one tar stream over the SSH
 * login, into that Jan's own `skills` folder. The other side keeps anything it already has.
 */
import { spawn } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, readlinkSync, realpathSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { REMOTE_ROOT, runRemote } from './remote-install.mjs'

/** Settings namespace (profile entry id) of the MCP manager. */
export const MCP_NS = 'mcp-manager'
/** Folders no skill needs on another computer: they are rebuilt or belong to this copy's history. */
const SKILL_EXCLUDES = ['.git', 'node_modules', '__pycache__', '.venv']
const SKILL_COPY_MS = 10 * 60_000
const SKILL_NAME = /^[a-z0-9][a-z0-9._-]*$/i

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** A path written for this computer's file system names nothing on another one. */
function localPath(value) {
  return typeof value === 'string' && (/^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\'))
}

/** Why a server cannot run as written on the other computer, or undefined when it can. */
function serverProblem(server) {
  if (localPath(server.command) || localPath(server.cwd)) return 'local-path'
  if (Array.isArray(server.args) && server.args.some(localPath)) return 'local-path'
  return undefined
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

/**
 * The customizations this computer can give the other one, by kind. A server whose command,
 * arguments or folder is a path on this computer, and a bundle this computer installed from a
 * local folder, are listed with `problem` and left unticked: they would not run there.
 * @param {{ settings: object, skillRoots: string[], pluginManager?: object }} ctx - this Host's settings, skill folders and plugin manager.
 * @param {Awaited<ReturnType<typeof customizationState>>} remote - the other Jan's state.
 * @returns {Promise<{ servers: object[], skills: object[], plugins: object[] }>} items the other Jan lacks.
 */
export async function customizationOffer({ settings, skillRoots, pluginManager }, remote) {
  const servers = []
  const there = new Set(remote.servers)
  for (const [name, server] of Object.entries(serversOf(settings.describe().find(descriptor => descriptor.ns === MCP_NS)))) {
    if (there.has(name) || !isRecord(server)) continue
    const problem = serverProblem(server)
    servers.push({ id: name, name, detail: server.url ?? server.command ?? '', ...(problem === undefined ? {} : { problem }) })
  }
  const skills = []
  const seen = new Set(remote.skills)
  for (const root of skillRoots) {
    for (const skill of skillFolders(root)) {
      if (seen.has(skill.name)) continue
      seen.add(skill.name)
      skills.push({ id: skill.name, name: skill.name, detail: skill.description })
    }
  }
  const plugins = []
  if (pluginManager !== undefined && remote.plugins) {
    for (const bundle of await pluginManager.listBundles()) {
      // A bundle the installation ships and selects is part of Jan itself on both sides.
      if (!bundle.enabled || (!bundle.installed && !bundle.optional)) continue
      const theirs = remote.bundles[bundle.name]
      if (theirs?.enabled) continue
      const source = bundle.source ?? bundle.installTarget?.spec ?? (bundle.optional ? undefined : bundle.name)
      const problem = typeof source === 'string' && (localPath(source) || source.startsWith('/') || source.startsWith('file:')) ? 'local-path' : undefined
      plugins.push({
        id: bundle.name, name: bundle.meta?.title ?? bundle.name, detail: bundle.version ?? '',
        install: theirs?.installed === true || bundle.optional ? undefined : source,
        ...(problem === undefined ? {} : { problem }),
      })
    }
  }
  return { servers, skills, plugins }
}

/**
 * Send the chosen MCP servers and plugins to the other Jan through its own API, and the chosen
 * skill folders over SSH.
 * @param {{ settings: object, skillRoots: string[], pluginManager?: object }} ctx - this Host.
 * @param {{ ssh: string[], remote: (endpoint: string, args: object) => Promise<unknown> }} target - the SSH login and a call into the other Jan.
 * @param {{ servers: object[], skills: object[], plugins: object[] }} offer - the current offer.
 * @param {{ servers?: string[], skills?: string[], plugins?: string[] }} chosen - ids picked per kind.
 * @returns {Promise<{ servers: string[], skills: string[], plugins: string[], failed: Array<{ name: string, error: string }> }>} what landed there.
 */
export async function copyCustomizations({ settings, skillRoots }, target, offer, chosen) {
  const pick = (items, ids) => items.filter(item => (ids ?? []).includes(item.id))
  const result = { servers: [], skills: [], plugins: [], failed: [] }

  const servers = pick(offer.servers, chosen.servers)
  if (servers.length > 0) {
    const all = serversOf(settings.describe().find(descriptor => descriptor.ns === MCP_NS))
    const patch = Object.fromEntries(servers.map(item => [item.id, all[item.id]]))
    await target.remote('settings/update', { ns: MCP_NS, patch: { servers: patch } })
    result.servers.push(...servers.map(item => item.name))
  }

  const skills = pick(offer.skills, chosen.skills)
  if (skills.length > 0) {
    const dirs = new Map()
    for (const root of skillRoots) for (const skill of skillFolders(root)) if (!dirs.has(skill.name)) dirs.set(skill.name, skill.dir)
    const selected = skills.map(item => ({ name: item.id, dir: dirs.get(item.id) }))
    if (selected.some(item => item.dir === undefined)) throw new Error('A selected skill is no longer available on this computer.')
    await sendSkills(target.ssh, selected)
    result.skills.push(...skills.map(item => item.name))
  }

  for (const item of pick(offer.plugins, chosen.plugins)) {
    try {
      const change = item.install === undefined
        ? await target.remote('pluginManager/setBundleEnabled', { name: item.id, enabled: true })
        : await target.remote('pluginManager/installBundle', { spec: item.install, options: { enabled: true } })
      const failure = isRecord(change) && Array.isArray(change.failures) && change.failures.length > 0 ? change.failures[0] : undefined
      if (failure !== undefined) throw new Error(failure.message ?? String(failure))
      result.plugins.push(item.name)
    } catch (error) {
      result.failed.push({ name: item.name, error: error instanceof Error ? error.message : String(error) })
    }
  }
  return result
}

/**
 * Stream skill folders into the other Jan's `skills` folder as one tar archive, without
 * following nested links or overwriting existing files.
 * @param {string[]} ssh - ssh arguments.
 * @param {Array<{ name: string, dir: string }>} skills - folders to send, by skill name.
 */
async function sendSkills(ssh, skills) {
  const args = ['-cf', '-', ...SKILL_EXCLUDES.map(name => `--exclude=${name}`)]
  for (const skill of skills) {
    const root = realPath(skill.dir)
    if (root === undefined) throw new Error(`The skill ${skill.name} is no longer available on this computer.`)
    validateSkillLinks(root, root)
    // The final `/.` resolves just the selected root while retaining its name in the archive.
    args.push('-C', dirname(skill.dir), `${skill.name}/.`)
  }
  const tar = spawn('tar', args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  let stderr = ''
  tar.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-4000) })
  // Settles with the failure instead of rejecting, so a pack error that lands while the upload
  // still runs is reported by this call rather than escaping as an unhandled rejection.
  const packed = new Promise((resolve) => {
    tar.once('error', error => resolve(error.code === 'ENOENT' ? new Error('This computer has no tar command.') : error))
    tar.once('close', code => resolve(code === 0 ? undefined : new Error(`Packing the skills failed: ${stderr.trim().split('\n').at(-1) ?? code}`)))
  })
  const dest = `"$HOME"/${REMOTE_ROOT}/home/skills`
  // BSD tar supports -k; GNU tar uses --skip-old-files to skip without a failing exit status.
  const result = await runRemote({ ssh, command: `mkdir -p ${dest} && (case "$(tar --version)" in *"GNU tar"*) tar -x --skip-old-files -f - -C ${dest};; *) tar -xkf - -C ${dest};; esac)`, timeoutMs: SKILL_COPY_MS, input: tar.stdout })
    .finally(() => { if (tar.exitCode === null) tar.kill() })
  const packFailure = await packed
  if (packFailure !== undefined) throw packFailure
  if (result.code !== 0) throw new Error(`The skills could not be unpacked there: ${result.stderr.trim().split('\n').at(-1) ?? result.code}`)
}

function validateSkillLinks(root, directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (SKILL_EXCLUDES.includes(entry.name)) continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) validateSkillLinks(root, path)
    else if (entry.isSymbolicLink()) {
      const link = readlinkSync(path)
      const target = realPath(path)
      if (isAbsolute(link) || !existsInside(root, resolve(directory, link)) || (target !== undefined && !existsInside(root, target))) {
        throw new Error(`The link ${relative(root, path)} points outside the skill.`)
      }
    }
  }
}
