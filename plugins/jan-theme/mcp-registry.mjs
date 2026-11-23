// Read-only search of the official MCP Registry (registry.modelcontextprotocol.io),
// the community registry run by the MCP project, whose namespaces are verified
// against GitHub accounts and DNS. The registry sends no CORS headers, so the
// Host asks it and turns each server into install options Customize can save
// through `saveServer` unchanged: a Streamable HTTP endpoint, or an npm, PyPI or
// OCI package started over stdio with npx, uvx or docker.
// Tile logos come from registry-icons.mjs, keyed by the registry names a search returned.

import { createIconFetcher, iconSources } from './registry-icons.mjs'

export const MCP_REGISTRY_ORIGIN = 'https://registry.modelcontextprotocol.io'
const PAGE_SIZE = 30
const TIMEOUT_MS = 15_000
const CACHE_MS = 10 * 60_000
const COUNT_TIMEOUT_MS = 5_000
const COUNT_MS = 6 * 60 * 60_000
const COUNT_MISS_MS = 10 * 60_000
const SINCE_DAYS = { week: 7, month: 30 }

// Well-known publishers shown before the user types: a registry name, or the id
// of an official server the publisher runs but has not published to the registry.
export const FEATURED_MCP_SERVERS = [
  'io.github.github/github-mcp-server',
  'com.notion/mcp',
  'com.slack/mcp',
  'app.linear/linear',
  'com.atlassian/atlassian-mcp-server',
  'com.figma.mcp/mcp',
  'ai.higgsfield/mcp',
  'io.github.microsoft/playwright-mcp',
  'io.github.ChromeDevTools/chrome-devtools-mcp',
  'io.github.upstash/context7',
  'io.github.getsentry/sentry-mcp',
  'com.stripe/mcp',
  'com.supabase/mcp',
  'com.vercel/vercel-mcp',
  'com.zapier/mcp',
  'io.github.brave/brave-search-mcp-server',
]

// Official servers missing from the registry, in its v0 shape and named under
// the publisher's own domain. Endpoints are from the publishers' docs:
// docs.slack.dev/ai/slack-mcp-server and higgsfield.ai/mcp.
export const PUBLISHER_LISTED_SERVERS = [
  {
    name: 'com.slack/mcp', title: 'Slack',
    description: 'Search channels and messages, read threads, and send messages in your Slack workspace.',
    websiteUrl: 'https://slack.com',
    remotes: [{ type: 'streamable-http', url: 'https://mcp.slack.com/mcp' }],
  },
  {
    name: 'ai.higgsfield/mcp', title: 'Higgsfield',
    description: 'Generate images and videos with 30+ Higgsfield models from your agent. Generations use your Higgsfield credits.',
    websiteUrl: 'https://higgsfield.ai',
    remotes: [{ type: 'streamable-http', url: 'https://mcp.higgsfield.ai/mcp' }],
  },
].map(server => ({ server, _meta: { 'io.modelcontextprotocol.registry/official': { status: 'active' } } }))
const publisherListed = new Map(PUBLISHER_LISTED_SERVERS.map(raw => [raw.server.name, raw]))

const text = value => typeof value === 'string' ? value.trim() : ''
const list = value => Array.isArray(value) ? value : []

/** The account or domain a registry namespace was verified against, e.g. `github.com/github` or `notion.com`. */
export function publisherOf(name) {
  const namespace = text(name).split('/')[0]
  const github = /^io\.github\.(.+)$/.exec(namespace)
  if (github) return `github.com/${github[1]}`
  return namespace.split('.').reverse().join('.')
}

// A server named only `mcp` or `server` is called after its publisher instead: `com.notion/mcp` is Notion.
function baseName(name) {
  const [namespace, tail = ''] = text(name).split('/')
  if (tail && !/^(mcp|server|mcp-server)$/i.test(tail)) return tail
  const github = /^io\.github\.(.+)$/.exec(namespace)
  const label = github ? github[1] : namespace.split('.').at(-1) ?? ''
  return label ? label.charAt(0).toUpperCase() + label.slice(1) : tail
}

/** A Jan server name (1 to 32 of letters, digits, `_` and `-`) for a registry name. */
export function serverSlug(name) {
  const slug = baseName(name).replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32).replace(/-+$/, '')
  return slug.toLowerCase() || 'server'
}

// A field the user fills in before saving: an environment variable or a header.
function field(target, input) {
  const name = text(input?.name)
  if (!name) return undefined
  const fallback = text(input.value) || text(input.default)
  return {
    target, name,
    description: text(input.description),
    required: input.isRequired === true,
    secret: input.isSecret === true,
    value: fallback,
    placeholder: text(input.placeholder) || text(input.valueHint),
  }
}

