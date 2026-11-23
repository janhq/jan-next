import { createHash } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@janhq/cordis'
import WebServer from '@janhq/jan-host-webserver'
import AuthorizationService from '@janhq/jan-authorization'
import { LocalCredentialProvider } from '@janhq/jan-credentials-local'
import { credentialKey, credentialRef } from '@janhq/jan-credentials'
import type { AccountClientMetadata, AccountView } from '../src/account.ts'
import { TokamakAccountProvider } from '../src/index.ts'
import { startMockTokamak, type MockTokamak } from './mock-tokamak.ts'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  vi.unstubAllEnvs()
  while (cleanups.length) await cleanups.pop()!()
})

const client: AccountClientMetadata = { version: '1.0.0', locale: 'en', timezoneOffsetSeconds: 0 }

async function fixture(configure?: (mock: MockTokamak) => void, config: Record<string, unknown> = {},
  seed?: (ctx: Context, mock: MockTokamak) => Promise<void>) {
  vi.stubEnv('TOKAMAK_API_KEY', undefined)
  const mock = await startMockTokamak()
  configure?.(mock)
  cleanups.push(() => mock.close())
  const home = await mkdtemp(join(tmpdir(), 'tokamak-account-'))
  cleanups.push(() => rm(home, { recursive: true, force: true }))
  const ctx = new Context()
  const web = ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  await web
  const credentials = ctx.plugin(LocalCredentialProvider, { path: join(home, 'credentials.yaml'), watch: false })
  await credentials
  const authorization = ctx.plugin(AuthorizationService)
  await authorization
  await seed?.(ctx, mock)
  const provider = ctx.plugin(TokamakAccountProvider, {
    apiBaseURL: mock.origin, allowLoopbackHttp: true, attemptTimeoutMs: 20_000, ...config,
  })
  await provider
  cleanups.push(async () => { await provider.dispose(); await authorization.dispose(); await credentials.dispose(); await web.dispose() })
  const account = ctx.tokamakAccount as TokamakAccountProvider
  const states = new AbortController()
  cleanups.push(async () => { states.abort() })
  const until = async (predicate: (state: AccountView) => boolean): Promise<AccountView> => {
    for await (const state of account.watch(states.signal)) if (predicate(state)) return state
    throw new Error('watch ended')
  }
  const callbackOrigin = `http://127.0.0.1:${ctx.webServer.port}`
  return { mock, ctx, account, home, until, callbackOrigin }
}

it('signs in through the device flow, woken by the loopback redirect, and stores the key for the model route', async () => {
  // A 30 s poll interval: finishing within the test timeout proves the wake ping drove the poll.
  const f = await fixture((mock) => { mock.interval = 30 })
  await f.account.startSignIn(client, f.callbackOrigin, 'web')
  const waiting = await f.until(s => s.attempt?.phase === 'waiting-browser')
  const session = [...f.mock.sessions.values()][0]!
  expect(session.clientName).toBe('Tokamak Harness')
  expect(waiting.attempt?.userCode).toBe(session.userCode)
  const authorize = new URL(waiting.attempt!.authorizeUrl!)
  expect(authorize.pathname).toBe('/cli/authorize')
  expect(authorize.searchParams.get('code')).toBe(session.userCode)
  const redirect = authorize.searchParams.get('redirect')!
  expect(redirect).toBe(`${f.callbackOrigin}/done`)
  expect(new URL(redirect).hostname).toBe('127.0.0.1')

  // A wrong state is ignored; the approval page's ping with the right state wakes the poller.
  expect((await fetch(`${redirect}?state=wrong`)).status).toBe(404)
  const preflight = await fetch(redirect, { method: 'OPTIONS' })
  expect(preflight.headers.get('access-control-allow-private-network')).toBe('true')
  f.mock.approve()
  const woke = await fetch(`${redirect}?state=${authorize.searchParams.get('state')}`)
  expect(woke.status).toBe(200)

  const done = await f.until(s => s.status === 'credential-stored' && s.attempt?.phase === 'succeeded')
  expect(done.attempt?.userCode).toBeUndefined()
  expect((await f.ctx.credentials.resolve(credentialRef('TOKAMAK_API_KEY')))?.value).toBe(f.mock.key)
  expect(await f.account.resolveToken(`${f.mock.origin}/v1/chat/completions`)).toBe(f.mock.key)
  expect(await f.account.resolveToken('https://api.other.example/v1')).toBeUndefined()
  const profile = await f.account.getProfile(client)
  expect(profile).toEqual({ status: 'ready', value: { id: null, name: 'dev@example.invalid', contact: 'dev@example.invalid' } })
  expect(await readFile(join(f.home, 'credentials.yaml'), 'utf8')).toContain('tokamak-account/default')
})

