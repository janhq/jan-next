const MAX_REQUEST_BYTES = 1024 * 1024
const MAX_DOCUMENTS = 64
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const text = value => typeof value === 'string' ? value.trim() : ''
const list = value => Array.isArray(value) ? value : value == null ? [] : [value]
const secretField = /^(?:(?:.*_)?(?:api_?key|access_?key|token|password|secret|cookie|credential)s?|authorization|proxy_authorization|private_?key|headers|env)$/iu
const secretText = /(?:\b(?:bearer\s+[a-z0-9._/-]{8,}|(?:[\w-]+[_-])?(?:api[_-]?key|token|password|secret|cookie|credential|authorization)\s*[:=]\s*["']?[^\s"'<>]{4,}|(?:sk-|gh[pousr]_|github_pat_|xox[baprs]-|AKIA)[a-z\d_-]{12,}|eyJ[a-z\d_-]{8,}\.[a-z\d_-]{8,}\.[a-z\d_-]{8,})|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:op|bw):\/\/|https?:\/\/[^\s/]*@|https?:\/\/[^\s<>]+[?&](?:[^=&\s]*[_-])?(?:token|secret|password|key|signature)=)/iu

function assertNoCredentials(value) {
  const pending = [[value, false]]
  while (pending.length) {
    const [item, directApp] = pending.pop()
    if (typeof item === 'string' && secretText.test(item)) throw new Error('export-credentials')
    if (item === null || typeof item !== 'object') continue
    for (const [key, child] of Object.entries(item)) {
      const normalized = key.replace(/([a-z\d])([A-Z])/gu, '$1_$2').replace(/[ -]/g, '_').toLowerCase()
      if (secretText.test(key)) throw new Error('export-credentials')
      if (secretField.test(normalized)) throw new Error('export-credentials')
      // App URLs are handled separately: we can safely skip one app and explain why.
      if (directApp && key === 'mcp_url' && typeof child === 'string') continue
      if (key === 'apps' && Array.isArray(child)) {
        for (const app of child) pending.push([app, true])
      } else pending.push([child, false])
    }
  }
}

// A balanced JSON object can be embedded in Markdown or prose. Parse each complete object,
// never try to salvage a truncated one; JSON.parse errors can contain private text.
function* readDocuments(doc) {
  const match = /\[\d+\]|[\[{]/gu
  const candidate = /\s*(.)/syu
  let end = 0
  while (end < doc.length) {
    match.lastIndex = end
    const next = match.exec(doc)
    if (!next) break
    // A numbered citation is prose, not a top-level JSON document.
    if (next[0].length > 1) { end = match.lastIndex; continue }
    const start = next.index
    candidate.lastIndex = start + 1
    const first = candidate.exec(doc)?.[1]
    if (first && !(next[0] === '{' ? /['"}\[]/u : /[\[\]{"\d-]/u).test(first)) { end = start + 1; continue }
    let quoted = false, depth = 0
    for (end = start; end < doc.length; end++) {
      const ch = doc[end]
      if (quoted) {
        if (ch === '\\') end++
        else if (ch === '"') quoted = false
      } else if (ch === '"') quoted = true
      else if (ch === '{' || ch === '[') depth++
      else if ((ch === '}' || ch === ']') && --depth === 0) break
    }
    if (end >= doc.length) throw new Error('invalid-export')
    let parsed
    try { parsed = JSON.parse(doc.slice(start, ++end)) } catch { throw new Error('invalid-export') }
    yield parsed
  }
}

function uniqueInto(target, seen, values) {
  for (const value of values) {
    if (value == null || value === '') continue
    const key = typeof value === 'string' ? value : JSON.stringify(value)
    if (!seen.has(key)) { seen.add(key); target.push(value) }
  }
}

const skillOf = value => plain(value) ? { name: text(value.name), description: text(value.description),
  instruction: text(value.instruction) || text(value.instructions) } : null
const routineOf = value => plain(value) ? { name: text(value.name), instruction: text(value.instruction) || text(value.instructions),
  trigger: text(value.trigger).toLowerCase(), schedule_cron: text(value.schedule_cron), schedule_text: text(value.schedule_text),
  ...(Object.hasOwn(value, 'timezone') ? { timezone: typeof value.timezone === 'string' ? value.timezone.trim() : null } : {}),
  paused: Object.hasOwn(value, 'paused') && value.paused !== false,
  trigger_details: text(value.trigger_details),
  skills: [...new Set(list(value.skills).map(text).filter(Boolean))] } : null
const appOf = value => plain(value) ? { name: text(value.name), mcp_url: text(value.mcp_url) } : null
const normalizers = { instructions: text, memories: text, user_facts: text, skills: skillOf, routines: routineOf, apps: appOf }

/** Read complete Grok-format exports and merge split entries in source order. */
export function parseAiExport(documents) {
  if (!Array.isArray(documents) || documents.length === 0 || documents.some(doc => typeof doc !== 'string')) throw new Error('invalid-export')
  if (documents.length > MAX_DOCUMENTS || Buffer.byteLength(JSON.stringify(documents)) > MAX_REQUEST_BYTES) throw new Error('export-too-large')
  const bots = new Map()
  for (const doc of documents) {
    let found = false
    for (const entry of readDocuments(doc)) {
      found = true
      if (!plain(entry) || entry.format !== 'grok-bot-export' || entry.version !== 1) throw new Error('unsupported-export')
      if (!Array.isArray(entry.bots) || !entry.bots.length) throw new Error('invalid-export')
      assertNoCredentials(entry)
      for (const item of entry.bots) {
        const name = text(item?.name)
        if (!plain(item) || !name) throw new Error('invalid-export')
        const key = name.toLowerCase()
        if (!bots.has(key)) bots.set(key, { bot: { name, title: '', ...Object.fromEntries(Object.keys(normalizers).map(key => [key, []])) },
          seen: Object.fromEntries(Object.keys(normalizers).map(key => [key, new Set()])) })
        const { bot, seen } = bots.get(key)
        bot.title = text(item.title) || bot.title
        for (const [key, normalize] of Object.entries(normalizers)) uniqueInto(bot[key], seen[key], list(item[key]).map(normalize))
      }
    }
    if (!found) throw new Error('invalid-export')
  }
  return [...bots.values()].map(({ bot }) => bot)
}

function endpoint(value) {
  if (!value) return { reason: 'no-mcp-url' }
  let decoded
  try { decoded = decodeURIComponent(value) } catch { return { reason: 'unsupported-mcp-url' } }
  if (/[?#{}<>\\]/u.test(decoded) || secretText.test(decoded)) return { reason: 'unsafe-mcp-url' }
  let url
  try { url = new URL(value) } catch { return { reason: 'unsupported-mcp-url' } }
  if (url.protocol !== 'https:') return { reason: 'unsupported-mcp-url' }
  if (!/^https:\/\/[^/\s]+/iu.test(value) || /[\u0000-\u0020\u007f]/u.test(value)) return { reason: 'unsupported-mcp-url' }
  const path = decoded.slice(8).replace(/^[^/]*/u, '')
  if (url.username || url.password || /(?:^|\/)(?:[\w-]+[_-])?(?:tokens?|passwords?|secrets?|api[_-]?keys?|credentials?)(?:[=/]|$)|\/[a-z\d_-]{24,}(?:\/|$)/iu.test(path)) {
    return { reason: 'unsafe-mcp-url' }
  }
  return { url: url.href }
}

const limited = (value, limit) => value.slice(0, limit).replace(/[\ud800-\udbff]$/u, '')
const serverName = value => value.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'server'

/** Build a Host-only write plan; only normalized schedule data and display names leave the Host. */
export function planAiExport(exports, { bot, mcp, timeZone = 'UTC' }) {
  const plan = { bots: [], skills: [], apps: [], skipped: [] }
  const apps = new Map()
  for (const [index, item] of exports.entries()) {
    const botId = `bot-${index + 1}`
    const skip = (kind, name, reason) => plan.skipped.push({ botId, kind, name: limited(name, 120), reason })
    if (item.name.length > 80) { skip('bot', item.name, 'bot-name-too-long'); continue }
    const instructions = item.instructions.join('\n\n')
    const entry = { id: botId, name: item.name, role: limited(item.title, 100), description: limited(instructions.replace(/\s+/gu, ' '), 240),
      memory: { instructions, memories: item.memories, facts: item.user_facts, skillBindings: [] }, routines: [] }
    plan.bots.push(entry)
    for (const [index, routine] of item.routines.entries()) {
      const { name } = routine
      if (routine.skills.length) {
        entry.memory.skillBindings.push(`${name}: ${routine.skills.join(', ')}`)
        skip('routine', name, 'skill-bindings')
      }
      if (routine.trigger && !['schedule', 'scheduled', 'cron'].includes(routine.trigger)) {
        skip('routine', name, ['slack', 'github'].includes(routine.trigger) ? `${routine.trigger}-trigger` : 'unsupported-trigger')
        continue
      }
      if (!name || !routine.instruction) { skip('routine', name, 'routine-incomplete'); continue }
      const timing = bot.validateRoutine(routine, timeZone)
      if (timing.reason) { skip('routine', name, timing.reason); continue }
      entry.routines.push({ id: `${botId}-routine-${index + 1}`, name: limited(name, 120), prompt: routine.instruction,
        expression: timing.expression, timeZone: timing.timeZone, paused: routine.paused })
    }
    for (const [index, skill] of item.skills.entries()) {
      if (!skill.name || !skill.instruction) { skip('skill', skill.name, 'skill-incomplete'); continue }
      plan.skills.push({ ...skill, name: limited(skill.name, 120), botId, id: `${botId}-skill-${index + 1}` })
    }
    for (const app of item.apps) {
      // A name supplied as a URL is not safe to display, even on a skipped row.
      const name = /:\/\//u.test(app.name) ? '' : limited(app.name, 120)
      const { url, reason } = endpoint(app.mcp_url)
      if (reason || !mcp) { skip('app', name, reason ?? 'mcp-unavailable'); continue }
      const server = serverName(name)
      const previous = apps.get(server)
      if (previous?.url === url) { if (previous.botIds.at(-1) !== botId) previous.botIds.push(botId); continue }
      if (previous) { skip('app', name, 'app-name-conflict'); continue }
      const row = { id: `app-${apps.size + 1}`, botIds: [botId], name: name || server, server, url }
      apps.set(server, row)
      plan.apps.push(row)
    }
  }
  return plan
}

/** Project an export plan without instruction text, memory, app endpoints, or absolute paths. */
export function exportPreview(plan) {
  const skills = new Map()
  for (const entry of plan.skills) {
    const names = skills.get(entry.botId)
    if (names) names.push(entry.name)
    else skills.set(entry.botId, [entry.name])
  }
  return {
    bots: plan.bots.map(({ id, name, routines }) => ({ id, name,
      skills: skills.get(id) ?? [],
      routines: routines.map(({ id, name, expression, timeZone, paused }) => ({ id, name, expression, timeZone, paused })) })),
    apps: plan.apps.map(({ id, name, botIds }) => ({ id, name, botIds })),
    skipped: plan.skipped,
  }
}

/** Apply only approved items and return independent outcomes without echoing errors or source contents. */
export async function applyAiExport(plan, { botIds, appIds }, { bot, mcp, installSkills }) {
  const bots = [], skills = [], apps = []
  const chosen = new Set(botIds), chosenApps = new Set(appIds)
  const saved = new Set()
  for (const { id, name, ...input } of plan.bots) {
    if (!chosen.has(id)) continue
    try {
      if (!bot) throw new Error('bots-unavailable')
      const result = await bot.importBot({ name, ...input })
      bots.push({ id, name, status: 'imported', ...result })
      saved.add(id)
    } catch (error) {
      const reason = ['bot-already-here', 'bots-unavailable'].includes(error?.message) ? error.message : 'bot-import-failed'
      bots.push({ id, name, status: reason === 'bot-already-here' ? 'already-here' : 'failed', reason })
    }
  }
  const approvedSkills = plan.skills.filter(row => chosen.has(row.botId))
  const readySkills = approvedSkills.filter(row => saved.has(row.botId))
  if (readySkills.length) {
    try { skills.push(...await installSkills(readySkills)) } catch {
      for (const { id, name, botId } of readySkills) skills.push({ id, name, botId, status: 'failed', reason: 'skill-import-failed' })
    }
  }
  for (const { id, name, botId } of approvedSkills) {
    if (!saved.has(botId)) skills.push({ id, name, botId, status: 'skipped', reason: 'bot-not-imported' })
  }
  for (const { id, name, server, url } of plan.apps) {
    if (!chosenApps.has(id)) continue
    try {
      if (!mcp) throw new Error('mcp-unavailable')
      const { added } = await mcp.importMissing({ [server]: { transport: 'streamable-http', url, enabled: false } })
      apps.push({ id, name, status: added.includes(server) ? 'imported' : 'already-here' })
    } catch (error) { apps.push({ id, name, status: 'failed', reason: error?.message === 'mcp-unavailable' ? 'mcp-unavailable' : 'app-import-failed' }) }
  }
  return { bots, skills, apps, skipped: plan.skipped.filter(row => chosen.has(row.botId)) }
}
