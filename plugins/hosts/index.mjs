/**
 * Jan Hosts: other machines' Jan, and devices that reach this one. The Host half keeps the
 * saved list, tests and tunnels to other Hosts, and runs the device gateway; the page and the
 * QR code live in `client.js`.
 */
import { join } from 'node:path'
import schema from '@janhq/schemastery'
import { renderSVG } from 'uqr'
import { registerApi } from '@janhq/jan-plugin-api'
import { HostsError, HostsStore } from './store.mjs'
import { openTunnel, testHost } from './remote.mjs'
import { installRemote, probeRemote, runtimeIdentity, shippedRuntimes, sshArgs, startCommand } from './remote-install.mjs'
import { startRelay } from './relay.mjs'
import { lanAddresses, startGateway } from './gateway.mjs'
import { sshConfigHosts } from './ssh-config.mjs'

export const name = 'jan-hosts'
export const inject = ['janHomePath', 'webServer', 'connection', 'credentials', 'settings']

export const Config = schema.object({
  // Volatile so the page's switch takes effect without reloading the plugin.
  gatewayEnabled: schema.boolean().default(false).volatile()
    .description('Let paired phones and other devices reach this Jan over the local network.'),
  gatewayHost: schema.string().default('').description('Address the device gateway listens on. Empty picks the first private network address.'),
  gatewayPort: schema.natural().max(65535).default(0).description('Port the device gateway listens on. 0 picks a free port.'),
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
  // What a running Connect is doing, per Host id; cleared when it ends either way.
  const progress = new Map()
  const connecting = new Map()
  let gateway
  let gatewayError
  let hashes = new Map()
  let gatewayStart

  async function token(id) {
    const record = await ctx.credentials.readRecord(tokenKey(id))
    return record?.kind === 'grant' ? record.payload?.token : undefined
  }

  async function saveToken(id, value) {
    await ctx.credentials.modifyRecord(tokenKey(id), () => Promise.resolve({ kind: 'grant', payload: { token: value } }))
  }

  async function reloadDevices() {
    hashes = await store.deviceHashes()
  }

  async function startDeviceGateway(enabled) {
    if (gateway !== undefined) { await gateway.close(); gateway = undefined }
    gatewayError = undefined
    if (!enabled) return
    const host = config.gatewayHost || lanAddresses()[0]?.address
    if (host === undefined) { gatewayError = 'This computer has no network address a phone could reach.'; return }
    try {
      await reloadDevices()
      gateway = await startGateway({
        host, port: config.gatewayPort, upstream: ctx.webServer.getOrigin(),
        ownerCookie: () => ownerCookieFor(ctx), hashes: () => hashes,
        seen: (id) => { void store.touchDevice(id).catch(error => ctx.logger.warn('jan-hosts: %s', String(error))) },
        pair: async (label) => { const paired = await store.pairDevice(label); await reloadDevices(); return paired },
      })
      // Printed beside the `jan web:` line so a board without a screen can pair its first phone.
      const setup = gateway.setupUrl()
      if (setup !== undefined) ctx.logger.info('jan hosts: pair a device at %s', setup)
    } catch (error) {
      gatewayError = error?.code === 'EADDRINUSE'
        ? `Port ${config.gatewayPort} is already in use on ${host}.`
        : `The device gateway could not start: ${error.message}`
    }
  }

  // Serialized so a quick off-on cannot leave two listeners racing for one port.
  function restartGateway() {
    gatewayStart = (gatewayStart ?? Promise.resolve()).then(() => startDeviceGateway(config.gatewayEnabled.get()))
    return gatewayStart
  }
  ctx.effect(() => ctx.on('loader/volatile-update', () => { void restartGateway() }), 'jan-hosts: gateway switch')

  ctx.effect(() => {
    void restartGateway()
    return async () => {
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
    const tunnel = tunnels.get(entry.id)
    return {
      ...entry, signedIn: entry.kind === 'url' ? (await token(entry.id)) !== undefined : tunnel !== undefined,
      tunnel: tunnel === undefined ? undefined : { root: tunnel.root, log: tunnel.log },
      progress: progress.get(entry.id),
    }
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
    return openTunnel({
      ssh, relayPort: proxy?.port, log,
      command: ports => startCommand({ port: ports.web, proxy: proxy?.proxyUrl(ports.relay) }),
    })
  }

  /** The URL that opens the Host, with its login token so the window signs in on its own. */
  async function openUrl(entry) {
    if (entry.kind === 'ssh') {
      const tunnel = tunnels.get(entry.id)
      if (tunnel === undefined) throw new HostsError('not-connected', 'Connect first.')
      return `${tunnel.root}?token=${tunnel.token}`
    }
    const value = await token(entry.id)
    return value === undefined ? entry.url : `${entry.url}?token=${value}`
  }

  async function find(id) {
    const entry = (await store.connections()).find(item => item.id === id)
    if (entry === undefined) throw new HostsError('missing', 'That Host was removed.')
    return entry
  }

  ctx.effect(() => registerApi(ctx, 'hosts', {
    async state() {
      const connections = await Promise.all((await store.connections()).map(connectionView))
      return {
        connections,
        devices: await store.devices(),
        gateway: gateway === undefined
          ? { running: false, enabled: config.gatewayEnabled.get(), error: gatewayError, addresses: lanAddresses() }
          : { running: true, enabled: true, url: gateway.url, addresses: lanAddresses() },
      }
    },
    async save(params) {
      try {
        const { connection, token: pasted } = await store.saveConnection(params)
        if (pasted !== undefined) await saveToken(connection.id, pasted)
        return connectionView(connection)
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
      tunnels.get(id)?.close()
      tunnels.delete(id)
      await store.removeConnection(id)
      await ctx.credentials.deleteRecord(tokenKey(id))
      return null
    },
    async test({ id }) {
      const entry = await find(id)
      if (entry.kind === 'ssh') {
        const tunnel = tunnels.get(id)
        if (tunnel === undefined) return { http: 'skipped', websocket: 'skipped', message: 'Connect first; SSH Hosts start when you connect.' }
        return testHost(tunnel.root, tunnel.token)
      }
      return testHost(entry.url, await token(id))
    },
    async connect({ id }) {
      const entry = await find(id)
      if (entry.kind !== 'ssh') throw new HostsError('kind', 'Only SSH Hosts connect; Address Hosts open directly.')
      if (tunnels.has(id)) return connectionView(entry)
      // A second press, or a second window, joins the Connect already running.
      if (!connecting.has(id)) {
        const log = []
        connecting.set(id, connectSsh(entry, line => { log.push(line); if (log.length > 20) log.shift() }).then((tunnel) => {
          const record = { ...tunnel, log }
          tunnels.set(id, record)
          void tunnel.exited.then(() => { if (tunnels.get(id) === record) tunnels.delete(id) })
        }).finally(() => { connecting.delete(id); progress.delete(id) }))
      }
      try {
        await connecting.get(id)
        return connectionView(entry)
      } catch (error) {
        throw new HostsError('ssh', error.message)
      }
    },
    async disconnect({ id }) {
      tunnels.get(id)?.close()
      tunnels.delete(id)
      return null
    },
    async open({ id }) {
      return { url: await openUrl(await find(id)) }
    },
    async enableGateway({ enabled }) {
      if (typeof enabled !== 'boolean') throw new HostsError('enabled', 'Choose on or off.')
      // Written to the profile so device access survives a restart; the volatile update restarts the gateway.
      await ctx.settings.update(ctx.fiber.entry.options.id, { gatewayEnabled: enabled })
      await restartGateway()
      return null
    },
    async pair({ name: label }) {
      if (gateway === undefined) throw new HostsError('gateway', 'Turn on device access first.')
      try {
        const { device, token: value } = await store.pairDevice(label)
        await reloadDevices()
        const url = gateway.pairUrl(value)
        return { device, url, qr: renderSVG(url, { border: 2 }) }
      } catch (error) { throw publicError(error) }
    },
    async revoke({ id }) {
      await store.revokeDevice(id)
      await reloadDevices()
      gateway?.disconnect(id)
      return null
    },
  }), 'jan-hosts: /jan-api/hosts')
}