it('keeps polling through transient failures', async () => {
  const f = await fixture((mock) => { mock.pollFailures.push(429, 503) })
  await f.account.startSignIn(client, f.callbackOrigin, 'web')
  await f.until(s => s.attempt?.phase === 'waiting-browser')
  f.mock.approve()
  await f.until(s => s.status === 'credential-stored')
  expect([...f.mock.sessions.values()][0]!.polls).toBeGreaterThanOrEqual(1)
}, 15_000)

it('fails when the user denies the request', async () => {
  const f = await fixture()
  await f.account.startSignIn(client, f.callbackOrigin, 'web')
  await f.until(s => s.attempt?.phase === 'waiting-browser')
  f.mock.deny()
  const failed = await f.until(s => s.attempt?.phase === 'failed')
  expect(failed.status).toBe('signed-out')
  expect(await f.ctx.credentials.resolve(credentialRef('TOKAMAK_API_KEY'))).toBeUndefined()
})

it('fails cleanly when the deployment has no device sign-in', async () => {
  const f = await fixture((mock) => { mock.unsupported = true })
  await f.account.startSignIn(client, f.callbackOrigin, 'web')
  const failed = await f.until(s => s.attempt?.phase === 'failed')
  expect(failed.attempt?.errorCode).toBe('protocol')
})

it('cancels an attempt in progress', async () => {
  const f = await fixture()
  const started = await f.account.startSignIn(client, f.callbackOrigin, 'web')
  await f.until(s => s.attempt?.phase === 'waiting-browser')
  const state = await f.account.cancelSignIn(started.attempt!.id)
  expect(state.attempt?.phase).toBe('cancelled')
  expect(state.status).toBe('signed-out')
})

it('signs out: clears both stored copies and revokes the key server-side', async () => {
  const f = await fixture((mock) => { mock.autoApprove = true })
  await f.account.startSignIn(client, f.callbackOrigin, 'web')
  await f.until(s => s.status === 'credential-stored')
  const state = await f.account.signOut(client)
  expect(state.status).toBe('signed-out')
  expect(await f.ctx.credentials.resolve(credentialRef('TOKAMAK_API_KEY'))).toBeUndefined()
  expect(await f.account.resolveToken(`${f.mock.origin}/v1`)).toBeUndefined()
  await expect.poll(() => f.mock.revoked).toEqual(['key_mock_1'])
})

it('drops credentials when inference rejects the token', async () => {
  const f = await fixture((mock) => { mock.autoApprove = true })
  await f.account.startSignIn(client, f.callbackOrigin, 'web')
  await f.until(s => s.status === 'credential-stored')
  let expired = false
  f.ctx.on('tokamak-account/session-expired', () => { expired = true })
  await f.account.rejectToken('some-other-token')
  expect((await f.account.getState()).status).toBe('credential-stored')
  await f.account.rejectToken(f.mock.key)
  expect((await f.account.getState()).status).toBe('signed-out')
  expect(expired).toBe(true)
})

