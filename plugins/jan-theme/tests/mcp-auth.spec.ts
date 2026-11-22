import { afterEach, describe, expect, it } from 'vitest'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { beginSignIn, failureReason, needsSignIn, signedInTokens, signInFailure } from '../mcp-auth.mjs'
import { startOAuthMcpFixture } from './oauth-mcp-fixture.mjs'

const fixtures: Array<{ close: () => Promise<void> }> = []
afterEach(async () => { await Promise.all(fixtures.splice(0).map(fixture => fixture.close())) })
const start = async (options = {}) => {
  const fixture = await startOAuthMcpFixture(options)
  fixtures.push(fixture)
  return fixture
}

async function connect(url: string, token?: string) {
  const client = new Client({ name: 'jan-test', version: '1' })
  await client.connect(new StreamableHTTPClientTransport(new URL(url), token ? { requestInit: { headers: { Authorization: `Bearer ${token}` } } } : {}))
  return client
}

describe('signing in to a remote MCP server', () => {
  it('recognises a server that asks for sign-in, and names other failures plainly', async () => {
    const fixture = await start()
    const error = await connect(fixture.url).then(() => undefined, (failure: unknown) => failure)
    expect(needsSignIn(new Error('mcp-client(x): initial connection failed', { cause: error }))).toBe(true)
    expect(needsSignIn(new Error('spawn npx ENOENT'))).toBe(false)
    expect(failureReason(new Error('outer', { cause: Object.assign(new Error('spawn figma ENOENT'), { code: 'ENOENT', path: 'figma' }) })))
      .toBe('Jan could not find the command "figma". Check that it is installed.')
    expect(failureReason(new Error('outer', { cause: new Error('fetch failed') }))).toMatch(/could not reach the server/)
  })

  it('registers, sends the browser to the sign-in page and connects with the returned token', async () => {
    const fixture = await start()
    let saved: { tokens?: { access_token: string } } | undefined
    const flow = await beginSignIn(fixture.url, async (record: typeof saved) => { saved = record })
    expect(flow.url).toMatch(new RegExp(`^${fixture.base}/authorize\\?`))
    // The browser: follow the sign-in page to Jan's loopback callback.
    const page = await fetch(flow.url!)
    expect(page.status).toBe(200)
    expect(await page.text()).toContain('Signed in')
    await flow.done
    expect(saved?.tokens?.access_token).toMatch(/^at-/)
    const client = await connect(fixture.url, saved!.tokens!.access_token)
    expect((await client.listTools()).tools.map(tool => tool.name)).toEqual(['whoami'])
    await client.close()
  })

  it('rejects a callback that does not carry its own state', async () => {
    const fixture = await start()
    const flow = await beginSignIn(fixture.url, async () => {})
    const outcome = flow.done.then(() => 'signed in', (error: Error) => error.message)
    const callback = new URL(flow.url!).searchParams.get('redirect_uri')!
    const forged = await fetch(`${callback}?code=stolen&state=wrong`)
    expect(forged.status).toBe(400)
    expect(await outcome).toMatch(/without a code/)
  })

  it('says to use an access token when the server refuses to register Jan', async () => {
    const fixture = await start({ refuseRegistration: true })
    const error = await beginSignIn(fixture.url, async () => {}).then(() => undefined, (failure: unknown) => failure)
    expect(error).toBeInstanceOf(Error)
    expect(signInFailure(fixture.url, error)).toBe(`${new URL(fixture.url).host} only lets apps it has approved sign in, and it has not approved Jan yet. Use an access token instead.`)
  })

  it('refreshes a saved sign-in that is about to expire, and keeps one that is not', async () => {
    const fixture = await start({ expiresIn: 30 })
    let saved: any
    const flow = await beginSignIn(fixture.url, async (record: unknown) => { saved = record })
    await fetch(flow.url!)
    await flow.done
    const first = saved.tokens.access_token
    let stored: any
    const refreshed = await signedInTokens(fixture.url, saved, async (next: unknown) => { stored = next })
    expect(refreshed?.accessToken).toMatch(/^at-/)
    expect(refreshed?.accessToken).not.toBe(first)
    expect(stored.tokens.access_token).toBe(refreshed?.accessToken)
    const kept = await signedInTokens(fixture.url, { ...stored, expiresAt: Date.now() + 3_600_000 }, async () => { throw new Error('must not save') })
    expect(kept?.accessToken).toBe(refreshed?.accessToken)
    expect(await signedInTokens(fixture.url, { tokens: { access_token: 'old' }, expiresAt: Date.now() }, async () => {})).toBeUndefined()
  })
})
