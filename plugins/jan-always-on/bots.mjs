import { createHash, randomUUID } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomic } from '@janhq/jan-atomic-write'

const ID = /^(?:jan|[a-f0-9-]{36})$/u
const FIELDS = ['name', 'role', 'description', 'avatar', 'agentPreset', 'model']
const EMPTY = { version: 1, migrated: false, bots: [] }
const writeOptions = { mode: 0o600, dirMode: 0o700 }

function text(value, max, required = false) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new Error('invalid-input')
  return value.trim()
}

function profile(input) {
  const avatar = input.avatar ?? null
  if (avatar !== null && (typeof avatar !== 'object' || !Number.isInteger(avatar.shape) || avatar.shape < 0 || avatar.shape > 3
    || typeof avatar.color !== 'string' || !/^#[0-9a-f]{6}$/iu.test(avatar.color) || typeof avatar.locked !== 'boolean')) throw new Error('invalid-avatar')
  const model = input.model ?? null
  return {
    name: text(input.name, 80, true), role: text(input.role ?? '', 100), description: text(input.description ?? '', 500),
    avatar: avatar === null ? null : { shape: avatar.shape, color: avatar.color, locked: avatar.locked },
    agentPreset: input.agentPreset == null ? null : text(input.agentPreset, 160, true),
    model: model === null ? null : { provider: text(model.provider, 120, true), model: text(model.model, 300, true),
      ...(model.reasoningEffort === undefined ? {} : { reasoningEffort: text(model.reasoningEffort, 120, true) }) },
  }
}

/** Look up stable bot IDs, canonical Sessions and persona files in one serialized local registry. */
export async function openBots(home, { changed = () => {} } = {}) {
  const root = join(home, 'bots')
  const file = join(root, 'registry.json')
  let state
  try { state = JSON.parse(await readFile(file, 'utf8')) }
  catch (error) { if (error.code !== 'ENOENT') throw error; state = EMPTY }
  if (state.version !== 1 || typeof state.migrated !== 'boolean' || !Array.isArray(state.bots)
    || !state.bots.every(bot => typeof bot.id === 'string' && ID.test(bot.id) && bot.sessionId === `session-bot-${bot.id}`
      && typeof bot.workspaceId === 'string' && /^[a-f0-9]{64}$/u.test(bot.personaDigest))) throw new Error('invalid-bot-registry')
  let tail = Promise.resolve()
  function serialize(operation) {
    const run = tail.then(operation)
    tail = run.catch(() => undefined)
    return run
  }
  const directory = bot => bot.id === 'jan' ? join(home, 'always-on') : join(root, bot.id)
  const personaPath = (bot, hash = bot.personaDigest) => join(directory(bot), `persona-${hash}.md`)
  const publicBot = ({ personaDigest, ...value }) => value
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
  async function writePersona(bot, value) {
    const content = text(value ?? '', 32768)
    const hash = createHash('sha256').update(content).digest('hex')
    if (bot.personaDigest !== hash) await writeFileAtomic(personaPath(bot, hash), content, writeOptions)
    return hash
  }
  async function replace(bot, next) {
    await save({ ...state, bots: state.bots.map(value => value === bot ? next : value) })
    return publicBot(next)
  }
  async function create(input, prepare, id = randomUUID()) {
    const bot = { ...profile(input), id, sessionId: `session-bot-${id}`, workspaceId: text(input.workspaceId, 240, true),
      createdAt: Date.now(), latest: null, unread: false }
    bot.personaDigest = await writePersona(bot, input.persona)
    await prepare?.(publicBot(bot))
    await save({ ...state, migrated: state.migrated || id === 'jan', bots: [...state.bots, bot] })
    return publicBot(bot)
  }
  return {
    get migrated() { return state.migrated },
    get: id => { const bot = get(id); return bot && publicBot(bot) },
    forSession: sessionId => { const bot = state.bots.find(value => value.sessionId === sessionId); return bot && publicBot(bot) },
    list: () => state.bots.map(publicBot),
    directory,
    persona: id => readFile(personaPath(requireBot(id)), 'utf8'),
    adopt: (workspaceId, prepare) => serialize(() => state.migrated ? undefined : create({ name: 'Jan', workspaceId }, prepare, 'jan')),
    create: (input, prepare) => serialize(() => create(input, prepare)),
    duplicate: (id, name, prepare) => serialize(async () => {
      const bot = requireBot(id)
      return create({ ...bot, name, persona: await readFile(personaPath(bot), 'utf8') }, prepare)
    }),
    edit: (id, patch, prepare) => serialize(async () => {
      const bot = requireBot(id)
      const input = { ...bot, ...Object.fromEntries(FIELDS.filter(key => Object.hasOwn(patch, key)).map(key => [key, patch[key]])) }
      const next = { ...bot, ...profile(input) }
      if (Object.hasOwn(patch, 'persona')) next.personaDigest = await writePersona(bot, patch.persona)
      await prepare?.(publicBot(next), publicBot(bot))
      const result = await replace(bot, next)
      if (bot.personaDigest !== next.personaDigest) await rm(personaPath(bot), { force: true })
      return result
    }),
    remove: (id, prepare) => serialize(async () => {
      const bot = requireBot(id)
      await prepare?.(publicBot(bot))
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
