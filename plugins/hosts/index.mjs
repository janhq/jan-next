/**
 * Jan Hosts: other machines' Jan, and devices that reach this one. The Host half keeps the
 * saved list, tests and tunnels to other Hosts, and runs the device gateway; the page and the
 * QR code live in `client.js`.
 */
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { isIP } from 'node:net'
import schema from '@janhq/schemastery'
import { renderSVG } from 'uqr'
import { registerApi } from '@janhq/jan-plugin-api'
import { hashToken, HostsError, HostsStore, normalizeDeviceName } from './store.mjs'
import { openTunnel, testHost } from './remote.mjs'
import { installRemote, probeRemote, runtimeIdentity, shippedRuntimes, sshArgs, startCommand } from './remote-install.mjs'
import { startRelay } from './relay.mjs'
import { deviceAddressKind, lanAddresses, startGateway } from './gateway.mjs'
import { sshConfigHosts } from './ssh-config.mjs'
import { callRemote, receiveSetup, setupState } from './setup-copy.mjs'
import { createHostLink } from './link.mjs'
import { createFederation } from './federation.mjs'
import { customizationState } from './customization-copy.mjs'
import { resolveAgentsHome } from '@janhq/jan-home-paths'
import { applySync, createSyncReview, syncFingerprints, syncInventory, syncKey, syncPayload, verifySyncPeer } from './setup-sync.mjs'

export const name = 'jan-hosts'
export const inject = ['janHomePath', 'webServer', 'connection', 'credentials', 'settings', 'typertGateway']

export const Config = schema.object({
  // Volatile so the page's switch takes effect without reloading the plugin.
  gatewayEnabled: schema.boolean().default(false).volatile()
    .description('Let paired phones and other devices reach this Jan over the local network.'),
  gatewayAllowInsecureLan: schema.boolean().default(false).volatile()
    .description('Allow HTTP on a private LAN. Anyone who can observe that traffic can capture device sign-ins and activity.'),
  gatewayHost: schema.string().default('').description('Single bind IP. Empty picks a private LAN or tailnet address, preferring tailnet for HTTP without LAN opt-in.'),
  gatewayPort: schema.natural().max(65535).default(0).description('Port the device gateway listens on. 0 picks a free port.'),
  gatewayTlsCertFile: schema.string().default('').description('PEM certificate chain clients trust for the device gateway address.'),
  gatewayTlsKeyFile: schema.string().default('').description('Unencrypted PEM private key for the device gateway certificate.'),
  // Empty reads JAN_HOST_RUNTIME_DIR at Connect, so a profile patch that rewrites this row's
  // config (the device-access switch does) still finds the archives the launcher staged.
  runtimeDirectory: schema.string().default('')
    .description('Directory holding the jan-host-runtime archives Connect copies to other computers. Empty uses JAN_HOST_RUNTIME_DIR; neither means this Jan ships none.'),
  relay: schema.boolean().default(true)
    .description('Let a Jan started over SSH reach its model providers through this computer, so the other computer needs no internet.'),
})

const TOKEN_SCOPE = 'jan-hosts'

function tokenKey(id) {
  // Credential key segments are lowercase words; a UUID qualifies once its letters are.
  return `${TOKEN_SCOPE}/host-${id.toLowerCase()}`
}

function sameDestination(a, b) {
  return a !== undefined && b !== undefined && a.kind === b.kind && (a.kind === 'url' ? a.url === b.url : a.ssh === b.ssh)
}

/** Sign in to this Host's own loopback listener once, for the gateway's upstream requests. */
async function ownerCookieFor(ctx) {
  const origin = ctx.webServer.getOrigin()
  const response = await fetch(ctx.connection.authenticatedUrl(`${origin}/`), { redirect: 'manual' })
  const cookie = response.headers.get('set-cookie')?.split(';')[0]
  if (cookie === undefined) throw new Error(`jan-hosts: this Host refused its own login (HTTP ${response.status})`)
  return cookie
}

/**
 * @param {import('@janhq/cordis').Context} ctx - Host context.
 * @param {{ gateway: { enabled: boolean, host: string, port: number } }} config - plugin config.
 */