// Fixed arguments only: an argument the user must invent has no safe default here.
function argumentsOf(inputs) {
  const args = []
  for (const input of list(inputs)) {
    const value = text(input?.value) || text(input?.default)
    if (input?.type === 'named') {
      const name = text(input.name)
      if (!name) return undefined
      if (!value) { if (input.isRequired) return undefined; continue }
      args.push(name, value)
    } else {
      if (!value) { if (input?.isRequired) return undefined; continue }
      args.push(value)
    }
  }
  return args.some(arg => arg.includes('{')) ? undefined : args
}

function packageOption(pkg, index) {
  if (pkg?.transport?.type !== 'stdio') return undefined
  const identifier = text(pkg.identifier)
  const version = text(pkg.version)
  if (!identifier) return undefined
  const runtime = argumentsOf(pkg.runtimeArguments)
  const extra = argumentsOf(pkg.packageArguments)
  if (!runtime || !extra) return undefined
  const fields = list(pkg.environmentVariables).map(input => field('env', input)).filter(Boolean)
  const base = { id: `package-${index}`, transport: 'stdio', fields }
  switch (pkg.registryType) {
    case 'npm': {
      const registry = text(pkg.registryBaseUrl)
      const official = !registry || /^https:\/\/registry\.npmjs\.org\/?$/.test(registry)
      if (!official) return undefined
      const spec = version ? `${identifier}@${version}` : identifier
      return { ...base, kind: 'npm', label: 'npm package', command: 'npx', args: [...(runtime.length ? runtime : ['-y']), spec, ...extra] }
    }
    case 'pypi': {
      const spec = version ? `${identifier}==${version}` : identifier
      return { ...base, kind: 'pypi', label: 'Python package', command: 'uvx', args: [...runtime, spec, ...extra] }
    }
    case 'oci': {
      const image = version && !/[:@][^/]*$/.test(identifier) ? `${identifier}:${version}` : identifier
      const forwarded = fields.flatMap(item => ['-e', item.name])
      return { ...base, kind: 'oci', label: 'Docker image', command: 'docker', args: ['run', '-i', '--rm', ...runtime, ...forwarded, image, ...extra] }
    }
    default:
      return undefined
  }
}

function remoteOption(remote, index) {
  if (remote?.type !== 'streamable-http') return undefined
  let url
  try { url = new URL(text(remote.url)) } catch { return undefined }
  // Jan stores endpoints without query or fragment; templated hosts need values the registry cannot give.
  if (!['http:', 'https:'].includes(url.protocol) || url.search || url.hash || url.href.includes('%7B')) return undefined
  return {
    id: `remote-${index}`, kind: 'remote', label: 'Remote endpoint', transport: 'streamable-http', url: url.href,
    fields: list(remote.headers).map(input => field('header', input)).filter(Boolean),
  }
}

/**
 * One registry server as Customize shows it, or undefined when deleted or
 * offering nothing Jan can start.
 * @param {unknown} raw - one `servers[]` item of the registry's v0 API.
 */
export function registryEntry(raw) {
  const server = raw?.server
  const name = text(server?.name)
  const official = raw?._meta?.['io.modelcontextprotocol.registry/official']
  const status = official?.status
  if (!name || status === 'deleted') return undefined
  const options = [
    ...list(server.remotes).map(remoteOption),
    ...list(server.packages).map(packageOption),
  ].filter(Boolean)
  return {
    id: name,
    title: text(server.title) || baseName(name),
    description: text(server.description),
    version: text(server.version),
    publisher: publisherOf(name),
    website: text(server.websiteUrl) || undefined,
    repository: text(server.repository?.url) || undefined,
    deprecated: status === 'deprecated',
    // When the registry last changed this server's latest version, as an ISO date.
    updated: text(official?.updatedAt) || undefined,
    slug: serverSlug(name),
    options,
  }
}

// Packages whose public download counts Jan can read: npm (api.npmjs.org) and PyPI (pypistats.org).
function countedPackages(server) {
  return list(server?.packages).flatMap(pkg => {
    const identifier = text(pkg?.identifier)
    if (!identifier) return []
    if (pkg.registryType === 'npm' && (!text(pkg.registryBaseUrl) || /^https:\/\/registry\.npmjs\.org\/?$/.test(text(pkg.registryBaseUrl)))) return [{ source: 'npm', identifier }]
    if (pkg.registryType === 'pypi') return [{ source: 'PyPI', identifier }]
    return []
  })
}

