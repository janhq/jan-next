/**
 * Tokamak account provider: implements the `deepseekAccount` service seam with Tokamak's CLI
 * device sign-in, so the existing account UI, controller and model routes work unchanged.
 *
 * On approval the minted API key is stored twice:
 *   - as this plugin's grant record (key, key id, expiry, account) for state, revocation and sign-out;
 *   - as the credential reference `TOKAMAK_API_KEY`, which the `llm-pi-ai` `tokamak` route resolves
 *     per request (`apiKeyEnv: TOKAMAK_API_KEY`).
 */
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { platform, release } from 'node:os'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { Context, Service } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { z } from 'zod'
import {
  DeepSeekAccount, installAccountTaskCancellation,
  type AccountBonusBatch, type AccountClientMetadata, type AccountDetails, type AccountUserId, type AccountView,
  type PlatformSession, type SignInAttemptId, type SignInAttemptView,
} from './account.ts'
import { credentialKey, credentialRef, type CredentialRef } from '@deepseek-ai/dsh-credentials'
import type { AuthorizationSession } from '@deepseek-ai/dsh-authorization'
import {
  DEFAULT_BASE_URL, TokamakAuthError, TokamakUnsupportedError, apiKeysUrl, apiRoot, beginSession, buildAuthorizeUrl,
  normalizeBaseUrl, pollOnce, revokeKey, verifyKey, webRoot, type Minted,
} from './protocol.ts'

export * from './account.ts'
export * from './protocol.ts'

const KEY = credentialKey('tokamak-account', 'default')
const grant = z.object({
  version: z.literal(1),
  token: z.string().min(1),
  /** API origin that minted the key; a key from another deployment is never forwarded. */
  issuer: z.url(),
  keyId: z.string().optional(),
  /** Unix milliseconds. */
  expiresAt: z.number().optional(),
  account: z.string().optional(),
  /** A hand-saved TOKAMAK_API_KEY that sign-in replaced; sign-out restores it. */
  replacedKey: z.string().optional(),
})
type Grant = z.infer<typeof grant>
const WAKE_PATH = '/done'
const EXPIRY_WARNING_MS = 7 * 24 * 60 * 60 * 1000

/** Deployment options. */
export interface Config {
  /** OpenAI-compatible API base; a bare host gets `/v1`. */
  apiBaseURL?: string
  /** Web app origin hosting `/cli/authorize`; empty derives it from apiBaseURL (`api.` prefix stripped). */
  webOrigin?: string
  /** Name shown on the approval page and the minted key. */
  clientName?: string
  /** Credential reference the model route reads the key from. */
  apiKeyRef?: string
  /** Allow HTTP on loopback for local mocks. */
  allowLoopbackHttp?: boolean
  /** Deadline for each HTTP request. */
  requestTimeoutMs?: number
  /** Upper bound for one sign-in attempt, even if the server advertises a longer TTL. */
  attemptTimeoutMs?: number
}
export const Config = Schema.object({
  apiBaseURL: Schema.string().default(DEFAULT_BASE_URL),
  webOrigin: Schema.string().default(''),
  clientName: Schema.string().default('Tokamak Harness'),
  apiKeyRef: Schema.string().default('TOKAMAK_API_KEY'),
  allowLoopbackHttp: Schema.boolean().default(false),
  requestTimeoutMs: Schema.number().min(1).max(120_000).default(30_000),
  attemptTimeoutMs: Schema.number().min(1).max(3_600_000).default(600_000),
})

interface Attempt {
  view: SignInAttemptView
  controller: AbortController
  done: Promise<void>
  running: Promise<void>
  /** Loopback origin for the wake ping; undefined when the UI is served from a non-loopback origin. */
  origin: string | undefined
  disposeWake?: () => Promise<void>
}

