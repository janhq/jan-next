/** Compare portable setup and apply only the entries approved in a specific preview. */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { HostsError } from './store.mjs'
import { withFileLock } from '@janhq/jan-atomic-write'
import { lstat, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { credentialEndpoint, DEFAULT_MODEL_NS, PROVIDERS_NS } from './setup-copy.mjs'
import { MCP_NS, skillFolders } from './customization-copy.mjs'

const excluded = new Set(['.git', 'node_modules', '__pycache__', '.venv'])
const validId = id => typeof id === 'string' && id !== '__proto__' && id !== 'constructor' && id !== 'prototype'
const pathOnMachine = value => typeof value === 'string' && /^(?:[a-z]:[\\/]|[\\/]|~[\\/]|file:)/i.test(value)
const localEndpoint = value => typeof value === 'string' && /^https?:\/\/(?:localhost|127(?:\.\d+){3}|\[::1\])(?=[:/]|$)/i.test(value)
const canonical = value => Array.isArray(value) ? value.map(canonical) : value !== null && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, canonical(value[key])])) : value
const fingerprint = (key, value) => createHmac('sha256', key).update(JSON.stringify(canonical(value))).digest('hex')
const settingKinds = new Map([['providers', PROVIDERS_NS], ['model', DEFAULT_MODEL_NS], ['servers', MCP_NS]])
const skillName = /^[a-z0-9][a-z0-9._-]*$/i
const fileName = /^(?!\.{1,2}$)(?!.*[. ]$)[^<>:"/\\|?*\x00-\x1f]+$/u
const skillBytes = 512 * 1024

function skillFiles(root, path = [], depth = 0, budget = { bytes: 0, entries: 0 }) {
  if (depth > 24 || ++budget.entries > 2048) throw new Error('Skill has too many entries.')
  const stat = lstatSync(root)
  if (stat.isDirectory()) return readdirSync(root).filter(name => !excluded.has(name)).sort().flatMap(name => {
    if (!fileName.test(name)) throw new Error('Skill names are not portable.')
    return skillFiles(join(root, name), [...path, name], depth + 1, budget)
  })
  if (!stat.isFile() || (budget.bytes += stat.size) > skillBytes) throw new Error('Skill is too large or contains a linked file.')
  return [{ path, data: readFileSync(root).toString('base64'), mode: stat.mode & 0o111 }]
}

async function writeSkill(root, id, files, previous, key) {
  if (!skillName.test(id) || !Array.isArray(files) || !files.some(file => file.path?.length === 1 && file.path[0] === 'SKILL.md')) throw new Error('Invalid skill.')
  const target = join(root, id)
  await mkdir(root, { recursive: true })
  await withFileLock(target, async () => {
    const stage = await mkdtemp(join(root, '.sync-'))
    const next = join(stage, 'next')
    const old = join(stage, 'old')
    let backedUp = false
    try {
      for (const file of files) {
        if (!Array.isArray(file.path) || !file.path.length || !file.path.every(part => typeof part === 'string' && fileName.test(part)) || typeof file.data !== 'string') throw new Error('Invalid skill file.')
        await mkdir(join(next, ...file.path.slice(0, -1)), { recursive: true })
        await writeFile(join(next, ...file.path), Buffer.from(file.data, 'base64'), { flag: 'wx', mode: 0o644 | (file.mode & 0o111) })
      }
      if (previous) {
        if (previous.dir !== target || (await lstat(target)).isSymbolicLink() || skillSnapshot(key, target).digest !== previous.digest) {
          throw new HostsError('sync-stale', 'The remote skill changed after review.')
        }
        await rename(target, old)
        backedUp = true
      } else if (await lstat(target).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error })) throw new Error('That skill already exists.')
      try { await rename(next, target) } catch (error) {
        if (backedUp) { await rename(old, target); backedUp = false }
        throw error
      }
      backedUp = false
    } finally {
      // If restoring failed, preserve the original folder in staging for recovery.
      if (!backedUp) await rm(stage, { recursive: true, force: true })
    }
  })
}
// A caller-supplied comparison key must not turn saved credentials into a guessing oracle.
const credentialKey = randomBytes(32)
const previewLifetime = 10 * 60_000

/** Store one short-lived review per target, bound to its current connection. */
export function createSyncReview() {
  const pending = new Map()
  return {
    preview(id, connection, key, local, remote) {
      const token = syncKey()
      const rows = syncReview(local, remote)
      pending.set(id, { token, connection, key, local, remote, rows, expires: Date.now() + previewLifetime })
      return { token, rows }
    },
    take(id, connection, token, choices) {
      const plan = pending.get(id)
      if (!plan || plan.connection !== connection || plan.token !== token || plan.expires < Date.now()) {
        throw new HostsError('sync-preview', 'This preview expired. Review the setup again.')
      }
      if (!Array.isArray(choices) || !choices.length || choices.some(choice => !choice || !validId(choice.id))) {
        throw new HostsError('sync-choices', 'Choose at least one item to sync.')
      }
      const selected = new Map(choices.map(choice => [identity(choice), choice.action]))
      const eligible = plan.rows.filter(row => (row.status === 'new' && selected.get(identity(row)) === 'add')
        || (row.status === 'conflict' && selected.get(identity(row)) === 'replace'))
      if (eligible.length !== choices.length) throw new HostsError('sync-choices', 'Review the setup again before applying changes.')
      pending.delete(id)
      const approved = new Set(eligible.map(identity))
      const remote = new Map(plan.remote.map(item => [identity(item), item.digest]))
      return { key: plan.key, items: plan.local.filter(item => approved.has(identity(item))).map(item => ({ ...item, expected: remote.get(identity(item)) ?? null })) }
    },
    clear(id) { pending.delete(id) },
  }
}