/**
 * Search the registry, or list the featured servers when neither `query` nor `since` is given.
 * `since` keeps servers updated in the last 7 (`week`) or 30 (`month`) days.
 * Pages of one query continue with `cursor`. Each entry carries `downloads`, last week's
 * public download count of its npm or PyPI package, when it has one and the count could be read.
 * @param {{ query?: string, since?: 'week' | 'month', cursor?: string }} request
 * @param {{ fetch?: typeof fetch, now?: () => number }} [deps]
 */
export function createMcpRegistry({ fetch: fetchOverride, now = Date.now } = {}) {
  const request = fetchOverride ?? globalThis.fetch
  const cache = new Map()
  const logos = createIconFetcher({ fetch: fetchOverride, now })
  // Logo sources of every server a search returned; the client asks for logos by name only.
  const sources = new Map()
  // Last week's downloads by `source:identifier`; an unreadable count is kept as undefined for a while.
  const counts = new Map()
  function weekly({ source, identifier }) {
    const key = `${source}:${identifier}`
    const hit = counts.get(key)
    if (hit && now() - hit.at < (hit.value ? COUNT_MS : COUNT_MISS_MS)) return hit.value
    const url = source === 'npm'
      ? `https://api.npmjs.org/downloads/point/last-week/${identifier.replace('/', '%2F')}`
      : `https://pypistats.org/api/packages/${encodeURIComponent(identifier.toLowerCase())}/recent`
    const value = request(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(COUNT_TIMEOUT_MS), redirect: 'error' })
      .then(response => response.ok ? response.json() : undefined)
      .then(body => {
        const count = source === 'npm' ? body?.downloads : body?.data?.last_week
        return Number.isSafeInteger(count) && count >= 0 ? { count, source } : undefined
      }, () => undefined)
    counts.set(key, { at: now(), value })
    value.then(found => counts.set(key, { at: now(), value: found ? Promise.resolve(found) : undefined }))
    return value
  }
  async function entries(servers) {
    return (await Promise.all(servers.map(async raw => {
      const entry = registryEntry(raw)
      if (!entry?.options.length) return undefined
      sources.set(entry.id, iconSources(raw.server))
      const found = (await Promise.all(countedPackages(raw.server).map(weekly))).filter(Boolean)
      const downloads = found.sort((a, b) => b.count - a.count)[0]
      return downloads ? { ...entry, downloads } : entry
    }))).filter(Boolean)
  }
  async function get(path) {
    const hit = cache.get(path)
    if (hit && now() - hit.at < CACHE_MS) return hit.value
    const response = await request(`${MCP_REGISTRY_ORIGIN}${path}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'error' })
    if (response.status === 404) return undefined
    if (!response.ok) throw new Error(`The MCP Registry answered ${response.status}. Try again later.`)
    const value = await response.json()
    cache.set(path, { at: now(), value })
    return value
  }
  return {
    async search({ query = '', since, cursor } = {}) {
      const words = text(query)
      const days = SINCE_DAYS[since]
      try {
        if (!words && !days && !cursor) {
          const found = await Promise.all(FEATURED_MCP_SERVERS.map(name => publisherListed.get(name)
            ?? get(`/v0/servers/${encodeURIComponent(name)}/versions/latest`).catch(() => undefined)))
          return { featured: true, entries: await entries(found), nextCursor: undefined }
        }
        const params = new URLSearchParams({ limit: String(PAGE_SIZE), version: 'latest' })
        if (words) params.set('search', words)
        // Whole days, so a cached page holds for the day instead of missing on every call.
        if (days) params.set('updated_since', new Date((Math.floor(now() / 86_400_000) - days) * 86_400_000).toISOString())
        if (cursor) params.set('cursor', cursor)
        const page = await get(`/v0/servers?${params}`)
        // The registry cannot find servers it does not hold, so the first page leads with matching ones Jan lists.
        const needle = words.toLowerCase()
        const listed = cursor || !needle || days ? [] : PUBLISHER_LISTED_SERVERS.filter(({ server }) =>
          [server.name, server.title, server.description].some(value => value.toLowerCase().includes(needle)))
        return {
          featured: false,
          entries: await entries([...listed, ...list(page?.servers)]),
          nextCursor: text(page?.metadata?.nextCursor) || undefined,
        }
      } catch (error) {
        if (error?.name === 'TimeoutError' || error?.name === 'TypeError') throw new Error('The MCP Registry could not be reached. Check your connection and try again.')
        throw error
      }
    },
    /**
     * The logo of a server an earlier search returned, as a data: URL, or
     * undefined when it has none. `fallback` gives sources for a name no search returned.
     * @param {string} id
     * @param {{ icons: string[], sites: string[] }} [fallback]
     */
    async icon(id, fallback) {
      const found = sources.get(id) ?? fallback
      return found ? logos.icon(id, found) : undefined
    },
  }
}
