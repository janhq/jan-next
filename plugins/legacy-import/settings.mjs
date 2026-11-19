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
const catalogRouteFor = id => Object.hasOwn(BUILT_IN, id) ? BUILT_IN[id] : undefined
const unroutedProviderSlug = id => id.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'jan-provider'

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
  const rows = providers.flatMap(provider => {
    const id = provider?.provider
    if (typeof id !== 'string' || !id || LOCAL.has(id)) return []
    const hasKey = keyed.has(id)
    const catalogRoute = catalogRouteFor(id)
    const catalog = typeof catalogRoute === 'string'
    if (catalogRoute !== undefined && !hasKey) return []
    const baseURL = typeof provider.base_url === 'string' ? provider.base_url.trim() : ''
    if (!catalog && !httpUrl(baseURL)) return []
    const models = (Array.isArray(provider.models) ? provider.models : [])
      .filter(model => typeof model?.id === 'string' && model.id)
      .map(model => ({ id: model.id, ...(typeof model.name === 'string' && model.name && model.name !== model.id ? { name: model.name } : {}) }))
    return [{ id, route: catalogRoute ?? unroutedProviderSlug(id), catalog, baseURL, models, hasKey }]
  })
  const used = new Set([...Object.keys(BUILT_IN), ...Object.values(BUILT_IN).filter(Boolean)])
  for (const row of rows.filter(row => !row.catalog).sort((a, b) => a.id.localeCompare(b.id) || a.baseURL.localeCompare(b.baseURL))) {
    const base = row.route
    let route = base
    if (used.has(route)) {
      const suffix = `-${createHash('sha256').update(row.id).digest('hex').slice(0, 12)}`
      route = `${base.slice(0, 64 - suffix.length)}${suffix}`
      for (let index = 2; used.has(route); index++) route = `${base.slice(0, 64 - suffix.length - String(index).length - 1)}${suffix}-${index}`
    }
    row.route = route
    used.add(route)
  }
  return rows
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
 * Normalize Jan's MCP server names and settings for Host import. The returned
 * server definitions can contain credentials and must not be returned over RPC.
 * @param {object} config - Jan's parsed mcp_config.json.
 * @returns {{ servers: Record<string, object>, renamed: Record<string, string>, skipped: { sourceName: string, reason: string }[] }}
 */
export function janMcpServers(config) {
  const servers = Object.create(null)
  const renamed = Object.create(null)
  const skipped = []
  for (const [sourceName, value] of Object.entries(plain(config?.mcpServers) ? config.mcpServers : {})) {
    if (!plain(value)) { skipped.push({ sourceName, reason: 'not a server entry' }); continue }
    const type = value.transport ?? value.type
    if (type && !['stdio', 'http', 'streamable-http'].includes(type)) { skipped.push({ sourceName, reason: 'unsupported transport' }); continue }
    if (JSON.stringify(value).includes('${')) { skipped.push({ sourceName, reason: 'uses ${...} placeholders; add it by hand with real values' }); continue }
    const base = sourceName.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'server'
    let name = base
    for (let index = 2; Object.hasOwn(servers, name); index++) name = `${base.slice(0, 32 - String(index).length - 1)}-${index}`
    servers[name] = Object.fromEntries(MCP_FIELDS.filter(field => value[field] !== undefined).map(field => [field, value[field]]))
    if (name !== sourceName) renamed[name] = sourceName
  }
  return { servers, renamed, skipped }
}

// Jan's shipped default assistant prompt. One bullet in it, asking the model to
// "articulate your complete thought process", makes Claude Sonnet and Opus
// refuse every request as reasoning extraction. A prompt still equal to the
// default (with or without the identity line Jan's own migration strips) gets
// that bullet reworded; a prompt the user edited arrives as written.
const JAN_REFUSED_BULLET = '   - Before engaging any tools, articulate your complete thought process in natural language. You must act as a "professional tool caller," demonstrating rigorous logic.'
const JAN_TOOL_BULLET = '   - Before calling a tool, briefly say what you are about to do and why.'
const JAN_DEFAULT_INSTRUCTIONS = `You must output your response in the exact language used in the latest user message. Do not provide translations or switch languages unless explicitly instructed to do so. If the input is mostly English, respond in English.

When handling user queries:

1. Think step by step about the query:
   - Break complex questions into smaller, searchable parts
   - Identify key search terms and parameters
   - Consider what information is needed to provide a complete answer

2. Mandatory logical analysis:
${JAN_REFUSED_BULLET}
   - Analyze the information gap: explicitly state what data is missing.
   - Derive the strategy: explain why a specific tool is the logical next step.
   - Justify parameters: explain why you chose those specific search keywords or that specific URL.

You have tools to search for and access real-time, up-to-date data. Use them. Search before stating that you can't or don't know.

Current date: {{current_date}}`
const JAN_IDENTITY_LINE = 'You are Jan, a helpful AI assistant who assists users with their requests. Jan is trained by Menlo Research (https://www.menlo.ai).'
const JAN_DEFAULTS = new Set([JAN_DEFAULT_INSTRUCTIONS, `${JAN_IDENTITY_LINE}\n\n${JAN_DEFAULT_INSTRUCTIONS}`])
const importedInstructions = text => JAN_DEFAULTS.has(text) ? text.replace(JAN_REFUSED_BULLET, JAN_TOOL_BULLET) : text

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
    instructions: typeof item.instructions === 'string' ? importedInstructions(item.instructions) : '',
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
 * Read Jan's MCP server settings, including credentials, for use on the Host.
 * @param {string} folder - Jan's data folder.
 * @returns {Promise<ReturnType<typeof janMcpServers>>}
 */
export async function readJanMcpServers(folder) {
  let config
  try { config = await readJson(join(folder, 'mcp_config.json')) }
  catch { throw new Error('Could not read Jan’s MCP configuration. Check mcp_config.json and try again.') }
  return janMcpServers(config)
}

/**
 * The providers and assistants in Jan's data folder, without credential values.
 * @param {string} folder - Jan's data folder.
 * @param {string[]} keyNames - provider ids Jan holds a key for.
 * @returns {Promise<{ providers: object[], assistants: object[] }>}
 */
export async function readJanSettings(folder, keyNames) {
  const providers = janProviders(await readJson(join(folder, 'settings.json')) ?? {}, keyNames)
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
  return { providers, assistants: janAssistants(assistants) }
}
