/**
 * Copy this computer's model providers, their keys and its default model to a Jan that Hosts
 * started over SSH. The two sides talk through the SSH tunnel only: this side signs in to the
 * other Jan with the tunnel's token and calls that Jan's own `/jan-api/hosts`, so a key never
 * leaves the encrypted session. The other side adds what it lacks and never replaces a provider,
 * key or default model it already has.
 */

/** Settings namespace (profile entry id) holding the model provider routes. */
export const PROVIDERS_NS = 'llm-pi-ai'
/** Settings namespace holding the model new chats start with. */
export const DEFAULT_MODEL_NS = 'agent-default-model'

const CALL_MS = 15_000

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasExpression(value) {
  if (Array.isArray(value)) return value.some(hasExpression)
  if (!isRecord(value)) return false
  return typeof value.__jsExpr === 'string' || Object.values(value).some(hasExpression)
}

function section(settings, ns) {
  return settings.describe().find(descriptor => descriptor.ns === ns)
}

function providersOf(descriptor) {
  const providers = descriptor?.value?.providers
  return isRecord(providers) ? providers : {}
}

function userSet(descriptor) {
  return isRecord(descriptor?.user) && Object.keys(descriptor.user).length > 0
}

function userProviders(descriptor) {
  const providers = descriptor?.user?.providers
  return isRecord(providers) ? Object.keys(providers) : []
}

/**
 * What a Jan has for each provider route, without any key value: answered by the other computer.
 * A Jan is untouched while nobody added a provider or picked a default model there; the bundle's
 * own routes do not count.
 * @param {{ settings: object, credentials: object }} ctx - the Host context's settings and credentials.
 * @returns {Promise<{ untouched: boolean, routes: Record<string, { key: boolean | null }> }>}
 * each route and whether its key is configured (`null` when the route names no key).
 */
export async function setupState({ settings, credentials }) {
  const providers = section(settings, PROVIDERS_NS)
  const routes = {}
  for (const [route, profile] of Object.entries(providersOf(providers))) {
    const ref = profile?.apiKeyEnv
    routes[route] = { key: typeof ref === 'string' ? (await credentials.describe(ref)).configured : null }
  }
  return { untouched: userProviders(providers).length === 0 && !userSet(section(settings, DEFAULT_MODEL_NS)), routes }
}

/**
 * The routes this computer can give the other one. A route whose endpoint comes from a variable
 * (`baseURLEnv`, such as the local llama.cpp worker) is left out, because that address belongs to
 * this computer. Each item says whether the route itself or only its key is missing there.
 * @param {{ settings: object, credentials: object }} ctx - this Host's settings and credentials.
 * @param {{ routes: Record<string, { key: boolean | null }> }} remote - the other Jan's {@link setupState}.
 * @returns {Promise<Array<{ route: string, name: string, profile: boolean, key: boolean }>>} what a copy would add, in settings order.
 */
export async function copyable({ settings, credentials }, remote) {
  const items = []
  for (const [route, profile] of Object.entries(providersOf(section(settings, PROVIDERS_NS)))) {
    if (!isRecord(profile) || typeof profile.baseURLEnv === 'string') continue
    const ref = typeof profile.apiKeyEnv === 'string' ? profile.apiKeyEnv : undefined
    const haveKey = ref !== undefined && (await credentials.describe(ref)).configured
    const there = remote.routes[route]
    const item = { route, name: typeof profile.displayName === 'string' ? profile.displayName : route, profile: there === undefined, key: haveKey && there?.key !== true }
    // A route with a key it lacks here gives the other Jan nothing it could use.
    if (ref !== undefined && !haveKey) continue
    if (item.profile || item.key) items.push(item)
  }
  return items
}

/**
 * Collect the chosen routes, their keys and this computer's default model for the other Jan.
 * Key values are read here, at send time, and go only into the request to that Jan.
 * @param {{ settings: object, credentials: object }} ctx - this Host's settings and credentials.
 * @param {Array<{ route: string, profile: boolean, key: boolean }>} items - the chosen {@link copyable} items.
 * @returns {Promise<{ providers: Record<string, object>, keys: Record<string, string>, defaultModel?: { provider: string, model: string } }>} the request body.
 */
