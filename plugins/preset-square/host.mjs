import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import yaml from 'js-yaml'
import { strFromU8, unzipSync } from 'fflate'
import { registerApi } from '@janhq/jan-plugin-api'

export const inject = ['webServer', 'connection', 'agentPresets']

const ORIGIN = 'https://dshdesktop.com'
const API = `${ORIGIN}/preset/api/v1/presets`
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/
const SLUG = /^[a-z0-9][a-z0-9-]{0,159}$/
const LANGS = new Set(['zh', 'en', 'ja', 'ru', 'es', 'pt'])
const MAX_ARCHIVE = 16 * 1024 * 1024
const MAX_UNPACKED = 32 * 1024 * 1024
const MAX_FILES = 512
const COMPOSITION = 'agent.cordis.yml'
const PERSONA = '@janhq/jan-persona'

// The Loader's YAML dialect: `!!js` stays an expression object until the
// owning entry evaluates it, so platform conditions keep working.
const JsExpr = new yaml.Type('tag:yaml.org,2002:js', {
  kind: 'scalar',
  resolve: data => typeof data === 'string',
  construct: data => ({ __jsExpr: data }),
})
const schema = yaml.JSON_SCHEMA.extend(JsExpr)

// Gallery packages are written for older harness releases: persona's `text`
// became `prefix`, the worker-thread workflow provider became `workflow-ptc`,
// and subagent-control absorbed `list-agents`.
const RENAMED = { '@janhq/jan-workflow-worker-thread': '@janhq/jan-workflow-ptc' }
const MERGED = new Set(['@janhq/jan-tool-subagent-control/list-agents'])
function migrateRows(rows) {
  for (let index = rows.length - 1; index >= 0; index--) {
    const row = rows[index]
    if (!row || typeof row !== 'object') continue
    if (MERGED.has(row.name)) { rows.splice(index, 1); continue }
    if (RENAMED[row.name]) row.name = RENAMED[row.name]
    if (row.name === PERSONA && row.config && typeof row.config === 'object' && row.config.prefix === undefined && typeof row.config.text === 'string') {
      row.config.prefix = row.config.text
      delete row.config.text
    }
    if (Array.isArray(row.config?.plugins)) migrateRows(row.config.plugins)
    if (Array.isArray(row.config)) migrateRows(row.config)
  }
  return rows
}

// A package's relative module names and `baseUrl` expressions mean its own
// folder, where its skills and helper modules are unpacked.
function rebase(value, folder) {
  if (Array.isArray(value)) return value.map(item => rebase(item, folder))
  if (!value || typeof value !== 'object') return value
  if (typeof value.__jsExpr === 'string') return { __jsExpr: value.__jsExpr.replace(/\bbaseUrl\b/g, JSON.stringify(folder)) }
  const out = {}
  for (const [key, item] of Object.entries(value)) {
    out[key] = key === 'name' && typeof item === 'string' && /^\.{1,2}\//.test(item) ? new URL(item, folder).href : rebase(item, folder)
  }
  return out
}

function parseComposition(text) {
  const rows = yaml.load(text.replace(/^\uFEFF/, ''), { schema })
  if (!Array.isArray(rows)) throw new Error('The preset composition is not a plugin list.')
  return migrateRows(rows)
}

async function remote(url, { binary = false } = {}) {
  // The gallery rejects requests without a browser-like agent, and a
  // redirect could leave the official host, so neither is followed.
  const response = await globalThis.fetch(url, { redirect: 'error', headers: { 'user-agent': 'Mozilla/5.0 Jan', accept: binary ? 'application/octet-stream' : 'application/json' } })
  if (!response.ok) {
    let reason = `HTTP ${response.status}`
    try { reason = (await response.json()).error?.message ?? reason } catch { }
    throw new Error(`Preset Square: ${reason}`)
  }
  if (!binary) return response.json()
  const length = Number(response.headers.get('content-length'))
  if (Number.isFinite(length) && length > MAX_ARCHIVE) throw new Error('The preset package is larger than 16 MB.')
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.length > MAX_ARCHIVE) throw new Error('The preset package is larger than 16 MB.')
  return bytes
}

function official(url) {
  const parsed = new URL(url)
  if (parsed.origin !== ORIGIN || !parsed.pathname.startsWith('/preset/')) throw new Error(`Refusing a package outside ${ORIGIN}/preset.`)
  return parsed.href
}

function unpack(bytes) {
  let entries
  try { entries = unzipSync(bytes) } catch { throw new Error('The package is not a valid ZIP archive.') }
  const manifest = entries['manifest.json'] ? JSON.parse(strFromU8(entries['manifest.json'])) : undefined
  if (manifest?.format !== 'dsh-preset' || manifest.version !== 1) throw new Error('The package is not a version 1 DSH preset.')
  const id = String(manifest.id ?? '').trim().toLowerCase()
  if (!ID.test(id)) throw new Error(`The package has an invalid preset id "${manifest.id}".`)
  const files = new Map()
  let total = 0
  for (const [raw, data] of Object.entries(entries)) {
    const path = raw.replaceAll('\\', '/')
    if (path === 'manifest.json' || path.endsWith('/') || path.startsWith('__MACOSX/')) continue
    const segments = path.split('/').filter(segment => segment && segment !== '.')
    if (!segments.length || segments.includes('..') || /^[a-zA-Z]:/.test(path) || path.startsWith('/')) throw new Error(`The package contains an unsafe path "${raw}".`)
    const relative = (segments[0] === 'preset' ? segments.slice(1) : segments).join('/')
    if (!relative) continue
    if (files.size >= MAX_FILES) throw new Error(`The package has more than ${MAX_FILES} files.`)
    total += data.length
    if (total > MAX_UNPACKED) throw new Error('The unpacked package exceeds 32 MB.')
    files.set(relative, data)
  }
  if (!files.has(COMPOSITION)) throw new Error(`The package has no ${COMPOSITION}.`)
  parseComposition(strFromU8(files.get(COMPOSITION)))
  return { id, manifest, files }
}

