import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

// Jan's built-in remote providers and the jan-next route each one maps to. A
// `null` route has no catalog entry here and is declared from Jan's endpoint.
// Any provider id not listed is one the user added in Jan.
const BUILT_IN = {
  openai: 'openai', anthropic: 'anthropic', openrouter: 'openrouter', mistral: 'mistral', groq: 'groq', xai: 'xai',
  gemini: 'google', minimax: 'minimax', huggingface: 'huggingface', nvidia: 'nvidia', tokamak: 'tokamak', azure: null,
}
// Engines that run models on this machine; their models are not routes.
const LOCAL = new Set(['llamacpp', 'mlx'])
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const missing = error => error?.code === 'ENOENT'
const httpUrl = value => {
  try { return ['http:', 'https:'].includes(new URL(value).protocol) } catch { return false }
}
const routeOf = id => Object.hasOwn(BUILT_IN, id) && BUILT_IN[id] !== null
  ? BUILT_IN[id]
  : id.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'jan-provider'

/**
 * The credential reference a route's key is stored under; the same name the
 * Models settings page derives, so the page shows the key as set.
 * @param {string} route - the jan-next provider route id.
 * @returns {string} the reference name.
 */
export const keyRef = route => `${route.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`

/**
 * The Jan providers worth bringing: every built-in Jan holds a key for, and
 * every provider the user added with a usable endpoint. Local engines and
 * OAuth logins (`auth:` keys) stay behind.
 * @param {object} settings - Jan's parsed settings.json.
 * @param {string[]} keyNames - provider ids Jan holds a key for.
 * @returns {object[]} rows `{ id, route, catalog, baseURL, models, hasKey }`.
 */
export function janProviders(settings, keyNames) {
  let providers = []
  try { providers = JSON.parse(settings?.['model-provider'] ?? 'null')?.state?.providers ?? [] } catch { return [] }
  const keyed = new Set(keyNames.filter(name => !name.startsWith('auth:')))
  return providers.flatMap(provider => {
    const id = provider?.provider
    if (typeof id !== 'string' || !id || LOCAL.has(id)) return []
    const hasKey = keyed.has(id)
    const builtIn = Object.hasOwn(BUILT_IN, id)
    const catalog = builtIn && BUILT_IN[id] !== null
    if (builtIn && !hasKey) return []
    const baseURL = typeof provider.base_url === 'string' ? provider.base_url.trim() : ''
    if (!catalog && !httpUrl(baseURL)) return []
    const models = (Array.isArray(provider.models) ? provider.models : [])
      .filter(model => typeof model?.id === 'string' && model.id)
      .map(model => ({ id: model.id, ...(typeof model.name === 'string' && model.name && model.name !== model.id ? { name: model.name } : {}) }))
    return [{ id, route: routeOf(id), catalog, baseURL, models, hasKey }]
  })
}

/**
 * The `llm-pi-ai` route a Jan provider becomes.
 * @param {object} row - one {@link janProviders} row.
 * @param {string | undefined} ref - the key reference, when a key comes along.
 * @returns {object} the provider profile.
 */
export function providerProfile(row, ref) {
  const key = ref === undefined ? {} : { apiKeyEnv: ref }
  if (row.catalog) return key
  return { displayName: row.id, api: 'openai-completions', baseURL: row.baseURL, ...key, models: row.models }
}

// The MCP fields jan-next's server editor accepts; Jan's `active` and
// `description` have no place there.
const MCP_FIELDS = ['command', 'args', 'env', 'cwd', 'url', 'headers', 'type', 'transport']

/**
 * Jan's MCP servers as an `mcpServers` document the MCP settings import takes:
 * names made valid (letters, digits, `_`, `-`, at most 32) and unique, and
 * each server reduced to the fields jan-next keeps.
 * @param {object} config - Jan's parsed mcp_config.json.
 * @returns {{ servers: Record<string, object>, renamed: Record<string, string>, skipped: { sourceName: string, reason: string }[] }}
 */
