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

// Well-known publishers shown before the user types, by exact registry name.
export const FEATURED_MCP_SERVERS = [
  'io.github.github/github-mcp-server',
  'com.notion/mcp',
  'app.linear/linear',
  'com.atlassian/atlassian-mcp-server',
  'com.figma.mcp/mcp',
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
  const status = raw?._meta?.['io.modelcontextprotocol.registry/official']?.status
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
    slug: serverSlug(name),
    options,
  }
}

/**
 * Search the registry, or list the featured servers when `query` is empty.
 * Pages of one query continue with `cursor`.
 * @param {{ query?: string, cursor?: string }} request
 * @param {{ fetch?: typeof fetch, now?: () => number }} [deps]
 */
export function createMcpRegistry({ fetch: request = globalThis.fetch, now = Date.now } = {}) {
  const cache = new Map()
  const logos = createIconFetcher({ fetch: request, now })
  // Logo sources of every server a search returned; the client asks for logos by name only.
  const sources = new Map()
  function entries(servers) {
    return servers.map(raw => {
      const entry = registryEntry(raw)
      if (entry?.options.length) sources.set(entry.id, iconSources(raw.server))
      return entry
    }).filter(entry => entry?.options.length)
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
    async search({ query = '', cursor } = {}) {
      const words = text(query)
      try {
        if (!words && !cursor) {
          const found = await Promise.all(FEATURED_MCP_SERVERS.map(name =>
            get(`/v0/servers/${encodeURIComponent(name)}/versions/latest`).catch(() => undefined)))
          return { featured: true, entries: entries(found), nextCursor: undefined }
        }
        const params = new URLSearchParams({ limit: String(PAGE_SIZE), version: 'latest' })
        if (words) params.set('search', words)
        if (cursor) params.set('cursor', cursor)
        const page = await get(`/v0/servers?${params}`)
        return {
          featured: false,
          entries: entries(list(page?.servers)),
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
