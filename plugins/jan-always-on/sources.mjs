// Source adapters: read what is new on GitHub, Slack and Discord since a cursor.
// They run on the Host, outside the model, with the token passed in; the model only
// ever sees the items they return.

export const KINDS = ['github', 'slack', 'discord']
const TARGET = {
  github: /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/u,
  slack: /^[A-Z0-9]{8,20}$/u,
  discord: /^\d{15,25}$/u,
}
const MAX_SOURCES = 8
const MAX_ITEMS = 50
const BODY_CHARS = 400

/** @returns Validated sources for a bot profile; throws `invalid-sources`. */
export function normalizeSources(value) {
  if (value == null) return []
  if (!Array.isArray(value) || value.length > MAX_SOURCES) throw new Error('invalid-sources')
  const seen = new Set()
  return value.map(source => {
    const kind = source?.kind
    const target = typeof source?.target === 'string' ? source.target.trim() : ''
    const everyMinutes = source?.everyMinutes ?? 15
    if (!KINDS.includes(kind) || !TARGET[kind].test(target) || !Number.isInteger(everyMinutes)
      || everyMinutes < 5 || everyMinutes > 1440) throw new Error('invalid-sources')
    const key = sourceKey({ kind, target })
    if (seen.has(key)) throw new Error('invalid-sources')
    seen.add(key)
    return { kind, target, everyMinutes }
  })
}

export const sourceKey = ({ kind, target }) => `${kind}:${target.toLowerCase()}`
export const needsToken = kind => kind !== 'github'

class SourceError extends Error {
  constructor(message, retryAfterMs) { super(message); this.retryAfterMs = retryAfterMs }
}

async function getJson(fetch, url, headers, signal) {
  const response = await fetch(url, { headers, signal })
  if (response.status === 429 || response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0') {
    const after = Number(response.headers.get('retry-after'))
    throw new SourceError('rate-limited', Number.isFinite(after) && after > 0 ? after * 1000 : undefined)
  }
  if (response.status === 401) throw new SourceError('token-rejected')
  if (response.status === 404) throw new SourceError('not-found')
  if (!response.ok) throw new SourceError(`http-${response.status}`)
  return response.json()
}

const clip = text => {
  const flat = String(text ?? '').replace(/\s+/gu, ' ').trim()
  return flat.length > BODY_CHARS ? `${flat.slice(0, BODY_CHARS)}...` : flat
}

async function github({ target }, cursor, { token, fetch, signal }) {
  const headers = { accept: 'application/vnd.github+json', 'user-agent': 'jan-bots', 'x-github-api-version': '2022-11-28',
    ...(token ? { authorization: `Bearer ${token}` } : {}) }
  const rows = await getJson(fetch, `https://api.github.com/repos/${target}/issues?state=all&sort=created&direction=desc&per_page=${MAX_ITEMS}`, headers, signal)
  if (!Array.isArray(rows)) throw new SourceError('bad-response')
  const last = Number(cursor?.last ?? 0)
  const top = rows.reduce((max, row) => Math.max(max, row.number), last)
  // The first check only records where the source is, so a new bot does not report history.
  const items = cursor == null ? [] : rows.filter(row => row.number > last).reverse().map(row => ({
    id: String(row.number),
    text: `[${target}] ${row.pull_request ? 'PR' : 'Issue'} #${row.number} "${clip(row.title)}" by ${row.user?.login ?? 'unknown'} - ${row.html_url}`
      + (row.body ? `\n${clip(row.body)}` : ''),
  }))
  return { items, cursor: { last: top } }
}

async function slack({ target }, cursor, { token, fetch, signal }) {
  const query = cursor == null ? 'limit=1' : `limit=${MAX_ITEMS}&oldest=${encodeURIComponent(cursor.last)}`
  const body = await getJson(fetch, `https://slack.com/api/conversations.history?channel=${target}&${query}`,
    { authorization: `Bearer ${token}` }, signal)
  if (!body.ok) throw new SourceError(body.error === 'invalid_auth' || body.error === 'not_authed' ? 'token-rejected' : `slack-${body.error}`)
  const messages = (body.messages ?? []).filter(message => !message.subtype || message.subtype === 'bot_message' || message.subtype === 'thread_broadcast')
  const top = (body.messages ?? []).reduce((max, message) => Number(message.ts) > Number(max) ? message.ts : max, cursor?.last ?? '0')
  const items = cursor == null ? [] : messages.filter(message => Number(message.ts) > Number(cursor.last)).reverse().map(message => ({
    id: message.ts,
    text: `[slack ${target}] ${message.user ?? message.username ?? 'unknown'}: ${clip(message.text)} - https://slack.com/archives/${target}/p${message.ts.replace('.', '')}`,
  }))
  return { items, cursor: { last: top } }
}

async function discord({ target }, cursor, { token, fetch, signal }) {
  const headers = { authorization: `Bot ${token}`, 'user-agent': 'jan-bots' }
  const guild = cursor?.guild ?? (await getJson(fetch, `https://discord.com/api/v10/channels/${target}`, headers, signal)).guild_id ?? '@me'
  const query = cursor == null ? 'limit=1' : `limit=${MAX_ITEMS}&after=${cursor.last}`
  const rows = await getJson(fetch, `https://discord.com/api/v10/channels/${target}/messages?${query}`, headers, signal)
  if (!Array.isArray(rows)) throw new SourceError('bad-response')
  const bigger = (a, b) => BigInt(a) > BigInt(b)
  const top = rows.reduce((max, row) => bigger(row.id, max) ? row.id : max, cursor?.last ?? '0')
  // Type 0 is an ordinary message and 19 a reply; joins, pins and boosts are not news.
  const items = cursor == null ? [] : rows.filter(row => (row.type === 0 || row.type === 19) && bigger(row.id, cursor.last))
    .sort((a, b) => bigger(a.id, b.id) ? 1 : -1).map(row => ({
      id: row.id,
      text: `[discord ${target}] ${row.author?.username ?? 'unknown'}: ${clip(row.content)} - https://discord.com/channels/${guild}/${target}/${row.id}`,
    }))
  return { items, cursor: { last: top, guild } }
}

const ADAPTERS = { github, slack, discord }

/**
 * Read the items a source gained after `cursor`. A null cursor records the current
 * position and returns no items. The cursor only moves forward.
 * @returns `{ items: Array<{ id, text }>, cursor }`.
 */
export function fetchNew(source, cursor, options) {
  if (needsToken(source.kind) && !options.token) return Promise.reject(new SourceError('token-missing'))
  return ADAPTERS[source.kind](source, cursor ?? null, options)
}