/** Authenticate sync traffic from the process that started this SSH Host. */
export function verifySyncPeer(expected, access) {
  if (typeof expected !== 'string' || typeof access !== 'string' || !/^[a-f0-9]{64}$/.test(access)
    || !/^[a-f0-9]{64}$/.test(expected) || !timingSafeEqual(Buffer.from(expected), Buffer.from(access))) {
    throw new HostsError('sync-access', 'Reconnect from the computer sending this setup.')
  }
}

function skillSnapshot(key, path) {
  const files = skillFiles(realpathSync(path))
  return { files, digest: fingerprint(key, files.map(({ path, data }) => [path, data])) }
}

/** Build the payload from the reviewed entries and refuse changed skill contents. */
export function syncPayload(key, item) {
  let value = item.value
  if (item.kind === 'skills') {
    const snapshot = skillSnapshot(key, item.dir)
    if (snapshot.digest !== item.digest) throw new HostsError('sync-stale', 'The skill changed after review.')
    value = snapshot.files
  }
  return { kind: item.kind, id: item.id, expected: item.expected, value }
}

/**
 * Read comparable entries. Full values stay on the host that owns them until a write is approved.
 * @param {object} source Host services and skill roots.
 * @param {string} key Per-preview comparison key, shared only between hosts.
 * @returns {Promise<object[]>} Host-local entries with opaque fingerprints.
 */
