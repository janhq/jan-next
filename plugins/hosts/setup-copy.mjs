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
const KEY_BINDING_VERSION = 1

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

function catalogEndpoints(llm) {
  return new Map((llm?.listConfigurableProviders() ?? [])
    .filter(item => item.settingsNs === PROVIDERS_NS)
    .map(item => [item.provider, item.defaultBaseURL]))
}

function keyBinding(profile, endpoint) {
  const ref = profile?.apiKeyEnv
  if (typeof ref !== 'string' || profile.baseURLEnv !== undefined) return undefined
  const url = URL.parse(profile.baseURL ?? endpoint ?? '')
  if (url === null || (url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) return undefined
  return { ref, endpoint: url.href }
}

function sameBinding(left, right) {
  return left !== undefined && right !== undefined && left.ref === right.ref && left.endpoint === right.endpoint
}

/** Return the fixed endpoint shared by every route that uses this credential reference. */
export function credentialEndpoint(providers, llm, ref) {
  const endpoints = catalogEndpoints(llm)
  let endpoint
  for (const [route, profile] of Object.entries(providers)) {
    if (profile?.apiKeyEnv !== ref) continue
    const binding = keyBinding(profile, endpoints.get(route))
    if (!binding || (endpoint !== undefined && endpoint !== binding.endpoint)) return undefined
    endpoint = binding.endpoint
  }
  return endpoint
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
 * @param {{ settings: object, credentials: object, llm?: object }} ctx - the Host's settings, credentials and model directory.
 * @returns {Promise<{ untouched: boolean, routes: Record<string, { key: boolean | null, binding?: { ref: string, endpoint: string } }> }>}
 * each route's key status and its binding, if it has a fixed endpoint.
 */
export async function setupState({ settings, credentials, llm }) {
  const providers = section(settings, PROVIDERS_NS)
  const endpoints = catalogEndpoints(llm)
  const routes = Object.create(null)
  for (const [route, profile] of Object.entries(providersOf(providers))) {
    const ref = profile?.apiKeyEnv
    const binding = keyBinding(profile, endpoints.get(route))
    routes[route] = { key: typeof ref === 'string' ? (await credentials.describe(ref)).configured : null, binding }
  }
  return { untouched: userProviders(providers).length === 0 && !userSet(section(settings, DEFAULT_MODEL_NS)), keyBindingVersion: KEY_BINDING_VERSION, routes }
}

/** @param {string} value - raw stored value. @returns {boolean} Whether the value requires a local vault. */
export function isPasswordManagerReference(value) {
  return value.startsWith('op://') || value.startsWith('bw://')
}

/** Resolve for transfer, never materializing or transmitting a password-manager value. */
async function portableCredential(credentials, ref) {
  const stored = await credentials.resolve(ref, { dereference: false })
  return stored === undefined || isPasswordManagerReference(stored.value) ? undefined : stored
}

/**
 * The routes this computer can give the other one. A route whose endpoint comes from a variable
 * (`baseURLEnv`, such as the local llama.cpp worker) is left out, because that address belongs to
 * this computer. Each item says whether the route itself or only its key is missing there.
 * @param {{ settings: object, credentials: object, llm?: object }} ctx - this Host's settings, credentials and model directory.
 * @param {Awaited<ReturnType<typeof setupState>>} remote - the other Jan's state.
 */
export async function copyable({ settings, credentials, llm }, remote) {
  const endpoints = catalogEndpoints(llm)
  const items = []
  for (const [route, profile] of Object.entries(providersOf(section(settings, PROVIDERS_NS)))) {
    if (!isRecord(profile) || profile.baseURLEnv !== undefined) continue
    const binding = keyBinding(profile, endpoints.get(route))
    const there = Object.hasOwn(remote.routes, route) ? remote.routes[route] : undefined
    const addProfile = there === undefined
    // Copy only fixed, known key destinations. An older Host does not report a key binding.
    const key = remote.keyBindingVersion === KEY_BINDING_VERSION && binding !== undefined
      && (addProfile || there.key === false && sameBinding(binding, there.binding))
      && (await portableCredential(credentials, binding.ref)) !== undefined
    const item = { route, name: typeof profile.displayName === 'string' ? profile.displayName : route, profile: addProfile, key, ...(key ? { binding } : {}) }
    if (typeof profile.apiKeyEnv === 'string' && !key) continue
    if (item.profile || item.key) items.push(item)
  }
  return items
}

/**
 * Collect the chosen routes, their keys and this computer's default model for the other Jan.
 * Key values are read here, at send time, and go only into the request to that Jan.
 * @param {{ settings: object, credentials: object, llm?: object }} ctx - this Host's settings, credentials and model directory.
 * @param {Awaited<ReturnType<typeof copyable>>} items - the chosen routes.
 */
export async function setupPayload({ settings, credentials, llm }, items) {
  const endpoints = catalogEndpoints(llm)
  const descriptor = section(settings, PROVIDERS_NS)
  const profiles = providersOf(descriptor)
  const saved = isRecord(descriptor?.user?.providers) ? descriptor.user.providers : {}
  const providers = Object.create(null)
  const keys = Object.create(null)
  const sent = new Set()
  for (const item of items) {
    const profile = Object.hasOwn(profiles, item.route) ? profiles[item.route] : undefined
    if (!isRecord(profile) || profile.baseURLEnv !== undefined) continue
    const binding = keyBinding(profile, endpoints.get(item.route))
    if (item.key) {
      if (!sameBinding(binding, item.binding)) continue
      const resolved = await portableCredential(credentials, binding.ref)
      if (resolved === undefined) continue
      keys[item.route] = { ...binding, value: resolved.value }
    }
    sent.add(item.route)
    // The saved route is what a person wrote; the live one adds every default. A `!!js` field
    // only evaluates on this computer, so such a route goes as this computer resolved it.
    const written = saved[item.route]
    if (item.profile) providers[item.route] = isRecord(written) && !hasExpression(written) ? written : profile
  }
  const selected = section(settings, DEFAULT_MODEL_NS)?.value
  const defaultModel = isRecord(selected) && typeof selected.provider === 'string' && typeof selected.model === 'string' && sent.has(selected.provider)
    ? { provider: selected.provider, model: selected.model }
    : undefined
  return { providers: { ...providers }, keys: { ...keys }, ...(defaultModel === undefined ? {} : { defaultModel }) }
}

/**
 * Add what the request carries and this Jan lacks: answered by the other computer. A provider
 * route with the same name, a key that already resolves (stored or from the environment) and a
 * default model someone picked all stay as they are.
 * @param {{ settings: object, credentials: object, llm?: object }} ctx - the receiving Host's settings, credentials and model directory.
 * @param {unknown} request - the {@link setupPayload} body.
 * @returns {Promise<{ added: string[], kept: string[], keys: string[], defaultModel: boolean }>} the
 * routes added and kept, the key names stored, and whether the default model was set.
 */
export async function receiveSetup({ settings, credentials, llm }, request) {
  if (!isRecord(request) || !isRecord(request.providers) || !isRecord(request.keys)) throw new Error('Expected providers and keys.')
  const requestedKeys = Object.entries(request.keys)
  for (const [route, key] of requestedKeys) {
    if (!isRecord(key) || typeof key.ref !== 'string' || typeof key.endpoint !== 'string' || typeof key.value !== 'string' || key.value === '') {
      throw new Error(`Expected a bound key for provider ${route}.`)
    }
  }
  const present = providersOf(section(settings, PROVIDERS_NS))
  const added = Object.create(null)
  const kept = []
  for (const [route, profile] of Object.entries(request.providers)) {
    if (!isRecord(profile)) throw new Error(`Provider ${route} is not a provider profile.`)
    if (Object.hasOwn(present, route)) kept.push(route)
    else added[route] = profile
  }
  if (Object.keys(added).length > 0) await settings.update(PROVIDERS_NS, { providers: added })
  const keys = []
  const endpoints = catalogEndpoints(llm)
  for (const [route, key] of requestedKeys) {
    const { ref, value } = key
    if (isPasswordManagerReference(value) || (await credentials.describe(ref)).configured) continue
    const routes = providersOf(section(settings, PROVIDERS_NS))
    if (!Object.hasOwn(routes, route) || !sameBinding(key, keyBinding(routes[route], endpoints.get(route)))) continue
    // Keys are looked up by reference, not by route. A second route using the same reference
    // must not get a key intended for another endpoint.
    if (Object.entries(routes).some(([id, profile]) => profile?.apiKeyEnv === ref && !sameBinding(key, keyBinding(profile, endpoints.get(id))))) continue
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
export async function callRemote(tunnel, method, params = {}, timeout = CALL_MS) {
  const connect = new URL('connect', tunnel.root)
  connect.searchParams.set('token', tunnel.token)
  connect.searchParams.set('interactions', 'none')
  const login = await fetch(connect, { redirect: 'manual', signal: AbortSignal.timeout(CALL_MS) })
  const cookie = login.headers.get('set-cookie')?.split(';')[0]
  if (login.status !== 302 || cookie === undefined) throw new Error(`That computer refused the sign-in (HTTP ${login.status}). Disconnect and connect again.`)
  const response = await fetch(new URL('jan-api/hosts', tunnel.root), {
    method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ method, params }), signal: AbortSignal.timeout(timeout),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok || body.error) throw new Error(body.error ?? `That computer answered HTTP ${response.status}.`)
  return body.result
}
