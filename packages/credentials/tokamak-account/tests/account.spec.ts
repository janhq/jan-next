import { afterEach, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import AuthorizationService from '@deepseek-ai/dsh-authorization'
import { LocalCredentialProvider } from '@deepseek-ai/dsh-credentials-local'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { AccountClientMetadata, AccountView } from '@deepseek-ai/dsh-deepseek-account'
import { TokamakAccount } from '../src/index.ts'
import { startMockTokamak, type MockTokamak } from './mock-tokamak.ts'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => { while (cleanups.length) await cleanups.pop()!() })

const client: AccountClientMetadata = { version: '1.0.0', locale: 'en', timezoneOffsetSeconds: 0 }

async function fixture(configure?: (mock: MockTokamak) => void, config: Record<string, unknown> = {}) {
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
  const provider = ctx.plugin(TokamakAccount, { apiBaseURL: mock.origin, allowLoopbackHttp: true, attemptTimeoutMs: 20_000, ...config })
  await provider
  cleanups.push(async () => { await provider.dispose(); await authorization.dispose(); await credentials.dispose(); await web.dispose() })
  const account = ctx.deepseekAccount as TokamakAccount
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
  const f = await fixture()
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
  expect(await f.account.resolveToken('https://api.deepseek.com/anthropic')).toBeUndefined()
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
  f.ctx.on('deepseek-account/session-expired', () => { expired = true })
  await f.account.rejectToken('some-other-token')
  expect((await f.account.getState()).status).toBe('credential-stored')
  await f.account.rejectToken(f.mock.key)
  expect((await f.account.getState()).status).toBe('signed-out')
  expect(expired).toBe(true)
})

it('accepts an approval that lands after the local deadline (last-round poll)', async () => {
  // Poll 1 at ~1s is pending; the 1.2s deadline passes; the approval on poll 2 must still be stored.
  const f = await fixture((mock) => { mock.approveOnPoll = 2 }, { attemptTimeoutMs: 1_200 })
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

it('revokes a minted key it could not verify instead of orphaning it', async () => {
  const f = await fixture((mock) => { mock.autoApprove = true; mock.failModels = true })
  await f.account.startSignIn(client, f.callbackOrigin, 'web')
  const failed = await f.until(s => s.attempt?.phase === 'failed')
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