export async function setupPayload({ settings, credentials }, items) {
  const descriptor = section(settings, PROVIDERS_NS)
  const profiles = providersOf(descriptor)
  const saved = isRecord(descriptor?.user?.providers) ? descriptor.user.providers : {}
  const providers = {}
  const keys = {}
  for (const item of items) {
    const profile = profiles[item.route]
    if (!isRecord(profile)) continue
    // The saved route is what a person wrote; the live one adds every default. A `!!js` field
    // only evaluates on this computer, so such a route goes as this computer resolved it.
    const written = saved[item.route]
    if (item.profile) providers[item.route] = isRecord(written) && !hasExpression(written) ? written : profile
    if (item.key && typeof profile.apiKeyEnv === 'string') {
      const resolved = await credentials.resolve(profile.apiKeyEnv)
      if (resolved !== undefined) keys[profile.apiKeyEnv] = resolved.value
    }
  }
  const selected = section(settings, DEFAULT_MODEL_NS)?.value
  const sent = new Set(items.map(item => item.route))
  const defaultModel = isRecord(selected) && typeof selected.provider === 'string' && typeof selected.model === 'string' && sent.has(selected.provider)
    ? { provider: selected.provider, model: selected.model }
    : undefined
  return { providers, keys, ...(defaultModel === undefined ? {} : { defaultModel }) }
}

/**
 * Add what the request carries and this Jan lacks: answered by the other computer. A provider
 * route with the same name, a key that already resolves (stored or from the environment) and a
 * default model someone picked all stay as they are.
 * @param {{ settings: object, credentials: object }} ctx - the receiving Host's settings and credentials.
 * @param {unknown} request - the {@link setupPayload} body.
 * @returns {Promise<{ added: string[], kept: string[], keys: string[], defaultModel: boolean }>} the
 * routes added and kept, the key names stored, and whether the default model was set.
 */
export async function receiveSetup({ settings, credentials }, request) {
  if (!isRecord(request) || !isRecord(request.providers) || !isRecord(request.keys)) throw new Error('Expected providers and keys.')
  const present = providersOf(section(settings, PROVIDERS_NS))
  const added = {}
  const kept = []
  for (const [route, profile] of Object.entries(request.providers)) {
    if (!isRecord(profile)) throw new Error(`Provider ${route} is not a provider profile.`)
    if (Object.hasOwn(present, route)) kept.push(route)
    else added[route] = profile
  }
  if (Object.keys(added).length > 0) await settings.update(PROVIDERS_NS, { providers: added })
  const keys = []
  for (const [ref, value] of Object.entries(request.keys)) {
    if (typeof value !== 'string' || value === '') throw new Error(`The key ${ref} is empty.`)
    if ((await credentials.describe(ref)).configured) continue
    await credentials.set(ref, value)
    keys.push(ref)
  }
  const choice = request.defaultModel
  const routes = providersOf(section(settings, PROVIDERS_NS))
  const setDefault = isRecord(choice) && typeof choice.provider === 'string' && typeof choice.model === 'string'
    && Object.hasOwn(routes, choice.provider) && !userSet(section(settings, DEFAULT_MODEL_NS))
  if (setDefault) await settings.update(DEFAULT_MODEL_NS, { provider: choice.provider, model: choice.model })
  return { added: Object.keys(added), kept, keys, defaultModel: setDefault }
}

/**
 * Call one Hosts operation on the Jan behind an SSH tunnel, signing in with its token first.
 * @param {{ root: string, token: string }} tunnel - the forwarded Host from `openTunnel`.
 * @param {string} method - the `/jan-api/hosts` operation.
 * @param {object} [params] - its parameters.
 * @returns {Promise<unknown>} the operation's result.
 */
export async function callRemote(tunnel, method, params = {}) {
  const connect = new URL('connect', tunnel.root)
  connect.searchParams.set('token', tunnel.token)
  connect.searchParams.set('interactions', 'none')
  const login = await fetch(connect, { redirect: 'manual', signal: AbortSignal.timeout(CALL_MS) })
  const cookie = login.headers.get('set-cookie')?.split(';')[0]
  if (login.status !== 302 || cookie === undefined) throw new Error(`That computer refused the sign-in (HTTP ${login.status}). Disconnect and connect again.`)
  const response = await fetch(new URL('jan-api/hosts', tunnel.root), {
    method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ method, params }), signal: AbortSignal.timeout(CALL_MS),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok || body.error) throw new Error(body.error ?? `That computer answered HTTP ${response.status}.`)
  return body.result
}