it('accepts an approval that lands after the local deadline (last-round poll)', async () => {
  // The server approves only polls at or after the local deadline, so success requires the
  // post-deadline last-round poll and an exchange that the deadline no longer aborts.
  const f = await fixture(undefined, { attemptTimeoutMs: 1_200 })
  f.mock.approveAfter = Date.now() + 1_200
  await f.account.startSignIn(client, f.callbackOrigin, 'web')
  const done = await f.until(s => s.attempt?.phase === 'succeeded' || s.attempt?.phase === 'expired' || s.attempt?.phase === 'failed')
  expect(done.attempt?.phase).toBe('succeeded')
  expect(done.status).toBe('credential-stored')
}, 15_000)

it('treats a hung poll request as transient', async () => {
  const f = await fixture((mock) => { mock.hangPolls = 1; mock.approveOnPoll = 1 }, { requestTimeoutMs: 500 })
  await f.account.startSignIn(client, f.callbackOrigin, 'web')
  const done = await f.until(s => s.attempt?.phase === 'succeeded' || s.attempt?.phase === 'failed')
  expect(done.attempt?.phase).toBe('succeeded')
}, 15_000)

it('keeps a new key when only the model listing is down', async () => {
  const f = await fixture((mock) => { mock.autoApprove = true; mock.failModels = 503 })
  await f.account.startSignIn(client, f.callbackOrigin, 'web')
  const done = await f.until(s => s.attempt?.phase === 'succeeded' || s.attempt?.phase === 'failed')
  expect(done.attempt?.phase).toBe('succeeded')
  expect(f.mock.revoked).toEqual([])
})

it('revokes a minted key that Tokamak rejects instead of orphaning it', async () => {
  const f = await fixture((mock) => { mock.autoApprove = true; mock.failModels = 401 })
  await f.account.startSignIn(client, f.callbackOrigin, 'web')
  const failed = await f.until(s => s.attempt?.phase === 'failed' || s.attempt?.phase === 'expired')
  expect(failed.status).toBe('signed-out')
  expect(await f.ctx.credentials.resolve(credentialRef('TOKAMAK_API_KEY'))).toBeUndefined()
  await expect.poll(() => f.mock.revoked).toEqual(['key_mock_1'])
})

it('restores a hand-saved TOKAMAK_API_KEY on sign-out instead of deleting it', async () => {
  const f = await fixture((mock) => { mock.autoApprove = true })
  const ref = credentialRef('TOKAMAK_API_KEY')
  await f.ctx.credentials.set(ref, 'sk_live_hand_pasted')
  await f.account.startSignIn(client, f.callbackOrigin, 'web')
  // The grant lands before the reference, so wait for the whole attempt to settle.
  await f.until(s => s.attempt?.phase === 'succeeded')
  expect((await f.ctx.credentials.resolve(ref))?.value).toBe(f.mock.key)
  await f.account.signOut(client)
  expect((await f.ctx.credentials.resolve(ref))?.value).toBe('sk_live_hand_pasted')
})

it('preserves the password-manager reference, not its resolved value, across sign-in and sign-out', async () => {
  const f = await fixture((mock) => { mock.autoApprove = true })
  const ref = credentialRef('TOKAMAK_API_KEY')
  const pointer = 'op://Private/Tokamak/credential'
  const resolveRaw = f.ctx.credentials.resolve.bind(f.ctx.credentials)
  const dereference = vi.fn(() => 'mock-resolved-secret')
  vi.spyOn(f.ctx.credentials, 'resolve').mockImplementation(async (target, options) => {
    const hit = await resolveRaw(target, { dereference: false })
    return hit?.value === pointer && options?.dereference !== false ? { ...hit, value: dereference() } : hit
  })
  await f.ctx.credentials.set(ref, pointer)
  await f.account.startSignIn(client, f.callbackOrigin, 'web')
  await f.until(s => s.attempt?.phase === 'succeeded')
  const document = await readFile(join(f.home, 'credentials.yaml'), 'utf8')
  expect(document).toContain(pointer)
  expect(document).not.toContain('mock-resolved-secret')
  await f.account.signOut(client)
  expect(await f.ctx.credentials.resolve(ref, { dereference: false })).toEqual({ value: pointer, source: 'file' })
  expect(dereference).not.toHaveBeenCalled()
})

