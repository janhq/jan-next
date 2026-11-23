// Logos for MCP Registry tiles. The Host fetches them, so the Settings page
// never contacts publisher sites itself, and hands back a small data: URL.
// Sources, in order:
// 1. the server's own `icons` from the registry;
// 2. the GitHub avatar of an `io.github.<owner>` namespace;
// 3. icons linked from the publisher's homepage, then `/apple-touch-icon.png` and `/favicon.ico`.
// Only public https hosts named by DNS are fetched, and each hop of a redirect is checked again.

import { lookup } from 'node:dns'
import { get as httpsGet } from 'node:https'
import { BlockList } from 'node:net'
import { Readable } from 'node:stream'
import { proxyRouteFor } from '@janhq/jan-http-proxy'

const MAX_BYTES = 200 * 1024
const MAX_PAGE_BYTES = 512 * 1024
const MAX_REDIRECTS = 3
const TIMEOUT_MS = 6_000
const CACHE_MS = 60 * 60_000
// A miss caused by a network failure is retried after this, not after CACHE_MS.
const RETRY_MS = 2 * 60_000
const CACHE_ENTRIES = 500

const text = value => typeof value === 'string' ? value.trim() : ''

const excludedIpv4 = new BlockList()
for (const [address, bits] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) excludedIpv4.addSubnet(address, bits, 'ipv4')

// Global unicast only. This also excludes IPv4-mapped, local and scoped IPv6 addresses.
const globalIpv6 = new BlockList()
globalIpv6.addSubnet('2000::', 3, 'ipv6')
const excludedIpv6 = new BlockList()
for (const [address, bits] of [['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20]]) {
  excludedIpv6.addSubnet(address, bits, 'ipv6')
}

function publicLookup(hostname, options, callback) {
  // Validate the results handed straight to the socket, including every candidate for dual-stack dialing.
  lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) { callback(error); return }
    const isPublic = ({ address, family }) => family === 4 ? !excludedIpv4.check(address, 'ipv4')
      : family === 6 && globalIpv6.check(address, 'ipv6') && !excludedIpv6.check(address, 'ipv6')
    if (!addresses.length || !addresses.every(isPublic)) { callback(new Error('Registry icons require a public network address.')); return }
    if (options.all) callback(null, addresses)
    else callback(null, addresses[0].address, addresses[0].family)
  })
}

async function requestPublicIcon(href, { headers, signal }) {
  const url = new URL(href)
  // A configured proxy resolves the origin itself. Do not bypass it or let it follow an unverified route.
  if (proxyRouteFor(url).proxied) return undefined
  return new Promise((resolve, reject) => {
    // A fresh direct socket uses our lookup and retains the original hostname for TLS and Host.
    const request = httpsGet(url, { agent: false, headers, signal, lookup: publicLookup }, incoming => {
      const { statusCode: status = 0 } = incoming
      resolve({ status, ok: status >= 200 && status < 300, headers: new Headers(incoming.headers), body: Readable.toWeb(incoming, { strategy: { highWaterMark: 0 } }) })
    })
    request.once('error', reject)
  })
}

/** A URL the Host may fetch: https, a DNS name, and not a local or internal name. */
export function publicHttpsUrl(value, base) {
  let url
  try { url = new URL(value, base) } catch { return undefined }
  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  if (url.protocol !== 'https:' || url.username || url.password) return undefined
  if (!host.includes('.') || host.includes(':') || host.startsWith('[') || /^[\d.]+$/.test(host)) return undefined
  if (/(^|\.)(localhost|local|internal|home|lan|intranet|corp)$/.test(host)) return undefined
  return url
}

// `mcp.figma.com` also tries `figma.com`, where the brand's own icons live.
function domains(host) {
  const labels = host.split('.')
  return labels.length > 2 ? [host, labels.slice(-2).join('.')] : [host]
}

/**
 * Where a registry server's logo may come from, most specific first.
 * @param {{ name?: string, icons?: unknown, websiteUrl?: string }} server
 * @returns {{ icons: string[], sites: string[] }} direct image URLs, then sites whose homepage names an icon.
 */
export function iconSources(server) {
  const icons = []
  const listed = Array.isArray(server?.icons) ? server.icons : []
  // Vector first, then the largest bitmap: tiles draw at 32px on dense screens.
  const size = icon => Math.max(0, ...(Array.isArray(icon?.sizes) ? icon.sizes : []).map(value => value === 'any' ? 4096 : Number.parseInt(value, 10) || 0))
  for (const icon of [...listed].sort((a, b) => size(b) - size(a))) {
    const url = publicHttpsUrl(text(icon?.src))
    if (url) icons.push(url.href)
  }
  const namespace = text(server?.name).split('/')[0]
  const website = publicHttpsUrl(text(server?.websiteUrl))
  // An `io.github.<owner>` namespace, or a homepage on GitHub, names an account whose avatar is its logo.
  const owner = /^io\.github\.([A-Za-z0-9-]+)$/.exec(namespace)?.[1]
    ?? (website?.hostname === 'github.com' ? /^\/([A-Za-z0-9-]+)/.exec(website.pathname)?.[1] : undefined)
  if (owner) icons.push(`https://github.com/${owner}.png?size=128`)
  const hosts = []
  if (website && website.hostname !== 'github.com') hosts.push(...domains(website.hostname))
  if (!namespace.startsWith('io.github.') && namespace.includes('.')) hosts.push(...domains(namespace.split('.').reverse().join('.')))
  return { icons, sites: [...new Set(hosts)].filter(host => publicHttpsUrl(`https://${host}/`)) }
}

