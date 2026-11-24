import { randomUUID } from 'node:crypto'
import { readFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomic } from '@janhq/jan-atomic-write'
import { normalizeSources } from './sources.mjs'

const ID = /^(?:jan|[a-f0-9-]{36})$/u
const AGENT_ID = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$/u
const PERSONA_FILE = /^persona-[a-f0-9]{64}\.md$/u
const FIELDS = ['name', 'role', 'avatar', 'agentPreset', 'agentProfile', 'sources']
const EMPTY = { version: 2, migrated: false, bots: [] }
const writeOptions = { mode: 0o600, dirMode: 0o700 }

function text(value, max, required = false) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new Error('invalid-input')
  return value.trim()
}

function profile(input) {
  const avatar = input.avatar ?? null
  if (avatar !== null && (typeof avatar !== 'object' || !Number.isInteger(avatar.shape) || avatar.shape < 0 || avatar.shape > 3
    || typeof avatar.color !== 'string' || !/^#[0-9a-f]{6}$/iu.test(avatar.color) || typeof avatar.locked !== 'boolean')) throw new Error('invalid-avatar')
  const agentProfile = input.agentProfile ?? null
  if (agentProfile !== null && (typeof agentProfile !== 'string' || !AGENT_ID.test(agentProfile))) throw new Error('invalid-input')
  return {
    name: text(input.name, 80, true), role: text(input.role ?? '', 100),
    avatar: avatar === null ? null : { shape: avatar.shape, color: avatar.color, locked: avatar.locked },
    agentPreset: input.agentPreset == null ? null : text(input.agentPreset, 160, true),
    agentProfile,
    sources: normalizeSources(input.sources),
  }
}

/** Pick an unused global agent ID for a bot name and reserve it in the caller's set.
 * @param {string} name - the bot's display name.
 * @param {Set<string>} taken - IDs already in use or reserved.
 * @returns {string} the reserved ID.
 */
export function reserveBotAgentId(name, taken) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '') || 'bot'
  let id = slug.slice(0, 64)
  for (let n = 2; taken.has(id); n++) {
    const suffix = `-${n}`
    id = `${slug.slice(0, 64 - suffix.length)}${suffix}`
  }
  taken.add(id)
  return id
}

async function migrateProfiles(state, file, directory, agentProfiles, report) {
  const bots = [], written = []
  try {
    const taken = new Set(state.bots.length ? (await agentProfiles.list({})).profiles.filter(row => !row.shadowedBy).map(row => row.id.toLowerCase()) : [])
    for (const { model, description, personaDigest, ...bot } of state.bots) {
      const id = reserveBotAgentId(bot.name, taken)
      const instructions = await readFile(join(directory(bot), `persona-${personaDigest}.md`), 'utf8')
      await agentProfiles.save({ scope: 'global', profile: { id, description: description ?? '', use: 'all', instructions,
        ...(model ? { model: { provider: model.provider, model: model.model,
          ...(model.reasoningEffort === undefined ? {} : { reasoningEffort: model.reasoningEffort }) } } : {}) } })
      written.push(id)
      bots.push({ ...bot, agentProfile: id, agentSelectionPending: true })
    }
    state = { ...state, version: 2, bots }
    await writeFileAtomic(file, `${JSON.stringify(state, null, 2)}\n`, writeOptions)
  } catch (cause) {
    for (const id of written) {
      try { await agentProfiles.remove({ scope: 'global', id }) } catch (error) { report(error) }
    }
    const error = new Error(`Could not migrate bot agents; the v1 registry was kept: ${cause.message}`, { cause })
    report(error)
    throw error
  }
  for (const bot of bots) {
    const path = directory(bot)
    try {
      for (const filename of await readdir(path)) {
        if (PERSONA_FILE.test(filename)) await rm(join(path, filename), { force: true })
      }
    } catch (error) { report(error) }
  }
  return state
}

/** Open the serialized local registry, migrating v1 bot data through the agent profile service.
 * @param {string} home - Jan home directory.
 * @param {object} [options] - change and error callbacks and the agent profile migration service.
 * @returns {Promise<object>} the opened registry.
 */