export function apply(ctx) {
  if (!process.env.JAN_HOME) throw new Error('JAN_HOME is not set; Preset Square has nowhere to keep presets.')
  const root = resolve(process.env.JAN_HOME, '.agent-presets')
  /** Presets this plugin registered, by id. */
  const mounted = new Map()
  let busy = false

  const readPreset = async (id) => {
    const directory = join(root, id)
    const meta = JSON.parse(await readFile(join(directory, 'square.json'), 'utf8'))
    const plugins = parseComposition(await readFile(join(directory, COMPOSITION), 'utf8'))
    return { directory, meta, plugins }
  }

  const mount = async (id) => {
    const { directory, meta, plugins } = await readPreset(id)
    // Plugin packages must keep resolving from the profile, so the registration
    // keeps its base; only the preset's own files point at its folder.
    const dispose = await ctx.agentPresets.register({ id, name: meta.name, description: meta.description, plugins: rebase(plugins, pathToFileURL(directory + sep).href) })
    mounted.set(id, { dispose, meta })
  }

  const unmountAll = async () => {
    for (const { dispose } of mounted.values()) await dispose().catch(() => { })
    mounted.clear()
  }

  ctx.effect(() => {
    let stopped = false
    void (async () => {
      let names = []
      try { names = (await readdir(root, { withFileTypes: true })).filter(entry => entry.isDirectory() && ID.test(entry.name)).map(entry => entry.name) } catch { }
      for (const id of names) {
        if (stopped) return
        try { await mount(id) } catch (error) { ctx.logger?.warn?.(`preset-square: ${id}: ${error instanceof Error ? error.message : error}`) }
      }
    })()
    return () => { stopped = true; void unmountAll() }
  }, 'preset-square: installed presets')

  const list = async ({ sort = 'downloads', lang = 'en' }) => {
    if (sort !== 'downloads' && sort !== 'newest') throw new Error('Sort by downloads or newest.')
    const language = LANGS.has(lang) ? lang : 'en'
    const listing = await remote(`${API}?sort=${sort}&lang=${language}`)
    const registered = new Set((await ctx.agentPresets.list()).map(preset => preset.id))
    return {
      presets: (listing.items ?? []).map(item => ({
        slug: item.slug, presetId: item.presetId, title: item.title, description: item.description,
        publisher: item.publisher?.username, downloads: item.downloadCount, sourceDshVersion: item.artifact?.sourceDshVersion,
        sizeBytes: item.artifact?.sizeBytes, detailUrl: item.detailUrl,
        installed: mounted.has(item.presetId), conflict: !mounted.has(item.presetId) && registered.has(item.presetId),
      })),
    }
  }

  const install = async ({ slug }) => {
    if (typeof slug !== 'string' || !SLUG.test(slug)) throw new Error('Choose a preset from the gallery.')
    if (busy) throw new Error('Another preset change is running.')
    busy = true
    let staging
    try {
      const detail = await remote(`${API}/${slug}?lang=en`)
      const { downloadUrl, sha256, sizeBytes } = detail.artifact ?? {}
      const bytes = await remote(official(downloadUrl), { binary: true })
      if (bytes.length !== sizeBytes) throw new Error(`The download is ${bytes.length} bytes; the gallery lists ${sizeBytes}.`)
      const digest = createHash('sha256').update(bytes).digest('hex')
      if (digest !== sha256) throw new Error('The download does not match the gallery checksum.')
      const { id, manifest, files } = unpack(bytes)
      if (id !== detail.presetId) throw new Error(`The package id "${id}" does not match the gallery entry "${detail.presetId}".`)
      if (mounted.has(id) || (await ctx.agentPresets.list()).some(preset => preset.id === id)) throw new Error(`A preset named "${id}" is already installed.`)
      await mkdir(root, { recursive: true })
      staging = await mkdtemp(join(root, '.install-'))
      for (const [relative, data] of files) {
        const target = resolve(staging, relative)
        if (!target.startsWith(staging + sep)) throw new Error(`Unsafe path ${relative}.`)
        await mkdir(dirname(target), { recursive: true })
        await writeFile(target, data)
      }
      await writeFile(join(staging, 'square.json'), JSON.stringify({
        name: detail.title ?? manifest.name ?? id, description: detail.description ?? manifest.description ?? '',
        slug, publisher: detail.publisher?.username, sha256, sourceDshVersion: detail.artifact?.sourceDshVersion, installedAt: new Date().toISOString(),
      }, null, 2))
      await rename(staging, join(root, id))
      staging = undefined
      try { await mount(id) } catch (error) {
        await rm(join(root, id), { recursive: true, force: true })
        throw error
      }
      return { id }
    } finally {
      if (staging) await rm(staging, { recursive: true, force: true }).catch(() => { })
      busy = false
    }
  }

  const remove = async ({ id }) => {
    if (typeof id !== 'string' || !mounted.has(id)) throw new Error('That preset was not installed from Preset Square.')
    if (busy) throw new Error('Another preset change is running.')
    busy = true
    try {
      await mounted.get(id).dispose()
      mounted.delete(id)
      await rm(join(root, id), { recursive: true, force: true })
      return { id }
    } finally { busy = false }
  }

  const installed = async () => ({
    presets: [...mounted].map(([id, { meta }]) => ({ id, name: meta.name, description: meta.description, publisher: meta.publisher, slug: meta.slug })),
  })

  ctx.effect(() => registerApi(ctx, 'preset-square', { list, install, remove, installed }), 'preset-square API')
}
