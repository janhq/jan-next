import { setTimeout as sleep } from 'node:timers/promises'
import { openCallback } from './callback.mjs'

const MANAGEMENT = '/v8/management'
const PROVIDERS = new Set(['claude', 'codex', 'antigravity', 'xai', 'kimi', 'kimi-ai', 'copilot', 'devin', 'meta'])
const START_ERRORS = new Set(['unsupported', 'download', 'checksum', 'startup'])
const credentials = `${MANAGEMENT}/credentials`

function query(path, params) { return `${MANAGEMENT}${path}?${new URLSearchParams(params)}` }

function accountsOf(value) {
  if (!Array.isArray(value.files)) throw new Error('Invalid CLIProxyAPI credential list')
  return value.files.flatMap(file => {
    if (!file || file.runtime_only || typeof file.name !== 'string' || !/^[^/\\]+\.json$/.test(file.name)
      || typeof file.provider !== 'string') return []
    const label = [file.email, file.label, file.name].find(text => typeof text === 'string' && text.trim())
    return [{ id: file.name, provider: file.provider, label }]
  })
}

function modelsOf(value) {
  if (!Array.isArray(value.data)) throw new Error('Invalid CLIProxyAPI model list')
  return value.data.filter(model => typeof model?.id === 'string' && model.id.trim())
}

/** Owns the live accounts, in-progress authorization and model catalog for one Host. */
export class SubscriptionProxy {
  #lifetime = new AbortController()
  #status = { phase: 'idle' }
  #accounts = []
  #session
  #starting
  #restart
  #crashes = 0
  #attempt
  #removing = false
  #error

  constructor(process, publishModels, { pollMs = 1000, onError = () => {}, downloads } = {}) {
    this.process = process
    this.publishModels = publishModels
    this.pollMs = pollMs
    this.onError = onError
    this.downloads = downloads
  }