/** Icon hrefs a homepage links, apple-touch and larger declared sizes first. */
export function linkedIcons(html, base) {
  const found = []
  for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
    const attr = name => new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag)?.slice(1).find(Boolean) ?? ''
    const rel = attr('rel').toLowerCase().split(/\s+/)
    if (!rel.some(word => word === 'icon' || word === 'apple-touch-icon')) continue
    const url = publicHttpsUrl(attr('href').replaceAll('&amp;', '&'), base)
    if (!url) continue
    const sizes = attr('sizes').split(/\s+/).map(value => Number.parseInt(value, 10) || 0)
    found.push({ href: url.href, rank: (rel.includes('apple-touch-icon') ? 10_000 : 0) + Math.max(0, ...sizes) })
  }
  return found.sort((a, b) => b.rank - a.rank).map(item => item.href)
}

// An image larger than `cap` is refused; with `prefix`, a page is cut at `cap`
// instead, since the icon links sit in its head.
async function readCapped(response, cap, prefix = false) {
  const declared = Number(response.headers.get('content-length'))
  if (declared > cap && !prefix) { await response.body?.cancel(); return undefined }
  const reader = response.body?.getReader()
  if (!reader) return new Uint8Array()
  const chunks = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    total += value.byteLength
    if (total > cap) {
      await reader.cancel()
      return prefix ? Buffer.concat(chunks).subarray(0, cap) : undefined
    }
  }
  return Buffer.concat(chunks)
}

/**
 * Resolve logos as data: URLs, at most one fetch chain per key at a time.
 * @param {{ fetch?: typeof fetch, now?: () => number }} [deps]
 */
export function createIconFetcher({ fetch: request = requestPublicIcon, now = Date.now } = {}) {
  const cache = new Map()

  async function get(href, accept) {
    let url = publicHttpsUrl(href)
    for (let hop = 0; url && hop <= MAX_REDIRECTS; hop++) {
      const response = await request(url.href, { headers: { accept }, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) })
      if (!response) return undefined
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel()
        const location = response.headers.get('location')
        url = location ? publicHttpsUrl(location, url) : undefined
        continue
      }
      return response.ok ? { response, url } : (await response.body?.cancel(), undefined)
    }
    return undefined
  }

  // `trip.failed` records a network failure, so the miss is retried sooner than a real absence.
  async function image(href, trip) {
    try {
      const got = await get(href, 'image/*')
      if (!got) return undefined
      const type = (got.response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
      if (!type.startsWith('image/')) { await got.response.body?.cancel(); return undefined }
      const bytes = await readCapped(got.response, MAX_BYTES)
      if (!bytes?.byteLength) return undefined
      return `data:${type};base64,${Buffer.from(bytes).toString('base64')}`
    } catch { trip.failed = true; return undefined }
  }

  // Undefined when the host cannot be reached, so its other paths are not tried.
  async function homepageIcons(host, trip) {
    try {
      const got = await get(`https://${host}/`, 'text/html')
      if (!got || !(got.response.headers.get('content-type') ?? '').includes('html')) { await got?.response.body?.cancel(); return [] }
      const bytes = await readCapped(got.response, MAX_PAGE_BYTES, true)
      return bytes ? linkedIcons(Buffer.from(bytes).toString('utf8'), got.url) : []
    } catch { trip.failed = true; return undefined }
  }

  async function resolve({ icons, sites }) {
    const trip = { failed: false }
    for (const href of icons) {
      const found = await image(href, trip)
      if (found) return { value: found }
    }
    for (const host of sites) {
      const linked = await homepageIcons(host, trip)
      if (!linked) continue
      for (const href of [...linked.slice(0, 3), `https://${host}/apple-touch-icon.png`, `https://${host}/favicon.ico`]) {
        const found = await image(href, trip)
        if (found) return { value: found }
      }
    }
    return { value: undefined, ttl: trip.failed ? RETRY_MS : CACHE_MS }
  }

  return {
    /**
     * The logo for `key` as a data: URL, or undefined when no source answers with an image.
     * @param {string} key - stable id the result is cached under.
     * @param {{ icons: string[], sites: string[] }} sources - from {@link iconSources}.
     */
    icon(key, sources) {
      const hit = cache.get(key)
      if (hit && now() - hit.at < (hit.ttl ?? CACHE_MS)) return hit.value
      const entry = { at: now(), ttl: CACHE_MS, value: undefined }
      entry.value = resolve(sources).then(result => {
        entry.ttl = result.ttl ?? CACHE_MS
        return result.value
      })
      cache.delete(key)
      cache.set(key, entry)
      if (cache.size > CACHE_ENTRIES) cache.delete(cache.keys().next().value)
      return entry.value
    },
  }
}