export function janMcpServers(config) {
  const servers = {}
  const renamed = {}
  const skipped = []
  for (const [sourceName, value] of Object.entries(plain(config?.mcpServers) ? config.mcpServers : {})) {
    if (!plain(value)) { skipped.push({ sourceName, reason: 'not a server entry' }); continue }
    const type = value.transport ?? value.type
    if (type && !['stdio', 'http', 'streamable-http'].includes(type)) { skipped.push({ sourceName, reason: `${type} transport is not supported` }); continue }
    if (JSON.stringify(value).includes('${')) { skipped.push({ sourceName, reason: 'uses ${...} placeholders; add it by hand with real values' }); continue }
    const base = sourceName.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'server'
    let name = base
    for (let index = 2; Object.hasOwn(servers, name); index++) name = `${base.slice(0, 32 - String(index).length - 1)}-${index}`
    servers[name] = Object.fromEntries(MCP_FIELDS.filter(field => value[field] !== undefined).map(field => [field, value[field]]))
    if (name !== sourceName) renamed[name] = sourceName
  }
  return { servers, renamed, skipped }
}

/**
 * The preset id one Jan assistant becomes; hashed when Jan's id is unusable.
 * @param {string} id - Jan's assistant id.
 * @returns {string} the preset id.
 */
export const assistantPresetId = id => `jan-assistant-${/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(id) ? id : createHash('sha256').update(id).digest('hex').slice(0, 16)}`

/**
 * Jan assistants as preset records. Sampling parameters do not come along.
 * @param {object[]} assistants - parsed assistant.json files.
 * @returns {object[]} records `{ id, source, name, description, instructions }`.
 */
export function janAssistants(assistants) {
  return assistants.filter(item => typeof item?.id === 'string' && item.id).map(item => ({
    id: assistantPresetId(item.id),
    source: item.id,
    name: typeof item.name === 'string' && item.name.trim() ? item.name.trim() : item.id,
    description: typeof item.description === 'string' ? item.description : '',
    instructions: typeof item.instructions === 'string' ? item.instructions : '',
  }))
}

/**
 * A preset for one Jan assistant: the base preset with its persona text
 * replaced by the assistant's instructions, kept literal so Jan's `{{...}}`
 * placeholders are not read as jan-next prompt variables. Empty instructions
 * keep the base persona.
 * @param {{ plugins: object[] }} base - the base preset definition.
 * @param {object} record - one {@link janAssistants} record.
 * @returns {object} the preset definition.
 */
export function derivePreset(base, record) {
  const persona = { id: 'persona', name: '@janhq/jan-persona', config: { prefix: record.instructions, interpolate: false } }
  const plugins = !record.instructions.trim() ? [...base.plugins]
    : base.plugins.some(row => row.id === 'persona') ? base.plugins.map(row => row.id === 'persona' ? persona : row)
      : [persona, ...base.plugins]
  return { id: record.id, name: record.name, ...(record.description ? { description: record.description } : {}), plugins }
}

const readJson = async path => {
  try { return JSON.parse(await readFile(path, 'utf8')) } catch (error) { if (missing(error)) return undefined; throw error }
}

/**
 * What the Jan folder holds besides chats, without any secret value.
 * @param {string} folder - Jan's data folder.
 * @param {string[]} keyNames - provider ids Jan holds a key for.
 * @returns {Promise<{ providers: object[], mcp: ReturnType<typeof janMcpServers>, assistants: object[] }>}
 */
export async function readJanSettings(folder, keyNames) {
  const providers = janProviders(await readJson(join(folder, 'settings.json')) ?? {}, keyNames)
  const mcp = janMcpServers(await readJson(join(folder, 'mcp_config.json')) ?? {})
  const assistants = []
  let entries = []
  try { entries = await readdir(join(folder, 'assistants'), { withFileTypes: true }) } catch (error) { if (!missing(error)) throw error }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    try {
      const item = await readJson(join(folder, 'assistants', entry.name, 'assistant.json'))
      if (item) assistants.push(item)
    } catch { /* an unreadable assistant is left behind */ }
  }
  return { providers, mcp, assistants: janAssistants(assistants) }
}