  state() {
    return { status: this.#status, accounts: this.#accounts, signIn: this.#attempt?.view ?? null, error: this.#error }
  }

  async restore() {
    try { if (await this.process.hasAccounts()) await this.start() }
    catch (error) {
      if (this.#status.phase === 'idle' && error.name === 'AbortError') return
      this.onError('restore', error)
      this.#status = { phase: 'error', error: 'startup' }
    }
  }

  start() {
    const signal = this.#lifetime.signal
    signal.throwIfAborted()
    if (this.#starting) return this.#starting
    if (this.#session) return Promise.resolve(this.#session)
    clearTimeout(this.#restart)
    this.#status = { phase: 'starting' }
    this.#starting = this.#launch(signal).finally(() => { this.#starting = undefined })
    return this.#starting
  }

  async #launch(signal) {
    let session
    const downloads = this.downloads?.()
    const downloadAbort = downloads === undefined ? undefined : new AbortController()
    try {
      session = await this.process.start(signal, status => { this.#status = status }, child => this.#exited(child),
        downloadAbort === undefined ? undefined : {
          downloads, downloadSignal: downloadAbort.signal,
          cancel: async () => {
            downloadAbort.abort()
            await this.cancel()
            await this.#starting?.catch(() => { /* The launch owns its cancellation result. */ })
          },
          retry: async () => {
            await this.#starting?.catch(() => { /* The launch owns its failure result. */ })
            signal.throwIfAborted()
            await this.retry()
          },
        })
      this.#session = session
      await this.#refresh(session)
      this.#status = { phase: 'running' }
      return session
    } catch (error) {
      const owned = session === this.#session
      if (owned) this.#session = undefined
      await session?.stop()
      if (!signal.aborted && owned) {
        if (error === downloadAbort?.signal.reason && downloadAbort?.signal.aborted) {
          this.#status = { phase: 'idle' }
          throw error
        }
        this.#status = { phase: 'error', error: START_ERRORS.has(error.message) ? error.message : 'startup' }
        this.onError('startup', error)
      }
      throw error
    }
  }

  #exited(child) {
    if (this.#session !== child) return
    this.#session = undefined
    this.publishModels(undefined, [])
    this.#status = { phase: 'restarting' }
    this.#restart = setTimeout(() => { this.start().catch(() => {}) }, Math.min(30_000, 500 * 2 ** this.#crashes++))
    this.#restart.unref()
  }

  async #refresh(session) {
    const [accountList, modelList] = await Promise.all([session.request(credentials), session.request('/v1/models')])
    if (session !== this.#session || this.#lifetime.signal.aborted) return
    const accounts = accountsOf(accountList)
    const models = modelsOf(modelList)
    this.publishModels(session, accounts.length ? models : [])
    this.#accounts = accounts
  }

  signIn(provider) {
    this.#lifetime.signal.throwIfAborted()
    if (!PROVIDERS.has(provider) || this.#attempt || this.#removing) return false
    this.#error = undefined
    const attempt = { view: { provider }, controller: new AbortController() }
    this.#attempt = attempt
    attempt.done = this.#signIn(provider, attempt)
    return true
  }

  async #signIn(provider, attempt) {
    const { signal } = attempt.controller
    let terminal = false
    let state
    let session
    let close
    try {
      session = await this.start()
      signal.throwIfAborted()
      // Let an in-flight OAuth start finish so even a concurrent cancel can revoke its upstream state.
      // Upstream's is_webui=true opens a fixed-port listener on 0.0.0.0.
      const authorization = await session.request(query('/oauth/auth-url', { provider, is_webui: 'false' }))
      if (authorization.status !== 'ok' || typeof authorization.state !== 'string' || !authorization.state) {
        throw new Error('Invalid CLIProxyAPI authorization')
      }
      state = authorization.state
      signal.throwIfAborted()
      const url = new URL(authorization.url)
      if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Invalid CLIProxyAPI authorization URL')
      close = await openCallback(provider, url, state, session)
      signal.throwIfAborted()
      const code = typeof authorization.user_code === 'string' ? authorization.user_code : undefined
      attempt.view = { provider, url: url.href, code }
      const expires = typeof authorization.expires_in === 'number' && authorization.expires_in > 0 ? authorization.expires_in : 300
      const deadline = AbortSignal.timeout(1000 * Math.min(300, Math.ceil(expires)))
      const waiting = AbortSignal.any([deadline, signal])
      const statusPath = query('/oauth/status', { state })
      try {
        for (;;) {
          await sleep(this.pollMs, undefined, { signal: waiting })
          const { status } = await session.request(statusPath, { signal: waiting })
          if (status === 'wait') continue
          terminal = true
          if (status !== 'ok') throw new Error('CLIProxyAPI rejected the sign-in')
          break
        }
      } catch (error) {
        if (deadline.aborted) { this.#error = 'timeout'; return }
        throw error
      }
      await this.#refresh(session)
    } catch (error) {
      if (!signal.aborted && !this.#lifetime.signal.aborted && this.#status.phase !== 'error') {
        this.#error = terminal ? 'signInFailed' : 'signInUnavailable'
        this.onError('sign-in', error)
      }
    } finally {
      close?.()
      if (state && !terminal && !this.#lifetime.signal.aborted) {
        try {
          const { cancelled } = await session.request(query('/oauth/session', { state }), { method: 'DELETE' })
          if (!cancelled) await this.#refresh(session) // Login may have committed before cancellation won.
        } catch (error) {
          if (session === this.#session) {
            this.#error = 'cancelFailed'
            this.onError('cancel', error)
          }
        }
      }
      this.#attempt = undefined
    }
  }

  async cancel() {
    const attempt = this.#attempt
    attempt?.controller.abort()
    if (attempt) attempt.view = { provider: attempt.view.provider, cancelling: true }
    // Don't keep the caller waiting for a cold download when no OAuth session exists yet.
    if (this.#session) await attempt?.done
  }

  async signOut(id) {
    if (this.#attempt || this.#removing || !this.#accounts.some(account => account.id === id) || !this.#session) return false
    const session = this.#session
    this.#removing = true
    this.#error = undefined
    try {
      await session.request(`${credentials}?${new URLSearchParams({ name: id })}`, { method: 'DELETE' })
    } catch (error) {
      this.onError('sign-out', error)
      this.#error = 'signOutFailed'
      this.#removing = false
      return false
    }
    // Never advertise a revoked model if the post-delete refresh fails.
    try { await this.#refresh(session); return true }
    catch (error) {
      this.#accounts = this.#accounts.filter(account => account.id !== id)
      this.publishModels(undefined, [])
      this.#error = 'refreshFailed'
      this.onError('refresh after sign-out', error)
      return false
    } finally { this.#removing = false }
  }

  async retry() {
    this.#error = undefined
    const session = this.#session
    try {
      if (session) await this.#refresh(session)
      else { this.#crashes = 0; await this.start() }
    } catch (error) {
      if (session === this.#session && session) {
        this.#error = 'refreshFailed'
        this.onError('refresh', error)
      }
    }
  }

  async dispose() {
    this.#lifetime.abort()
    clearTimeout(this.#restart)
    this.#attempt?.controller.abort()
    const session = this.#session
    this.#session = undefined
    this.publishModels(undefined, [])
    await session?.stop()
    await this.#starting?.catch(() => {})
    await this.#attempt?.done
  }
}