/** Tokamak implementation of the account service. */
export class TokamakAccount extends DeepSeekAccount {
  static inject = ['credentials', 'authorization']
  static Config = Config
  /** Normalized API base (`…/v1`). */
  readonly baseUrl: string
  /** API origin the auth routes hang off. */
  readonly root: string
  /** Web app origin that hosts the approval page. */
  readonly web: string
  private readonly clientName: string
  private readonly keyRef: CredentialRef
  private readonly requestTimeout: number
  private readonly attemptTimeout: number
  private readonly lifetime = new AbortController()
  private readonly background = new Set<Promise<unknown>>()
  private readonly listeners = new Set<() => void>()
  private attempt: Attempt | undefined
  private closed = false
  private removing: Promise<AccountView> | undefined

  /** @param ctx - Host with authorization and credentials services. @param config - deployment options. */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx)
    installAccountTaskCancellation(ctx)
    const resolved = Config(config)
    this.baseUrl = normalizeBaseUrl(resolved.apiBaseURL, resolved.allowLoopbackHttp)
    this.root = apiRoot(this.baseUrl)
    this.web = webRoot(this.baseUrl, resolved.webOrigin)
    this.clientName = resolved.clientName
    this.keyRef = credentialRef(resolved.apiKeyRef)
    this.requestTimeout = resolved.requestTimeoutMs
    this.attemptTimeout = resolved.attemptTimeoutMs
    ctx.authorization.registerFlow({
      key: KEY, label: 'Tokamak', methods: [{ id: 'browser', label: 'Tokamak' }],
      run: (session) => {
        const attempt = this.attempt
        if (attempt === undefined) return Promise.reject(new TokamakAuthError('protocol'))
        attempt.running = this.run(session, attempt)
        return attempt.running
      },
    })
    ctx.on('credentials/record-updated', (key) => { if (key === KEY) this.changed() })
    ctx.effect(() => async () => {
      this.closed = true
      this.lifetime.abort()
      const active = this.attempt
      if (active !== undefined) {
        if (active.view.phase !== 'committing') active.controller.abort()
        await active.done
      }
      await this.removing
      await Promise.all(this.background)
      this.changed()
    }, 'tokamak-account: lifetime')
  }

  async [Service.init](): Promise<void> {
    const stored = await this.readGrant().catch(() => null)
    if (stored === null) return
    if (stored.issuer !== this.root) {
      // A key minted by another deployment (e.g. staging) must not be sent to this one; revoke it there.
      await this.clearStored(stored)
      if (stored.keyId !== undefined) this.revoke(stored.keyId, stored.token, stored.issuer)
      return
    }
    if (stored.expiresAt !== undefined && stored.expiresAt <= Date.now()) {
      console.warn('[tokamak-account] the stored Tokamak API key has expired; sign in again')
      await this.clearStored(stored)
      return
    }
    if (stored.expiresAt !== undefined && stored.expiresAt - Date.now() < EXPIRY_WARNING_MS) {
      console.warn('[tokamak-account] the stored Tokamak API key expires soon; sign in again to renew it',
        { expiresAt: new Date(stored.expiresAt).toISOString() })
    }
  }

  override async getState(): Promise<AccountView> {
    const stored = await this.readGrant()
    const attempt = this.attempt?.view ?? null
    return {
      status: stored === null ? 'signed-out' : 'credential-stored',
      attempt: stored === null && attempt?.phase === 'succeeded' ? null : attempt,
      links: { usageUrl: this.web, topUpUrl: apiKeysUrl(this.web) },
    }
  }

  override async getProfile(_client: AccountClientMetadata): Promise<AccountDetails['profile'] | null> {
    const stored = await this.readGrant()
    if (stored === null) return null
    // The model route reads TOKAMAK_API_KEY directly and never reports rejections here, so the
    // account page is where a key revoked on tokamak.sh, or past its expiry, is noticed.
    if (stored.expiresAt !== undefined && stored.expiresAt <= Date.now()) {
      await this.rejectToken(stored.token)
      return null
    }
    if (await this.keyRejected(stored)) {
      await this.rejectToken(stored.token)
      return null
    }
    return { status: 'ready', value: { id: null, name: stored.account ?? 'Tokamak', contact: stored.account ?? null } }
  }

  /** Tokamak has no wallet API here; an empty ready result lets the UI hide balance widgets. */
  override async getBalance(_client: AccountClientMetadata): Promise<AccountDetails['balance'] | null> {
    const stored = await this.readGrant()
    if (stored === null) return null
    return { status: 'ready', value: [], bonusWallets: [] }
  }

  override getUnnotifiedBonuses(_client: AccountClientMetadata): Promise<AccountBonusBatch | null> {
    return Promise.resolve(null)
  }

  override ackBonusNotified(): Promise<boolean> { return Promise.resolve(false) }

  override getPlatformSession(): Promise<PlatformSession | null> { return Promise.resolve(null) }

  override getDeviceIdentity(): Promise<{ deviceId?: string; userId?: AccountUserId; osVersion: string }> {
    return Promise.resolve({ osVersion: `${platform()} ${release()}` })
  }

  override async resolveToken(url: string): Promise<string | undefined> {
    if (this.closed || this.removing !== undefined) return undefined
    let destination: URL
    try { destination = new URL(url) } catch { return undefined }
    if (destination.origin !== this.root || destination.username || destination.password) return undefined
    const stored = await this.readGrant()
    if (stored === null || stored.issuer !== this.root) return undefined
    return stored.token
  }

  override async rejectToken(token: string): Promise<void> {
    const stored = await this.readGrant()
    if (stored === null || stored.token !== token) return
    this.removing ??= (async () => {
      // An attempt in flight must not later commit silently over an expired session.
      const cancelled = this.attempt
      if (cancelled !== undefined) await this.cancelSignIn(cancelled.view.id)
      await this.clearStored(stored)
      this.ctx.emit('deepseek-account/session-expired')
      if (this.attempt === cancelled) this.attempt = undefined
      this.ctx.emit('deepseek-account/signed-out')
      this.changed()
      return this.getState()
    })().finally(() => { this.removing = undefined })
    await this.removing
  }

  override async startSignIn(_client: AccountClientMetadata, callbackOrigin: string, _loginSource: 'web' | 'desktop'): Promise<AccountView> {
    if (this.removing !== undefined) await this.removing
    const origin = loginOrigin(callbackOrigin)
    if (this.closed) throw new TokamakAuthError('protocol')
    if (this.attempt !== undefined && isActive(this.attempt.view.phase)) return this.getState()
    const previous = this.attempt
    if (previous !== undefined) {
      await previous.done
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- disposal can race the await
      if (this.closed) throw new TokamakAuthError('protocol')
      if (this.attempt !== previous) return this.getState()
    }
    const attempt: Attempt = {
      origin,
      view: { id: randomUUID() as SignInAttemptId, phase: 'initializing' },
      controller: new AbortController(), done: Promise.resolve(), running: Promise.resolve(),
    }
    this.attempt = attempt
    attempt.done = this.ctx.authorization.begin({
      key: KEY, signal: attempt.controller.signal,
      interaction: { notify: () => undefined, prompt: () => Promise.reject(new TokamakAuthError('protocol')) },
    }).then((outcome) => {
      this.update(attempt, { phase: outcome.status === 'authorized' ? 'succeeded' : 'cancelled' })
    }).catch((error: unknown) => {
      const code = error instanceof TokamakAuthError ? error.code : 'protocol'
      console.error('[tokamak-account] sign-in failed', {
        errorCode: code, detail: error instanceof TokamakAuthError ? error.detail : undefined,
        unsupported: error instanceof TokamakUnsupportedError,
      })
      this.update(attempt, { phase: code === 'expired' ? 'expired' : 'failed', errorCode: code })
    }).then(async () => {
      await attempt.running.catch(() => undefined)
      await attempt.disposeWake?.()
    })
    this.changed()
    return this.getState()
  }

  override async cancelSignIn(id: SignInAttemptId): Promise<AccountView> {
    const attempt = this.attempt
    if (attempt?.view.id === id) {
      if (attempt.view.phase !== 'committing') {
        attempt.controller.abort()
        this.ctx.authorization.cancel(KEY)
      }
      await attempt.done
    }
    return this.getState()
  }

  override signOut(_client: AccountClientMetadata): Promise<AccountView> {
    this.removing ??= (async () => {
      if (this.closed) throw new TokamakAuthError('protocol')
      const cancelled = this.attempt
      if (cancelled !== undefined) await this.cancelSignIn(cancelled.view.id)
      const stored = await this.readGrant()
      if (stored !== null) {
        await this.clearStored(stored)
        if (stored.keyId !== undefined) this.revoke(stored.keyId, stored.token, stored.issuer)
      }
      // A sign-in started while this one was settling stays visible and cancellable.
      if (this.attempt === cancelled) this.attempt = undefined
      this.ctx.emit('deepseek-account/signed-out')
      this.changed()
      return this.getState()
    })().finally(() => { this.removing = undefined })
    return this.removing
  }

  override async *watch(signal: AbortSignal, _includeIdentityChanges = false): AsyncIterable<AccountView> {
    let dirty = true
    let wake: (() => void) | undefined
    const wakeUp = (): void => { dirty = true; wake?.() }
    this.listeners.add(wakeUp)
    signal.addEventListener('abort', wakeUp, { once: true })
    try {
      while (!this.closed && !signal.aborted) {
        if (dirty) { dirty = false; yield await this.getState(); continue }
        await new Promise<void>((resolve) => { wake = resolve })
      }
    } finally {
      this.listeners.delete(wakeUp)
      signal.removeEventListener('abort', wakeUp)
    }
  }

  /** @returns the stored grant, or null when signed out. @throws TokamakAuthError('storage') when malformed. */
  private async readGrant(): Promise<Grant | null> {
    if (this.closed) return null
    const record = await this.ctx.credentials.readRecord(KEY)
    if (record === undefined) return null
    if (record.kind !== 'grant') throw new TokamakAuthError('storage')
    const parsed = grant.safeParse(record.payload)
    if (!parsed.success) throw new TokamakAuthError('storage')
    return parsed.data
  }

  /**
   * Remove the grant and, only if it still holds this same key, the model-route credential,
   * restoring a hand-saved key that sign-in had replaced.
   */
  private async clearStored(stored: Grant): Promise<void> {
    await this.ctx.credentials.deleteRecord(KEY)
    const current = await this.ctx.credentials.resolve(this.keyRef).catch(() => undefined)
    // A reference from the environment, or one the user changed since, is left alone.
    if (current?.source !== 'file' || current.value !== stored.token) return
    if (stored.replacedKey !== undefined) await this.ctx.credentials.set(this.keyRef, stored.replacedKey).catch(() => undefined)
    else await this.ctx.credentials.unset(this.keyRef).catch(() => undefined)
  }

  /** Best-effort server-side revocation; disposal awaits it, so it is kept short once closing. */
  private revoke(keyId: string, token: string, issuer = this.root): void {
    const timeout = this.closed ? Math.min(this.requestTimeout, 3_000) : this.requestTimeout
    const task = revokeKey(apiRoot(issuer), keyId, token, AbortSignal.timeout(timeout))
      .then((revoked) => { if (!revoked) console.warn('[tokamak-account] could not revoke the API key server-side', { keyId }) })
      .finally(() => { this.background.delete(task) })
    this.background.add(task)
  }

  /** @returns true only when Tokamak explicitly rejects the stored key (401/403); outages are not rejections. */
  private async keyRejected(stored: Grant): Promise<boolean> {
    try {
      await verifyKey(this.baseUrl, stored.token, AbortSignal.timeout(this.requestTimeout))
      return false
    } catch (error) {
      return error instanceof TokamakAuthError && error.code === 'expired'
    }
  }

  private changed(): void { for (const listener of this.listeners) listener() }

  private update(attempt: Attempt, value: Partial<SignInAttemptView>): void {
    // The approval link and code are only meaningful while waiting for the browser.
    const { authorizeUrl: _url, userCode: _code, ...rest } = attempt.view
    attempt.view = { ...rest, ...value }
    this.changed()
  }

  private async run(session: AuthorizationSession, attempt: Attempt): Promise<void> {
    const verifier = randomBytes(32).toString('base64url')
    const state = randomBytes(32).toString('base64url')
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    const waker = new Waker()
    const webServer = attempt.origin === undefined ? undefined : this.ctx.get('webServer')
    if (webServer !== undefined) {
      attempt.disposeWake = this.ctx.effect(() => webServer.register({
        kind: 'exact', path: WAKE_PATH, handler: (req, res) => {
          if (req.method === 'OPTIONS') {
            // Chrome Private Network Access preflight from the public approval page.
            res.writeHead(204, {
              'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, OPTIONS',
              'access-control-allow-private-network': 'true', 'cache-control': 'no-store',
            }).end()
            return
          }
          let url: URL
          try { url = new URL(req.url ?? '/', 'http://127.0.0.1') } catch { res.writeHead(400).end(); return }
          const received = url.searchParams.get('state') ?? ''
          const valid = req.method === 'GET' && Buffer.byteLength(received) === Buffer.byteLength(state)
            && timingSafeEqual(Buffer.from(received), Buffer.from(state))
          if (!valid) { res.writeHead(404, { 'cache-control': 'no-store' }).end('not found'); return }
          res.writeHead(200, {
            'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
            'access-control-allow-origin': '*', 'referrer-policy': 'no-referrer',
            'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
          }).end(WAKE_PAGE)
          waker.ping()
        },
      }), 'tokamak-account: wake route')
    }
    // Every request is bounded by cancellation plus its own timeout; the attempt deadline only
    // bounds waiting for approval (below), so a late approval is never discarded mid-exchange.
    const requestSignal = () => AbortSignal.any([session.signal, AbortSignal.timeout(this.requestTimeout)])
    const startedAt = Date.now()
    const device = await beginSession(this.root, challenge, this.clientName, requestSignal())
    session.signal.throwIfAborted()
    const expiresAt = Math.min(startedAt + this.attemptTimeout, Date.now() + device.expiresInSeconds * 1000)
    const authorizeUrl = buildAuthorizeUrl(this.web, device.userCode,
      webServer === undefined || attempt.origin === undefined ? undefined : { redirect: `${attempt.origin}${WAKE_PATH}`, state })
    // update() drops the link and code on every later phase.
    this.update(attempt, { phase: 'waiting-browser', authorizeUrl, userCode: device.userCode, expiresAt })

    let interval = device.intervalSeconds
    let key: Minted
    while (true) {
      // The local deadline only bounds waiting; one last poll lets the server's verdict win.
      const lastRound = Date.now() >= expiresAt
      if (!lastRound) await waker.wait(Math.min(interval * 1000, Math.max(0, expiresAt - Date.now())), session.signal)
      session.signal.throwIfAborted()
      const result = await pollOnce(this.root, device.sessionId, verifier, session.signal, this.requestTimeout)
      if (result.status === 'approved') { key = result.minted; break }
      if (result.status === 'denied') throw new TokamakAuthError('protocol', 'sign-in denied in the browser')
      if (result.status === 'expired') throw new TokamakAuthError('expired', 'sign-in expired on the server')
      if (result.status === 'pending') interval = result.intervalSeconds
      if (lastRound) throw new TokamakAuthError('expired', `timed out waiting for approval${result.status === 'retry' ? ` (${result.detail})` : ''}`)
    }

    // From here a live key exists server-side: any failure revokes it rather than orphaning it.
    try {
      this.update(attempt, { phase: 'exchanging' })
      try { await verifyKey(this.baseUrl, key.key, requestSignal()) } catch (error) {
        // Only an explicit rejection is fatal; an outage right after approval keeps the key (Jan uses
        // the listing for metadata, not as a gate).
        if (!(error instanceof TokamakAuthError && error.code === 'expired')) {
          console.warn('[tokamak-account] could not verify the new key; keeping it', {
            errorCode: error instanceof TokamakAuthError ? error.code : 'unknown',
          })
        } else throw error
      }
      this.update(attempt, { phase: 'committing' })
      // Signing in again while signed in: the current reference is our own previous key, so carry
      // over whatever *it* replaced, and revoke it once the new key is stored.
      const old = await this.readGrant().catch(() => null)
      const previous = await this.ctx.credentials.resolve(this.keyRef).catch(() => undefined)
      const replacedKey = previous?.source !== 'file' || previous.value === key.key ? undefined
        : old !== null && previous.value === old.token ? old.replacedKey : previous.value
      const payload: Grant = {
        version: 1, token: key.key, issuer: this.root,
        ...replacedKey === undefined ? {} : { replacedKey },
        ...key.keyId === undefined ? {} : { keyId: key.keyId },
        ...key.expiresAt === undefined ? {} : { expiresAt: key.expiresAt },
        ...key.account === undefined ? {} : { account: key.account },
      }
      // Grant first: it is what sign-out reads, so the reference can never outlive it.
      try { await session.commit({ kind: 'grant', payload }) } catch (error) {
        console.error('[tokamak-account] could not store the sign-in grant', { error: String(error) })
        throw new TokamakAuthError('storage')
      }
      try { await this.ctx.credentials.set(this.keyRef, key.key) } catch (error) {
        console.error('[tokamak-account] could not store the API key credential', { error: String(error) })
        // Put back exactly what was there, so the grant and the reference keep agreeing.
        await (old === null ? this.ctx.credentials.deleteRecord(KEY)
          : this.ctx.credentials.modifyRecord(KEY, () => Promise.resolve({ kind: 'grant', payload: old }))).catch(() => undefined)
        throw new TokamakAuthError('storage')
      }
      if (old !== null && old.token !== key.key && old.keyId !== undefined) this.revoke(old.keyId, old.token, old.issuer)
    } catch (error) {
      if (key.keyId !== undefined) this.revoke(key.keyId, key.key)
      throw error
    }
  }
}
export default TokamakAccount