export async function syncInventory(source, key, only, descriptors = source.settings.describe()) {
  if (typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid setup comparison key.')
  const sections = new Map(descriptors.map(section => [section.ns, section]))
  const includes = kind => !only || only.kind === kind
  const items = []
  const add = (kind, id, value, extra = {}) => {
    if (validId(id) && (!only || identity(only) === identity({ kind, id }))) items.push({ kind, id, name: id, value, digest: fingerprint(extra.sensitive ? credentialKey : key, [key, kind, id, value]), ...extra })
  }
  const providers = sections.get(PROVIDERS_NS)?.value?.providers ?? {}
  const providerProblem = value => value?.baseURLEnv || localEndpoint(value?.baseURL) ? 'machine' : undefined
  if (includes('providers')) for (const [id, value] of Object.entries(providers)) {
    add('providers', id, value, { name: value.displayName || id, problem: providerProblem(value), sensitive: Boolean(Object.keys(value.headers ?? {}).length || /[?#]|\/\/[^/]+@/.test(value.baseURL ?? '')) })
  }
  const model = sections.get(DEFAULT_MODEL_NS)?.value
  if (includes('model') && model?.provider && model.model) add('model', 'default', { provider: model.provider, model: model.model }, { name: model.model, problem: providerProblem(providers[model.provider]) })
  if (includes('servers')) for (const [id, value] of Object.entries(sections.get(MCP_NS)?.value?.servers ?? {})) {
    add('servers', id, value, { problem: [value.command, value.cwd, ...(value.args ?? [])].some(pathOnMachine) || localEndpoint(value.url) ? 'machine' : undefined, sensitive: Object.keys(value.env ?? {}).length > 0 || Object.keys(value.headers ?? {}).length > 0 || Boolean(value.url && /[?#]|\/\/[^/]+@/.test(value.url)) })
  }
  const seen = new Set()
  if (includes('skills')) for (const root of source.skillRoots) for (const skill of skillFolders(root)) {
    if (seen.has(skill.name) || !validId(skill.name) || (only && only.id !== skill.name)) continue
    seen.add(skill.name)
    try { add('skills', skill.name, null, { dir: skill.dir, digest: skillSnapshot(key, skill.dir).digest, problem: source.receiving && root !== source.skillRoots[0] ? 'machine' : undefined }) }
    catch { add('skills', skill.name, null, { problem: 'unreadable' }) }
  }
  if (includes('plugins')) for (const bundle of await source.pluginManager?.listBundles() ?? []) {
    if (!bundle.installed && !bundle.optional) continue
    const spec = bundle.updatable && bundle.version ? `${bundle.name}@${bundle.version}` : bundle.source ?? bundle.name
    add('plugins', bundle.name, { enabled: bundle.enabled, version: bundle.optional ? undefined : bundle.version, spec, optional: bundle.optional }, { name: bundle.meta?.title ?? bundle.name, problem: pathOnMachine(spec) || /^(?:link|workspace):/.test(spec) ? 'machine' : undefined })
  }
  const refs = new Set(Object.values(providers).filter(value => !providerProblem(value)).map(value => value.apiKeyEnv).filter(ref => typeof ref === 'string' && ref))
  if (includes('keys')) for (const ref of only ? [only.id] : new Set([...refs, ...(source.refs ?? [])])) {
    if (!validId(ref)) continue
    const secret = await source.credentials.resolve(ref)
    const endpoint = credentialEndpoint(providers, source.llm, ref)
    if (secret?.value) add('keys', ref, { value: secret.value, endpoint }, {
      sensitive: true,
      problem: secret.source === 'env' && source.receiving ? 'environment' : !endpoint && !source.receiving ? 'machine' : undefined,
    })
  }
  return items
}

/** @param {object[]} items Host-local inventory. @returns {object[]} Secret-free comparison data. */
export function syncFingerprints(items) {
  return items.map(({ kind, id, digest, problem }) => ({ kind, id, digest, problem }))
}

const identity = item => JSON.stringify([item.kind, item.id])

/** @param {object[]} local Sender inventory. @param {object[]} remote Receiver fingerprints. @returns {object[]} Browser-safe review rows. */
export function syncReview(local, remote) {
  const existing = new Map(remote.map(item => [identity(item), item]))
  return local.map(item => {
    const there = existing.get(identity(item))
    const problem = item.problem ?? there?.problem
    const status = problem ? 'skipped' : !there ? 'new' : item.digest === there.digest ? 'same' : 'conflict'
    return { kind: item.kind, id: item.id, name: item.name, status, sensitive: Boolean(item.sensitive), problem }
  })
}

/** @returns {string} Fresh, unguessable comparison key. */
export function syncKey() { return randomBytes(32).toString('hex') }

/**
 * Apply settings records with the live namespace revision as a write precondition.
 * @param {object} source Receiver services.
 * @param {object[]} items Approved changes with prior fingerprints.
 * @param {string} key Comparison key from the review.
 * @returns {Promise<object[]>} One outcome per requested entry.
 */
export async function applySync(source, items, key) {
  if (!Array.isArray(items) || items.some(item => !item || !validId(item.id))) throw new HostsError('sync-items', 'Invalid setup items.')
  const outcomes = []
  for (const item of items) {
    const record = { kind: item.kind, id: item.id }
    try {
      const sections = source.settings.describe()
      const previous = (await syncInventory(source, key, item, sections))[0]
      if ((previous?.digest ?? null) !== item.expected || previous?.problem) { outcomes.push({ ...record, status: 'stale' }); continue }
      const ns = settingKinds.get(item.kind)
      if (ns) {
        if (item.value === null || typeof item.value !== 'object' || Array.isArray(item.value)) throw new Error('Invalid setting.')
        if (item.kind === 'model' && !source.settings.describe().find(section => section.ns === PROVIDERS_NS)?.value?.providers?.[item.value.provider]) throw new Error('Sync the model provider first.')
        const ops = item.kind === 'model' ? ['provider', 'model'].map(field => ({ op: 'set', path: [field], value: item.value[field] })) : [{ op: 'set', path: [item.kind, item.id], value: item.value }]
        const revision = sections.find(section => section.ns === ns)?.revision
        if (revision === undefined) throw new Error('That setting is unavailable.')
        await source.settings.mutate(ns, ops, revision)
      } else if (item.kind === 'keys') {
        const { endpoint, value } = item.value ?? {}
        if (typeof value !== 'string' || !value || typeof endpoint !== 'string') throw new Error('Invalid provider credential.')
        const providers = source.settings.describe().find(section => section.ns === PROVIDERS_NS)?.value?.providers ?? {}
        if (credentialEndpoint(providers, source.llm, item.id) !== endpoint) {
          throw new HostsError('sync-stale', 'The destination provider endpoint could not be verified.')
        }
        await source.credentials.set(item.id, value)
      } else if (item.kind === 'skills') {
        await writeSkill(source.skillRoots[0], item.id, item.value, previous, key)
      } else if (item.kind === 'plugins') {
        const manager = source.pluginManager
        const { enabled, version, spec } = item.value
        const check = result => {
          if (!result || result.application === 'failed' || result.error || result.failures?.length) throw new Error('The plugin manager declined the change.')
          return result.application === 'restart-required'
        }
        let restart = false
        if (!previous) restart = check(await manager.installBundle(spec, { enabled, saveExact: true }))
        else {
          if (version !== previous.value.version && !previous.value.optional) restart = check((await manager.updateBundle(item.id, version)).result)
          if (enabled !== previous.value.enabled) restart = check(await manager.setBundleEnabled(item.id, enabled)) || restart
        }
        if (restart) { outcomes.push({ ...record, status: 'restart' }); continue }
      } else throw new Error('Unknown setup item.')
      outcomes.push({ ...record, status: previous ? 'replaced' : 'copied' })
    } catch (error) {
      outcomes.push({ ...record, status: ['SETTINGS_CONFLICT', 'sync-stale'].includes(error?.code) ? 'stale' : 'failed' })
    }
  }
  return outcomes
}