export async function openBots(home, { changed = () => {}, agentProfiles, report = error => console.warn(error) } = {}) {
  const root = join(home, 'bots')
  const file = join(root, 'registry.json')
  let state
  try { state = JSON.parse(await readFile(file, 'utf8')) }
  catch (error) { if (error.code !== 'ENOENT') throw error; state = EMPTY }
  if (![1, 2].includes(state.version) || typeof state.migrated !== 'boolean' || !Array.isArray(state.bots)
    || !state.bots.every(bot => typeof bot.id === 'string' && ID.test(bot.id) && typeof bot.sessionId === 'string' && bot.sessionId.length > 0
      && typeof bot.workspaceId === 'string' && (state.version === 1 ? /^[a-f0-9]{64}$/u.test(bot.personaDigest)
        : bot.agentProfile === null || typeof bot.agentProfile === 'string' && AGENT_ID.test(bot.agentProfile)))
    || new Set(state.bots.map(bot => bot.sessionId)).size !== state.bots.length) throw new Error('invalid-bot-registry')
  const directory = bot => bot.id === 'jan' ? join(home, 'always-on') : join(root, bot.id)
  if (state.version === 1) state = await migrateProfiles(state, file, directory, agentProfiles, report)
  let tail = Promise.resolve()
  function serialize(operation) {
    const run = tail.then(operation)
    tail = run.catch(() => undefined)
    return run
  }
  const get = id => state.bots.find(bot => bot.id === id)
  const requireBot = id => {
    const bot = get(id)
    if (!bot) throw new Error('bot-not-found')
    return bot
  }
  async function save(next) {
    await writeFileAtomic(file, `${JSON.stringify(next, null, 2)}\n`, writeOptions)
    state = next
    changed()
  }
  async function replace(bot, next) {
    await save({ ...state, bots: state.bots.map(value => value === bot ? next : value) })
    return next
  }
  async function create(input, prepare, id = randomUUID()) {
    const sessionId = input.sourceSessionId === undefined ? `session-bot-${id}` : text(input.sourceSessionId, 240, true)
    if (state.bots.some(bot => bot.sessionId === sessionId)) throw new Error('bot-session-conflict')
    const bot = { ...profile(input), id, sessionId, workspaceId: text(input.workspaceId, 240, true),
      createdAt: Date.now(), latest: null, unread: false }
    bot.latest = (await prepare?.(bot)) ?? null
    await save({ ...state, migrated: state.migrated || id === 'jan', bots: [...state.bots, bot] })
    return bot
  }
  return {
    get migrated() { return state.migrated },
    get,
    forSession: sessionId => state.bots.find(value => value.sessionId === sessionId),
    list: () => [...state.bots],
    agentSelectionRestored: id => serialize(async () => {
      const bot = get(id)
      if (!bot?.agentSelectionPending) return
      const { agentSelectionPending, ...next } = bot
      await replace(bot, next)
    }),
    directory,
    adopt: (workspaceId, prepare) => serialize(() => state.migrated ? undefined : create({ name: 'Jan', workspaceId }, prepare, 'jan')),
    create: (input, prepare, { uniqueName = false } = {}) => serialize(() => {
      if (uniqueName && state.bots.some(bot => bot.name.toLowerCase() === input.name.trim().toLowerCase())) {
        throw new Error('bot-already-here')
      }
      return create(input, prepare)
    }),
    duplicate: (id, name, prepare) => serialize(() => create({ ...requireBot(id), name }, prepare)),
    edit: (id, patch, prepare) => serialize(async () => {
      const bot = requireBot(id)
      const input = { ...bot, ...Object.fromEntries(FIELDS.filter(key => Object.hasOwn(patch, key)).map(key => [key, patch[key]])) }
      const next = { ...bot, ...profile(input) }
      await prepare?.(next, bot)
      if (next.agentProfile !== bot.agentProfile) delete next.agentSelectionPending
      return replace(bot, next)
    }),
    remove: (id, prepare) => serialize(async () => {
      const bot = requireBot(id)
      await prepare?.(bot)
      await rm(directory(bot), { recursive: true, force: true })
      await save({ ...state, bots: state.bots.filter(value => value !== bot) })
    }),
    message: (id, message, unread) => serialize(async () => {
      const bot = get(id)
      if (!bot || bot.latest?.id === message.id || (bot.latest?.at ?? 0) > message.at) return
      await replace(bot, { ...bot, latest: message, unread: bot.unread || unread })
    }),
    read: id => serialize(async () => {
      const bot = requireBot(id)
      if (bot.unread) await replace(bot, { ...bot, unread: false })
    }),
  }
}