function isActive(phase: SignInAttemptView['phase']): boolean {
  return phase === 'initializing' || phase === 'waiting-browser' || phase === 'exchanging' || phase === 'committing'
}

/**
 * One-shot wake latch for the poll loop: a ping that arrives while a poll is in flight is kept
 * and consumed by the next wait instead of being lost.
 */
class Waker {
  private woken = false
  private resolve: (() => void) | undefined
  ping(): void { this.woken = true; this.resolve?.() }
  /** Sleep for `ms`, returning early on a (possibly earlier) ping or on abort. */
  wait(ms: number, signal: AbortSignal): Promise<void> {
    if (this.woken || signal.aborted) { this.woken = false; return Promise.resolve() }
    return new Promise<void>((resolve) => {
      const finish = (): void => {
        clearTimeout(timer)
        signal.removeEventListener('abort', finish)
        this.resolve = undefined
        this.woken = false
        resolve()
      }
      const timer = setTimeout(finish, ms)
      signal.addEventListener('abort', finish, { once: true })
      this.resolve = finish
    })
  }
}

/**
 * The loopback origin the approval page may ping to wake the poller, Jan-style (`http://127.0.0.1:<port>`).
 * @param value - origin the initiating UI is served from.
 * @returns normalized loopback origin, or undefined for any other origin (LAN, proxy, HTTPS): the
 *   device flow then simply polls without a wake ping.
 */
export function loginOrigin(value: string): string | undefined {
  let url: URL
  try { url = new URL(value) } catch { return undefined }
  const explicitPort = /^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):([0-9]+)\/?$/i.exec(value)?.[1]
  if (explicitPort === undefined || Number(explicitPort) === 0 || url.protocol !== 'http:'
    || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return undefined
  const host = url.hostname === '[::1]' ? '[::1]' : '127.0.0.1'
  return `http://${host}:${Number(explicitPort)}`
}

const WAKE_PAGE = '<!doctype html><html><head><meta charset="utf-8"><title>Tokamak Harness</title></head>'
  + '<body style="font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">'
  + '<div style="text-align:center"><div style="font-size:2rem;margin-bottom:.5rem">&#10003;</div>'
  + '<h1 style="font-size:1.3rem;font-weight:500;margin:0 0 .4rem">Tokamak Harness authorized</h1>'
  + '<p style="opacity:.6;margin:0">Return to the harness tab. You can close this one.</p></div></body></html>'
