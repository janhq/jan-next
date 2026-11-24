import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { installBinary } from './release.mjs'

const LOOPBACK = '127.0.0.1'
const MANAGEMENT = '/v8/management'

function childEnvironment() {
  // CLIProxyAPI also reads cloud-storage, Home and Management overrides from its env and .env.
  const allowed = /^(SYSTEMROOT|WINDIR|TMP|TEMP|TMPDIR|LANG|LC_\w+|HTTPS?_PROXY|ALL_PROXY|NO_PROXY|SSL_CERT_(FILE|DIR))$/i
  return Object.fromEntries(Object.entries(process.env).filter(([name]) => allowed.test(name)))
}

async function availablePort() {
  const reservation = createServer().listen(0, LOOPBACK)
  await once(reservation, 'listening')
  const { port } = reservation.address()
  await new Promise((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()))
  return port
}

/** One installation and one child process, owned by the plugin's lifetime. */
export class ProxyProcess {
  constructor(root, { install = installBinary, launch = spawn } = {}) {
    this.root = root
    this.authDir = join(root, 'auth')
    this.install = install
    this.launch = launch
  }

  async hasAccounts() {
    try {
      return (await readdir(this.authDir, { withFileTypes: true })).some(file => file.isFile() && file.name.endsWith('.json'))
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      return false
    }
  }

  async start(signal, report, onExit) {
    await mkdir(this.authDir, { recursive: true, mode: 0o700 })
    const binary = await this.install(this.root, AbortSignal.any([signal, AbortSignal.timeout(300_000)]),
      percent => report({ phase: 'downloading', percent }))
    report({ phase: 'starting' })
    const port = await availablePort()
    const origin = `http://${LOOPBACK}:${port}`
    const apiKey = randomBytes(32).toString('hex')
    const managementKey = randomBytes(32).toString('hex')
    const configPath = join(this.root, 'config.yaml')
    const temporary = `${configPath}.${randomBytes(8).toString('hex')}`
    try {
      await writeFile(temporary, JSON.stringify({
        'config-version': 8,
        server: { host: LOOPBACK, port, discovery: { enabled: false } },
        management: { 'allow-remote': false, 'secret-key': managementKey, 'disable-control-panel': true },
        access: { 'api-keys': [apiKey] },
        oauth: { 'auth-dir': this.authDir },
        plugins: { enabled: false },
      }), { flag: 'wx', mode: 0o600, signal })
      await rename(temporary, configPath)
    } finally {
      await rm(temporary, { force: true })
    }
    signal.throwIfAborted()
    // The installed version directory is private and contains only the verified executable.
    const child = this.launch(binary, ['--config', configPath, '--local-model'], {
      cwd: join(binary, '..'), env: childEnvironment(), stdio: 'ignore', windowsHide: true,
    })
    const lifetime = new AbortController()
    const closed = Promise.withResolvers()
    let ready = false
    let stopping = false
    const ended = () => {
      if (lifetime.signal.aborted) return
      lifetime.abort()
      closed.resolve()
      if (ready && !stopping) onExit(session)
    }
    child.once('error', ended)
    child.once('exit', ended)
    const stop = async () => {
      stopping = true
      if (lifetime.signal.aborted) return
      child.kill()
      await Promise.race([closed.promise, sleep(1500, undefined, { signal: lifetime.signal, ref: false }).catch(() => {})])
      if (lifetime.signal.aborted) return
      child.kill('SIGKILL')
      await closed.promise
    }
    const request = async (path, options = {}) => {
      const { signal: callerSignal, ...init } = options
      const key = path.startsWith(MANAGEMENT) ? managementKey : apiKey
      const response = await fetch(`${origin}${path}`, {
        ...init, redirect: 'error',
        headers: { authorization: `Bearer ${key}`, ...init.headers },
        signal: AbortSignal.any([signal, lifetime.signal, AbortSignal.timeout(10_000), ...(callerSignal ? [callerSignal] : [])]),
      })
      if (!response.ok) {
        await response.body?.cancel()
        throw new Error(`CLIProxyAPI HTTP ${response.status}`)
      }
      return response.json()
    }
    const session = { origin, apiKey, request, stop }
    try {
      // Probe the key-protected endpoint so a port collision cannot publish another service as ours.
      const waiting = AbortSignal.any([signal, lifetime.signal, AbortSignal.timeout(20_000)])
      for (;;) {
        waiting.throwIfAborted()
        try { await request(`${MANAGEMENT}/credentials`, { signal: waiting }); break }
        catch (error) {
          if (!(error instanceof TypeError)) throw error
          await sleep(150, undefined, { signal: waiting })
        }
      }
      waiting.throwIfAborted()
      ready = true
      return session
    } catch (error) {
      await stop()
      signal.throwIfAborted()
      throw new Error('startup', { cause: error })
    }
  }
}