export function apply(ctx, config) {
  const store = new HostsStore(join(ctx.janHomePath(), 'hosts'))
  const tunnels = new Map()
  const urlLinks = new Map()
  const syncReviews = createSyncReview()
  // What a running Connect is doing, per Host id; cleared when it ends either way.
  const progress = new Map()
  const connecting = new Map()
  let connectionWrites = Promise.resolve()
  let gateway
  let gatewayError
  let hashes = new Map()
  const federation = createFederation(ctx)
  ctx.provide('janHosts', { peers, callPlugin })
  // A Gateway from before federation has no forwarder: Hosts still answers copies and folder
  // browsing there, and only another computer's projects stay out of that Jan's own window.
  if (typeof ctx.typertGateway.registerForwarder === 'function') {
    ctx.effect(() => ctx.typertGateway.registerForwarder(federation.forwarder), 'jan-hosts: federation forwarder')
  } else ctx.logger.warn('jan-hosts: this Jan\'s gateway cannot forward calls; other computers\' projects will not show in its window')
  // Composer uploads travel on their own HTTP route; one for another computer's chat goes there.
  ctx.effect(() => ctx.on('connection/request', async (request, response, next) => {
    if (!await federation.upload(request, response)) await next()
  }), 'jan-hosts: federated uploads')

  // The saved destination and its credential live in different stores. Order edits and link lookups together.
  function withConnections(run) {
    const result = connectionWrites.then(run)
    connectionWrites = result.catch(() => undefined)
    return result
  }

  /** @returns {Promise<{ id: string, name: string, kind: 'ssh' | 'url', state: 'connected' | 'offline' }[]>} saved peers without credentials. */
  async function peers() {
    return Promise.all((await store.connections()).map(async (entry) => {
      const { id, name, kind } = entry
      const connected = kind === 'ssh' ? federation.linkOf(id) !== undefined : (await token(entry)) !== undefined
      return { id, name, kind, state: connected ? 'connected' : 'offline' }
    }))
  }

  /**
   * Call a plugin's JSON route without exposing the peer's login to the caller.
   * @param {string} id - saved peer id.
   * @param {string} feature - plugin route name.
   * @param {string} method - operation name on that route.
   * @param {object} params - operation arguments.
   * @param {AbortSignal} [signal] - cancels the request.
   * @returns {Promise<unknown>} the remote operation's result.
   */
  async function callPlugin(id, feature, method, params, signal) {
    const link = await withConnections(async () => {
      const entry = (await store.connections()).find(item => item.id === id)
      if (entry?.kind === 'ssh') return federation.linkOf(id)
      if (entry?.kind !== 'url') return undefined
      const value = await token(entry)
      if (value === undefined) return undefined
      const cached = urlLinks.get(id)
      if (cached?.url === entry.url && cached.token === value) return cached.link
      const link = createHostLink({ root: entry.url, token: value })
      urlLinks.set(id, { url: entry.url, token: value, link })
      return link
    })
    if (link === undefined) throw new HostsError('not-connected', 'That computer is not connected. Connect it in Settings, Hosts.')

    let body
    try {
      body = await link.post(`jan-api/${feature}`, { method, params }, signal)
    } catch (error) {
      // A 4xx with the operation's message is the peer refusing the request; a
      // 5xx is a temporary failure on the peer that a caller may retry.
      const message = error?.cause?.body?.error
      if (typeof message !== 'string') throw error
      const status = error.cause.status
      throw status >= 400 && status < 500 ? new HostsError('rejected', message, { cause: error }) : new Error(message, { cause: error })
    }
    if (typeof body.error === 'string') throw new HostsError('rejected', body.error)
    return body.result
  }

  /** This computer's side of a customization copy: its settings, skill folders and plugin manager. */
  function customizationSource() {
    return {
      settings: ctx.settings,
      skillRoots: [join(ctx.janHomePath(), 'skills'), join(resolveAgentsHome(), 'skills')],
      pluginManager: ctx.get('pluginManager'),
    }
  }

  function providerSource() {
    return { settings: ctx.settings, credentials: ctx.credentials, llm: ctx.get('llm') }
  }

  /** Link a connected SSH Host's Jan into this window's sidebar and chats. */
  async function linkHost(entry, tunnel) {
    const link = createHostLink({ root: tunnel.root, token: tunnel.token })
    try {
      await link.open()
    } catch (error) {
      link.close()
      ctx.logger.warn('jan-hosts: %s is connected but its projects cannot be listed here: %s', entry.name, error.message)
      return
    }
    // The saved destination may have changed while the remote carrier opened.
    if (tunnels.get(entry.id) !== tunnel) { link.close(); return }
    federation.attach(entry.id, entry.name, link)
  }

  async function token(entry) {
    const record = await ctx.credentials.readRecord(tokenKey(entry.id))
    return record?.kind === 'grant' && record.payload?.url === entry.url ? record.payload?.token : undefined
  }

  async function saveToken(entry, value) {
    await ctx.credentials.modifyRecord(tokenKey(entry.id), () => Promise.resolve({ kind: 'grant', payload: { url: entry.url, token: value } }))
    if (urlLinks.get(entry.id)?.token !== value) urlLinks.delete(entry.id)
  }

  function dropTunnel(id, forget = false) {
    tunnels.get(id)?.close()
    tunnels.delete(id)
    urlLinks.delete(id)
    syncReviews.clear(id)
    federation.detach(id, forget)
  }

  function tunnelFor(entry) {
    const tunnel = tunnels.get(entry.id)
    return tunnel?.destination === entry.ssh ? tunnel : undefined
  }

  async function reloadDevices() {
    hashes = await store.deviceHashes()
  }

  function gatewayTransport() {
    return config.gatewayTlsCertFile || config.gatewayTlsKeyFile ? 'https' : 'http'
  }

  function gatewayHost(allowInsecureLan, addresses = lanAddresses()) {
    if (config.gatewayHost) return config.gatewayHost
    if (gatewayTransport() === 'http' && !allowInsecureLan) {
      const tailnet = addresses.find(item => deviceAddressKind(item.address) === 'tailnet')
      if (tailnet !== undefined) return tailnet.address
    }
    return addresses[0]?.address
  }

  async function startDeviceGateway(enabled) {
    if (gateway !== undefined) { await gateway.close(); gateway = undefined }
    gatewayError = undefined
    if (!enabled) return
    const allowInsecureLan = config.gatewayAllowInsecureLan.get()
    const host = gatewayHost(allowInsecureLan)
    if (host === undefined) { gatewayError = 'This computer has no private network or tailnet address a phone could reach.'; return }
    try {
      if (isIP(host) === 0 || host === '0.0.0.0' || host === '::') throw new Error('Choose the IP address of a single network interface.')
      let tls
      if (gatewayTransport() === 'https') {
        if (!config.gatewayTlsCertFile || !config.gatewayTlsKeyFile) throw new Error('Configure both gatewayTlsCertFile and gatewayTlsKeyFile to use HTTPS.')
        const [cert, key] = await Promise.all([readFile(config.gatewayTlsCertFile), readFile(config.gatewayTlsKeyFile)])
        tls = { cert, key }
      }
      await reloadDevices()
      gateway = await startGateway({
        host, port: config.gatewayPort, tls, allowInsecureLan, upstream: ctx.webServer.getOrigin(),
        ownerCookie: () => ownerCookieFor(ctx), hashes: () => hashes,
        seen: (id) => { void store.touchDevice(id).catch(error => ctx.logger.warn('jan-hosts: %s', String(error))) },
        pair: async (label) => {
          const paired = await store.pairDevice(label)
          hashes.set(hashToken(paired.token), paired.device.id)
          return paired
        },
      })
      if (!gateway.secure && deviceAddressKind(host) === 'lan') ctx.logger.warn('jan-hosts: opted into unencrypted LAN device access. Anyone who can observe traffic can capture sign-in credentials and activity.')
      // Printed beside the `jan web:` line so a board without a screen can pair its first phone.
      const setup = hashes.size === 0 ? gateway.setupUrl() : undefined
      if (setup !== undefined) ctx.logger.info('jan hosts: pair a device at %s', setup)
    } catch (error) {
      gatewayError = error?.code === 'EADDRINUSE'
        ? `Port ${config.gatewayPort} is already in use on ${host}.`
        : `The device gateway could not start: ${error.message}`
    }
  }

  const entry = ctx.fiber.entry
  let disposed = false
  let gatewayStart = Promise.resolve()
  let initialized = false

  // Serialized so a quick off-on cannot leave two listeners racing for one port.
  function restartGateway() {
    gatewayStart = gatewayStart.then(() => {
      if (!disposed) return startDeviceGateway(config.gatewayEnabled.get())
    })
    return gatewayStart
  }
  ctx.effect(() => ctx.on('loader/volatile-update', () => {
    if (initialized) void restartGateway()
  }), 'jan-hosts: gateway switch')

  const gatewayReady = Promise.resolve().then(() => {
    if (disposed) return
    initialized = true
    return restartGateway()
  })
  ctx.effect(() => {
    void gatewayReady
    return async () => {
      disposed = true
      urlLinks.clear()
      await gatewayStart
      await gateway?.close()
      for (const tunnel of tunnels.values()) tunnel.close()
      const running = relay
      relay = undefined
      await (await running?.catch(() => undefined))?.close()
    }
  }, 'jan-hosts: device gateway and tunnels')

  function publicError(error) {
    if (error instanceof HostsError) return error
    throw error
  }

  async function connectionView(entry) {
    const tunnel = tunnelFor(entry)
    return {
      ...entry, signedIn: entry.kind === 'url' ? (await token(entry)) !== undefined : tunnel !== undefined,
      tunnel: tunnel === undefined ? undefined : { root: tunnel.root, log: tunnel.log },
      linkState: tunnel === undefined ? undefined : federation.linkState(entry.id),
      progress: progress.get(entry.id),
    }
  }

  /**
   * Name where each SSH alias points (`user@host:port` from the ssh config), so a row that shows
   * the alias as its name says something new on its second line. A config that cannot be read
   * leaves the rows as they are.
   */
  async function withSshAddresses(connections) {
    if (!connections.some(item => item.kind === 'ssh')) return connections
    let hosts
    try {
      hosts = new Map((await sshConfigHosts()).map(host => [host.alias.toLowerCase(), host]))
    } catch {
      // An unreadable ssh config only costs the address line; Connect reports its own error.
      return connections
    }
    return connections.map((item) => {
      const host = item.kind === 'ssh' ? hosts.get(item.ssh.toLowerCase()) : undefined
      if (host?.hostName === undefined) return item
      return { ...item, address: `${host.user === undefined ? '' : `${host.user}@`}${host.hostName}${host.port === undefined ? '' : `:${host.port}`}` }
    })
  }

  // Read per Connect so a misnamed archive fails that Connect with its reason, not the plugin.
  function runtimes() {
    return shippedRuntimes(config.runtimeDirectory || process.env.JAN_HOST_RUNTIME_DIR)
  }

  // One relay serves every SSH Host; started on the first Connect that needs it.
  let relay
  async function startedRelay() {
    if (!config.relay) return undefined
    relay ??= startRelay()
    try {
      return await relay
    } catch (error) {
      relay = undefined
      throw new Error(`The model connection for that computer could not start here: ${error.message}`)
    }
  }

  /**
   * Probe, install when that computer lacks this build, then start it and forward its page here.
   * Each step is published in `progress` so the page can say what is happening during a long copy.
   */
  async function connectSsh(entry, log) {
    const step = (value) => { progress.set(entry.id, value) }
    const ssh = sshArgs(entry.ssh)
    step({ step: 'checking' })
    const shipped = runtimes()
    const { target, installed } = await probeRemote(ssh, [...shipped.keys()])
    const runtime = shipped.get(target)
    if (installed !== runtimeIdentity(runtime)) {
      step({ step: 'copying', sent: 0, total: 0 })
      await installRemote({ ssh, runtime, onProgress: (sent, total) => step({ step: 'copying', sent, total }) })
    }
    step({ step: 'starting' })
    const proxy = await startedRelay()
    const syncAccess = syncKey()
    return openTunnel({
      ssh, relayPort: proxy?.port, log,
      command: ports => startCommand({ port: ports.web, proxy: proxy?.proxyUrl(ports.relay), name: entry.name, syncAccess }),
    }).then(tunnel => ({ ...tunnel, syncAccess }))
  }

  /** The URL that opens the Host, with its login token so the window signs in on its own. */
  async function openUrl(entry) {
    if (entry.kind === 'ssh') {
      const tunnel = tunnelFor(entry)
      if (tunnel === undefined) throw new HostsError('not-connected', 'Connect first.')
      return `${tunnel.root}?token=${tunnel.token}`
    }
    const value = await token(entry)
    return value === undefined ? entry.url : `${entry.url}?token=${value}`
  }

  async function find(id) {
    const entry = (await store.connections()).find(item => item.id === id)
    if (entry === undefined) throw new HostsError('missing', 'That Host was removed.')
    return entry
  }

  ctx.effect(() => registerApi(ctx, 'hosts', {
    async state() {
      await gatewayReady
      await gatewayStart
      const allowInsecureLan = config.gatewayAllowInsecureLan.get()
      const secure = gateway?.secure ?? gatewayTransport() === 'https'
      const addresses = lanAddresses()
      const lanAvailable = deviceAddressKind(gatewayHost(true, addresses)) === 'lan'
      const connections = await Promise.all((await store.connections()).map(connectionView))
      return {
        connections: await withSshAddresses(connections),
        devices: await store.devices(),
        gateway: {
          running: gateway !== undefined, enabled: config.gatewayEnabled.get(), secure, allowInsecureLan, lanAvailable,
          url: gateway?.url, error: gatewayError, addresses,
        },
      }
    },
    async save(params) {
      try {
        return await withConnections(async () => {
          const { connection, token: pasted, previous } = await store.saveConnection(params)
          if (previous !== undefined && !sameDestination(previous, connection)) {
            dropTunnel(connection.id, true)
            if (pasted === undefined) await ctx.credentials.deleteRecord(tokenKey(connection.id))
          }
          if (pasted !== undefined) await saveToken(connection, pasted)
          return connectionView(connection)
        })
      } catch (error) { throw publicError(error) }
    },
    async sshConfig() {
      const saved = new Set((await store.connections()).filter(item => item.kind === 'ssh').map(item => item.ssh.toLowerCase()))
      return { hosts: (await sshConfigHosts()).map(host => ({ ...host, saved: saved.has(host.alias.toLowerCase()) })) }
    },
    async importSsh({ aliases }) {
      if (!Array.isArray(aliases) || aliases.length === 0) throw new HostsError('aliases', 'Choose at least one Host to import.')
      const known = new Map((await sshConfigHosts()).map(host => [host.alias.toLowerCase(), host]))
      const imported = []
      const failed = []
      for (const alias of aliases) {
        const host = known.get(String(alias).toLowerCase())
        if (host === undefined) { failed.push({ alias, message: 'It is no longer in your ssh config.' }); continue }
        try {
          // The alias, not its HostName, so ssh keeps applying the config's keys, ports and proxies.
          imported.push(await connectionView((await store.saveConnection({ name: host.alias, kind: 'ssh', ssh: host.alias })).connection))
        } catch (error) { failed.push({ alias: host.alias, message: publicError(error).message }) }
      }
      return { imported, failed }
    },
    async remove({ id }) {
      return withConnections(async () => {
        dropTunnel(id, true)
        await store.removeConnection(id)
        await ctx.credentials.deleteRecord(tokenKey(id))
        ctx.emit('jan-hosts/removed', id)
        return null
      })
    },
    async test({ id }) {
      const entry = await find(id)
      if (entry.kind === 'ssh') {
        const tunnel = tunnelFor(entry)
        if (tunnel === undefined) return { http: 'skipped', websocket: 'skipped', message: 'Connect first; SSH Hosts start when you connect.' }
        return testHost(tunnel.root, tunnel.token)
      }
      return testHost(entry.url, await token(entry))
    },
    async connect({ id }) {
      const entry = await find(id)
      if (entry.kind !== 'ssh') throw new HostsError('kind', 'Only SSH Hosts connect; Address Hosts open directly.')
      if (tunnelFor(entry) !== undefined) return connectionView(entry)
      // A second press, or a second window, joins the Connect already running.
      if (!connecting.has(id)) {
        const log = []
        connecting.set(id, connectSsh(entry, line => { log.push(line); if (log.length > 20) log.shift() }).then(async (tunnel) => {
          const current = await find(id).catch(error => { tunnel.close(); throw error })
          if (!sameDestination(entry, current)) {
            tunnel.close()
            throw new HostsError('ssh', 'This Host changed while it was connecting. Connect again.')
          }
          const record = { ...tunnel, log, destination: entry.ssh }
          tunnels.set(id, record)
          void tunnel.exited.then(() => {
            if (tunnels.get(id) !== record) return
            tunnels.delete(id)
            syncReviews.clear(id)
            federation.detach(id)
          })
          return linkHost(current, record)
        }).finally(() => { connecting.delete(id); progress.delete(id) }))
      }
      try {
        await connecting.get(id)
        return connectionView(await find(id))
      } catch (error) {
        throw new HostsError('ssh', error.message)
      }
    },
    async disconnect({ id }) {
      dropTunnel(id)
      return null
    },
    // The folder chooser for a project on another computer lists that computer's folders.
    async browse({ id, path }) {
      return federation.call(id, 'directoryPicker/list', path === undefined ? {} : { path })
    },
    async makeFolder({ id, path, name }) {
      return { path: await federation.call(id, 'directoryPicker/createDirectory', { path, name }) }
    },
    async open({ id }) {
      return { url: await openUrl(await find(id)) }
    },
    async syncPreview({ id }) {
      const tunnel = tunnels.get(id)
      if (!tunnel) throw new HostsError('not-connected', 'Connect first.')
      const key = syncKey()
      const local = await syncInventory({ ...customizationSource(), ...providerSource() }, key)
      const remote = await callRemote(tunnel, 'syncInventory', { key, access: tunnel.syncAccess, refs: local.filter(item => item.kind === 'keys').map(item => item.id) })
      if (tunnels.get(id) !== tunnel) throw new HostsError('not-connected', 'Reconnect and review the setup again.')
      return syncReviews.preview(id, tunnel, key, local, remote)
    },
    async syncApply({ id, token, choices }) {
      const tunnel = tunnels.get(id)
      if (!tunnel) throw new HostsError('not-connected', 'Connect first.')
      const { key, items } = syncReviews.take(id, tunnel, token, choices)
      const outcomes = []
      for (const item of items) {
        if (tunnels.get(id) !== tunnel) break
        let payload
        try {
          const [current] = await syncInventory({ ...customizationSource(), ...providerSource() }, key, item)
          if (current?.digest !== item.digest || current.problem) {
            outcomes.push({ kind: item.kind, id: item.id, status: 'stale' })
            continue
          }
          payload = syncPayload(key, { ...current, expected: item.expected })
        } catch (error) {
          outcomes.push({ kind: item.kind, id: item.id, status: error?.code === 'sync-stale' ? 'stale' : 'failed' })
          continue
        }
        if (tunnels.get(id) !== tunnel) break
        try {
          outcomes.push(await callRemote(tunnel, 'syncReceive', { key, access: tunnel.syncAccess, item: payload }, 120_000))
        } catch (error) {
          outcomes.push({ kind: item.kind, id: item.id, status: 'unknown' })
          break
        }
      }
      return outcomes
    },
    async syncInventory({ access, key, refs }) {
      verifySyncPeer(process.env.JAN_HOST_SYNC_ACCESS, access)
      return syncFingerprints(await syncInventory({ ...customizationSource(), ...providerSource(), receiving: true, refs }, key))
    },
    async syncReceive({ access, key, item }) {
      verifySyncPeer(process.env.JAN_HOST_SYNC_ACCESS, access)
      const [result] = await applySync({ ...customizationSource(), ...providerSource(), receiving: true }, [item], key)
      return result
    },
    // Answered on the other computer, for the Jan that started it over SSH.
    async setupState() {
      return setupState(providerSource())
    },
    async receiveSetup(params) {
      return receiveSetup(providerSource(), params)
    },
    // Answered on the other computer: which MCP servers, skills and plugin bundles it already has.
    async customizationState() {
      return customizationState({ settings: ctx.settings, janHome: ctx.janHomePath(), pluginManager: ctx.get('pluginManager') })
    },
    async enableGateway({ enabled }) {
      if (typeof enabled !== 'boolean') throw new HostsError('enabled', 'Choose on or off.')
      await gatewayReady
      // Record the default too, so a fresh device-access setting is never mistaken for legacy consent.
      await ctx.settings.update(entry.options.id, { gatewayEnabled: enabled, gatewayAllowInsecureLan: config.gatewayAllowInsecureLan.get() })
      await gatewayStart
      return null
    },
    async allowInsecureLan({ allowed }) {
      if (typeof allowed !== 'boolean') throw new HostsError('lan-access', 'Choose on or off.')
      await gatewayReady
      await ctx.settings.update(entry.options.id, { gatewayAllowInsecureLan: allowed })
      await gatewayStart
      return null
    },
    async pair({ name: label }) {
      if (gateway === undefined) throw new HostsError('gateway', 'Turn on device access first.')
      try {
        const device = { name: normalizeDeviceName(label) }
        const url = gateway.pairUrl(device.name)
        return { device, url, qr: renderSVG(url, { border: 2 }) }
      } catch (error) { throw publicError(error) }
    },
    async revoke({ id }) {
      await store.revokeDevice(id)
      for (const [hash, device] of hashes) if (device === id) hashes.delete(hash)
      gateway?.disconnect(id)
      return null
    },
  }), 'jan-hosts: /jan-api/hosts')
}