it('signing in again while signed in revokes the old key and still restores the original hand-saved key', async () => {
  const f = await fixture((mock) => { mock.autoApprove = true })
  const ref = credentialRef('TOKAMAK_API_KEY')
  await f.ctx.credentials.set(ref, 'sk_live_hand_pasted')
  await f.account.startSignIn(client, f.callbackOrigin, 'web')
  await f.until(s => s.attempt?.phase === 'succeeded')
  const first = f.mock.key
  await f.account.startSignIn(client, f.callbackOrigin, 'web')
  await f.until(s => s.attempt?.phase === 'succeeded' && f.mock.key !== first)
  expect((await f.ctx.credentials.resolve(ref))?.value).toBe(f.mock.key)
  await expect.poll(() => f.mock.revoked).toEqual(['key_mock_1'])
  await f.account.signOut(client)
  expect((await f.ctx.credentials.resolve(ref))?.value).toBe('sk_live_hand_pasted')
  await expect.poll(() => f.mock.revoked).toEqual(['key_mock_1', 'key_mock_2'])
}, 15_000)

it('signs in from a non-loopback UI origin by polling without a wake redirect', async () => {
  const f = await fixture((mock) => { mock.autoApprove = true })
  await f.account.startSignIn(client, 'https://harness.example.test', 'web')
  const waiting = await f.until(s => s.attempt?.authorizeUrl !== undefined || s.status === 'credential-stored')
  if (waiting.attempt?.authorizeUrl !== undefined) {
    expect(new URL(waiting.attempt.authorizeUrl).searchParams.has('redirect')).toBe(false)
  }
  await f.until(s => s.status === 'credential-stored')
})

it('notices a key revoked on tokamak.sh when the account page reads the profile', async () => {
  const f = await fixture((mock) => { mock.autoApprove = true })
  await f.account.startSignIn(client, f.callbackOrigin, 'web')
  await f.until(s => s.attempt?.phase === 'succeeded')
  let expired = false
  f.ctx.on('tokamak-account/session-expired', () => { expired = true })
  f.mock.revokeKey(f.mock.key)
  expect(await f.account.getProfile(client)).toBeNull()
  expect((await f.account.getState()).status).toBe('signed-out')
  expect(await f.ctx.credentials.resolve(credentialRef('TOKAMAK_API_KEY'))).toBeUndefined()
  expect(expired).toBe(true)
})

it('drops and revokes, at its own deployment, a key minted by another deployment', async () => {
  const other = await startMockTokamak()
  cleanups.push(() => other.close())
  const f = await fixture(undefined, {}, async (ctx) => {
    // Mint a real key on the other deployment and store it as if signed in there.
    other.autoApprove = true
    const session = await fetch(`${other.origin}/auth/cli/sessions`, { method: 'POST', body: JSON.stringify({ code_challenge: 'x' }) })
    const { session_id: sessionId } = await session.json() as { session_id: string }
    other.sessions.get(sessionId)!.challenge = createHash('sha256').update('verifier').digest('base64url')
    await fetch(`${other.origin}/auth/cli/sessions/token`, { method: 'POST', body: JSON.stringify({ session_id: sessionId, code_verifier: 'verifier' }) })
    await ctx.credentials.modifyRecord(credentialKey('tokamak-account', 'default'), () => Promise.resolve({
      kind: 'grant', payload: { version: 1, token: other.key, issuer: other.origin, keyId: 'key_mock_1' },
    }))
    await ctx.credentials.set(credentialRef('TOKAMAK_API_KEY'), other.key)
  })
  expect((await f.account.getState()).status).toBe('signed-out')
  expect(await f.ctx.credentials.resolve(credentialRef('TOKAMAK_API_KEY'))).toBeUndefined()
  await expect.poll(() => other.revoked).toEqual(['key_mock_1'])
})
