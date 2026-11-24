import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, Service } from '@janhq/cordis'
import { liveConfig } from '../../../settings/settings/tests/live-config.ts'
import LlmRuntime, { LlmError } from '@janhq/jan-llm'
import { credentialRef } from '@janhq/jan-credentials'
import { LocalCredentialProvider } from '@janhq/jan-credentials-local'
import * as LlmPiAi from '@janhq/jan-llm-pi-ai'
import Storage from '@janhq/jan-storage'
import * as StorageDomain from '@janhq/jan-storage-domain'
import * as StorageJson from '@janhq/jan-storage-json'
import { resolveProfiles } from '../src/config.ts'
import { openListingStore } from '../src/listing-store.ts'
import { PiAiAdapter } from '../src/adapter.ts'
import { memoryAuth } from './auth-double.ts'
import { assemble } from './assemble.ts'

/** A router stand-in serving `GET /v1/models` for its known keys and a streamed chat completion. */
interface Router {
  url: string
  /** Ids `GET /models` lists. */
  models: { id: string; context_window?: number }[]
  /** Bearer keys the router accepts. */
  keys: Set<string>
  /** HTTP status `GET /models` answers with instead of the listing. */
  fail: number | undefined
  /** Leave `GET /models` unanswered. */
  hang: boolean
  /** Answer `GET /models` only once this resolves. */
  gate: Promise<void> | undefined
  /** Bearer keys of every `GET /models` request, in order. */
  listings: string[]
  /** Model ids of every chat completion, in order. */
  chats: string[]
}

const servers: Server[] = []
const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  vi.useRealTimers()
  while (cleanups.length > 0) await cleanups.pop()!()
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve) => {
    server.close(() => { resolve() })
    server.closeAllConnections()
  })))
  vi.unstubAllEnvs()
})

async function router(): Promise<Router> {
  const state: Omit<Router, 'url'> = {
    models: [{ id: 'tokamak/auto' }, { id: 'anthropic/opus' }],
    keys: new Set(['tk-one']),
    fail: undefined,
    hang: false,
    gate: undefined,
    listings: [],
    chats: [],
  }
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const key = /^Bearer (.+)$/.exec(request.headers.authorization ?? '')?.[1] ?? ''
    if (request.method === 'GET' && request.url === '/v1/models') {
      state.listings.push(key)
      if (state.hang) return
      void (async () => {
        await state.gate
        if (state.fail !== undefined) { response.writeHead(state.fail).end('{}'); return }
        if (key !== '' && !state.keys.has(key)) { response.writeHead(401).end('{}'); return }
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ object: 'list', data: state.models.map(model => ({ object: 'model', ...model })) }))
      })()
      return
    }
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => { chunks.push(chunk) })
    request.on('end', () => {
      state.chats.push(String((JSON.parse(Buffer.concat(chunks).toString('utf8')) as { model?: unknown }).model))
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      for (const data of [
        '{"choices":[{"delta":{"role":"assistant","content":"hi"},"index":0,"finish_reason":null}]}',
        '{"choices":[{"delta":{},"index":0,"finish_reason":"stop"}]}',
        '[DONE]',
      ]) response.write(`data: ${data}\n\n`)
      response.end()
    })
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('router: no address')
  return Object.assign(state, { url: `http://127.0.0.1:${String(address.port)}/v1` })
}

/** Agent default model stand-in recording saves. */
class FakeDefaults extends Service {
  selection = { provider: 'tokamak', model: 'tokamak-1-preview' }
  saves: { provider: string; model: string }[] = []
  constructor(ctx: Context) { super(ctx, 'agentDefaultModel') }
  currentSelection(): { provider: string; model: string } { return this.selection }
  saveSelection(selection: { provider: string; model: string }): Promise<void> {
    this.saves.push(selection)
    this.selection = selection
    return Promise.resolve()
  }
}

function route(url: string, listing: LlmPiAi.PiAiModelListing = {}): LlmPiAi.Options {
  return {
    providers: {
      tokamak: {
        displayName: 'Tokamak',
        api: 'openai-completions',
        baseURL: url,
        apiKeyEnv: 'TOKAMAK_LISTING_KEY',
        defaultContextWindow: 200000,
        modelListing: listing,
        models: [{ id: 'anthropic/opus', contextWindow: 1000000 }, { id: 'unlisted', name: 'Never served' }],
      },
    },
  }
}

async function boot(
  config: LlmPiAi.Options,
  options: { key?: string; defaults?: boolean; storage?: string } = {},
): Promise<{ ctx: Context; defaults: FakeDefaults | undefined; updates: () => number; saved: Promise<void> }> {
  vi.stubEnv('TOKAMAK_LISTING_KEY', '')
  const dir = await mkdtemp(join(tmpdir(), 'jan-pi-listing-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  if (options.key !== undefined) {
    await writeFile(join(dir, '.credentials.yaml'), `version: 1\nrefs:\n  TOKAMAK_LISTING_KEY: ${options.key}\n`, { mode: 0o600 })
  }
  const ctx = new Context()
  cleanups.push(async () => { await ctx.fiber.dispose() })
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(LocalCredentialProvider, { path: join(dir, '.credentials.yaml'), watch: false })
  if (options.defaults === true) await ctx.plugin(FakeDefaults)
  if (options.storage !== undefined) await mountStorage(ctx, options.storage)
  let updates = 0
  ctx.on('llm/adapters-updated', () => { updates += 1 })
  // A listing fetched before its storage opened is never written if the plugin unloads first.
  const saved = new Promise<void>((resolve) => {
    ctx.on('domain/changed', (change) => {
      if (change.domain === 'llm_pi_ai_model_listings' && change.operation === 'put') resolve()
    })
  })
  await ctx.plugin(LlmPiAi, config)
  return { ctx, defaults: ctx.get('agentDefaultModel') as FakeDefaults | undefined, updates: () => updates, saved }
}

async function mountStorage(ctx: Context, root: string): Promise<void> {
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root })
  await ctx.plugin(StorageDomain, { backend: 'json' })
}

async function storageRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'jan-pi-listing-storage-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  return root
}

describe('modelListing configuration', () => {
  it('turns listing on only where a route sets it', () => {
    const profiles = resolveProfiles({ plain: { api: 'openai-completions', baseURL: 'http://127.0.0.1:9', models: [{ id: 'm' }] } })
    expect(profiles.get('plain')?.modelListing).toBeUndefined()
    const listed = resolveProfiles({ listed: { api: 'openai-completions', baseURL: 'http://127.0.0.1:9', modelListing: {} } })
    expect(listed.get('listed')?.modelListing).toEqual({ api: 'openai-completions', refreshIntervalMs: 600000, timeoutMs: 15000, preferredDefaults: [], exclude: [] })
    // No listing yet: no models, and no diagnostic to repair.
    expect(listed.get('listed')?.piProvider).toBeUndefined()
    expect(listed.get('listed')?.catalogError).toBeUndefined()
  })

  it('refuses a route it could not list', () => {
    expect(() => resolveProfiles({ r: { api: 'google-generative-ai', baseURL: 'http://x', modelListing: {} } }))
      .toThrow(/modelListing, which needs api set to one of/)
    expect(() => resolveProfiles({ r: { baseURL: 'http://x', modelListing: {} } }))
      .toThrow(/modelListing, which needs api set to one of/)
    expect(() => resolveProfiles({ r: { api: 'openai-completions', modelListing: {} } }))
      .toThrow(/modelListing, which needs baseURL or baseURLEnv/)
    expect(() => resolveProfiles({ r: { api: 'openai-completions', baseURL: 'http://x', modelListing: {}, modelOverrides: { m: {} } } }))
      .toThrow(/modelOverrides beside modelListing/)
    expect(() => resolveProfiles({ r: { api: 'openai-completions', baseURL: 'http://x', modelListing: { timeoutMs: 0 } } }))
      .toThrow(/modelListing.timeoutMs must be a positive integer/)
    expect(() => resolveProfiles({ r: { api: 'openai-completions', baseURL: 'http://x', modelListing: { preferredDefaults: [''] } } }))
      .toThrow(/preferredDefaults has an empty model id/)
    expect(() => resolveProfiles({ r: { api: 'openai-completions', baseURL: 'http://x', modelListing: { exclude: [''] } } }))
      .toThrow(/exclude has an empty pattern/)
  })

  it('describes listed models from the listing where configuration is silent', () => {
    const listings = new Map([['r', [
      { id: 'bare' },
      { id: 'sized', name: 'Sized', contextWindow: 64000, maxTokens: 4000, inputModalities: ['text', 'image'] as const },
      { id: 'configured', name: 'Listed name', contextWindow: 64000 },
    ]]])
    const profile = resolveProfiles({
      r: {
        api: 'openai-completions', baseURL: 'http://x', modelListing: {}, defaultContextWindow: 100,
        models: [{ id: 'configured', name: 'Configured name', input: [] }, { id: 'bare', maxTokens: 500 }],
      },
    }, 'deferred', listings).get('r')
    const models = profile?.piProvider?.getModels() ?? []
    expect(models.map(model => [model.id, model.name, model.contextWindow, model.maxTokens, model.input])).toEqual([
      ['bare', 'bare', 100, 500, ['text']],
      ['sized', 'Sized', 64000, 4000, ['text', 'image']],
      ['configured', 'Configured name', 64000, 128000, ['text']],
    ])
    expect([...profile?.configuredMaxTokens ?? []]).toEqual([['bare', 500]])
  })

  it('leaves out listed models an exclude pattern names', () => {
    const listed = [{ id: 'openai/gpt-image-2' }, { id: 'openai/gpt-6-sol' }, { id: 'a.b(c)' }, { id: 'axbc' }]
    const profile = resolveProfiles({
      r: { api: 'openai-completions', baseURL: 'http://x', modelListing: { exclude: ['openai/gpt-image-*', 'a.b(c)'] } },
    }, 'deferred', new Map([['r', listed]])).get('r')
    // Only `*` is a wildcard: `.` and parentheses match themselves.
    expect(profile?.piProvider?.getModels().map(model => model.id)).toEqual(['openai/gpt-6-sol', 'axbc'])
  })

  it('serves nothing from an emptied listing on a route the installed catalog also describes', () => {
    for (const listed of [[], [{ id: 'gpt-image-1' }]]) {
      const profile = resolveProfiles({
        openai: { api: 'openai-completions', baseURL: 'http://x', modelListing: { exclude: ['gpt-image-*'] } },
      }, 'deferred', new Map([['openai', listed]])).get('openai')
      expect(profile?.piProvider).toBeUndefined()
      expect(profile?.catalogError).toBeUndefined()
    }
  })

  it('serves nothing, without a diagnostic, for an empty listing', () => {
    const profile = resolveProfiles(
      { r: { api: 'openai-completions', baseURL: 'http://x', modelListing: {} } },
      'deferred',
      new Map([['r', []]]),
    ).get('r')
    expect(profile?.piProvider).toBeUndefined()
    expect(profile?.catalogError).toBeUndefined()
  })

  it('validates configured entries on writes even before any listing exists', () => {
    expect(() => resolveProfiles({
      r: { api: 'openai-completions', baseURL: 'http://x', modelListing: {}, models: [{ id: 'm' }, { id: 'm' }] },
    })).toThrow(/lists model "m" more than once/)
  })
})

describe('runtime model listing', () => {
  it('serves exactly the listed models, described by matching configured entries', async () => {
    const server = await router()
    const { ctx } = await boot(route(server.url), { key: 'tk-one' })

    const models = await ctx.llm.listModels('tokamak')
    expect(models.map(model => model.id)).toEqual(['tokamak/auto', 'anthropic/opus'])
    expect(server.listings).toEqual(['tk-one'])
    expect((await ctx.llm.resolveModelInfo('tokamak', 'anthropic/opus')).context?.contextWindow).toBe(1000000)
    expect((await ctx.llm.resolveModelInfo('tokamak', 'tokamak/auto')).context?.contextWindow).toBe(200000)
    await expect(ctx.llm.resolveModelInfo('tokamak', 'unlisted')).rejects.toMatchObject({ code: 'UNKNOWN_MODEL' })

    await assemble(ctx, { provider: 'tokamak', model: 'tokamak/auto', messages: [] })
    expect(server.chats).toEqual(['tokamak/auto'])
    // A fresh listing is reused rather than fetched for every read.
    expect(server.listings).toEqual(['tk-one'])
  })

  it('reports a missing credential, then lists once the credential is stored and refetches for a new one', async () => {
    const server = await router()
    server.keys.add('tk-two')
    const { ctx, updates } = await boot(route(server.url))

    await expect(ctx.llm.listModels('tokamak')).rejects.toMatchObject({ code: 'MISSING_CREDENTIAL' })
    expect(server.listings).toEqual([])

    await ctx.credentials.set(credentialRef('TOKAMAK_LISTING_KEY'), 'tk-one')
    expect((await ctx.llm.listModels('tokamak')).map(model => model.id)).toEqual(['tokamak/auto', 'anthropic/opus'])
    const afterSignIn = updates()

    server.models = [{ id: 'tokamak/auto' }]
    await ctx.credentials.set(credentialRef('TOKAMAK_LISTING_KEY'), 'tk-two')
    expect((await ctx.llm.listModels('tokamak')).map(model => model.id)).toEqual(['tokamak/auto'])
    expect(server.listings).toEqual(['tk-one', 'tk-two'])
    expect(updates()).toBe(afterSignIn + 1)

    // Signing out withdraws the listing and announces it.
    await ctx.credentials.unset(credentialRef('TOKAMAK_LISTING_KEY'))
    await expect(ctx.llm.listModels('tokamak')).rejects.toMatchObject({ code: 'MISSING_CREDENTIAL' })
    expect(updates()).toBe(afterSignIn + 2)
  })

  it('fails a read with no listing to fall back on, and keeps the last listing through a failed refresh', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const server = await router()
    server.fail = 503
    const { ctx } = await boot(route(server.url), { key: 'tk-one' })
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => undefined)

    await expect(ctx.llm.listModels('tokamak')).rejects.toMatchObject({ code: 'DISCOVERY_FAILED', message: `${server.url}/models answered 503` })
    // Without a listing, an exact model resolves provisionally; the request decides.
    expect((await ctx.llm.resolveModelInfo('tokamak', 'tokamak/auto')).context?.contextWindow).toBe(200000)

    server.fail = undefined
    expect((await ctx.llm.listModels('tokamak')).map(model => model.id)).toEqual(['tokamak/auto', 'anthropic/opus'])
    server.fail = 500
    // A listing past its refresh interval makes the read wait for its refresh.
    vi.setSystemTime(Date.now() + 600000)
    expect((await ctx.llm.listModels('tokamak')).map(model => model.id)).toEqual(['tokamak/auto', 'anthropic/opus'])
    expect(warn).toHaveBeenCalledWith('llm-pi-ai: could not refresh the model listing of provider route "tokamak"; keeping the last listing')
  })

  it('resolves and prepares an exact model without a listing, leaving the failure to the request', async () => {
    const server = await router()
    server.fail = 503
    const { ctx } = await boot(route(server.url))

    // An SDK handshake validates the route before any key is stored or the router answers.
    await expect(ctx.llm.listModels('tokamak')).rejects.toMatchObject({ code: 'MISSING_CREDENTIAL' })
    expect(await ctx.llm.resolveModelInfo('tokamak', 'anything/listed-later')).toMatchObject({ id: 'anything/listed-later' })
    const keyless = (await assemble(ctx, { provider: 'tokamak', model: 'tokamak/auto', messages: [] })).finish
    expect(keyless.kind === 'error' ? keyless.failure.code : keyless.kind).toBe('MISSING_CREDENTIAL')

    await ctx.credentials.set(credentialRef('TOKAMAK_LISTING_KEY'), 'tk-one')
    await assemble(ctx, { provider: 'tokamak', model: 'tokamak/auto', messages: [] })
    expect(server.chats).toEqual(['tokamak/auto'])
    // The provisional model never joins the shared catalog.
    await expect(ctx.llm.listModels('tokamak')).rejects.toMatchObject({ code: 'DISCOVERY_FAILED' })
  })

  it('fails an exact-model read without a held listing when the adapter has no provisional profile', async () => {
    const profiles = resolveProfiles({ r: { api: 'openai-completions', baseURL: 'http://127.0.0.1:9', modelListing: {} } })
    const adapter = new PiAiAdapter({
      profiles: () => profiles,
      resolveApiKey: () => Promise.resolve(undefined),
      auth: memoryAuth(),
      ensureModels: () => Promise.reject(new LlmError('listing down', 'DISCOVERY_FAILED')),
    })
    await expect(adapter.resolveModel('r', 'm')).rejects.toMatchObject({ code: 'UNKNOWN_MODEL' })
    await expect(adapter.prepareCall('r', 'm')).rejects.toMatchObject({ code: 'UNKNOWN_MODEL' })
    await expect(adapter.listModels('r')).rejects.toMatchObject({ code: 'DISCOVERY_FAILED' })
  })

  it('never waits for a hanging listing request on an exact-model read', async () => {
    const server = await router()
    server.hang = true
    const { ctx } = await boot(route(server.url, { timeoutMs: 60000 }), { key: 'tk-one' })
    const started = Date.now()
    expect((await ctx.llm.resolveModelInfo('tokamak', 'tokamak/auto')).id).toBe('tokamak/auto')
    expect(Date.now() - started).toBeLessThan(2000)
  })

  it('backs off background listing requests after a failure while no listing is held', async () => {
    const server = await router()
    server.fail = 503
    const { ctx } = await boot(route(server.url), { key: 'tk-one' })
    // The launch refresh fails once; exact-model reads within the interval send no more requests.
    await vi.waitFor(() => { expect(server.listings).toHaveLength(1) })
    await expect(ctx.llm.listModels('tokamak')).rejects.toMatchObject({ code: 'DISCOVERY_FAILED' })
    const afterRead = server.listings.length
    for (let turn = 0; turn < 3; turn++) await ctx.llm.resolveModelInfo('tokamak', 'tokamak/auto')
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(server.listings).toHaveLength(afterRead)

    // A selector read retries directly, and a success ends the back-off.
    server.fail = undefined
    expect(await ctx.llm.listModels('tokamak')).toHaveLength(2)
  })

  it('lists an unauthenticated route without a credential', async () => {
    const server = await router()
    const config = route(server.url)
    delete config.providers!['tokamak']!.apiKeyEnv
    const { ctx } = await boot(config)

    expect((await ctx.llm.listModels('tokamak')).map(model => model.id)).toEqual(['tokamak/auto', 'anthropic/opus'])
    expect(server.listings).toEqual([''])
  })

  it('lists the endpoint a baseURLEnv route resolves, and reports one it cannot use', async () => {
    const server = await router()
    vi.stubEnv('TOKAMAK_LISTING_URL', '')
    const config = route(server.url)
    const { baseURL: _baseURL, ...rest } = config.providers!['tokamak']!
    const { ctx } = await boot({ providers: { tokamak: { ...rest, baseURLEnv: 'TOKAMAK_LISTING_URL' } } }, { key: 'tk-one' })

    await ctx.credentials.set(credentialRef('TOKAMAK_LISTING_URL'), 'not a url')
    await expect(ctx.llm.listModels('tokamak')).rejects.toMatchObject({ code: 'INVALID_CONFIG' })
    // An exact-model read resolves provisionally; the request reports the bad endpoint.
    expect((await ctx.llm.resolveModelInfo('tokamak', 'tokamak/auto')).id).toBe('tokamak/auto')
    const bad = (await assemble(ctx, { provider: 'tokamak', model: 'tokamak/auto', messages: [] })).finish
    expect(bad.kind === 'error' ? bad.failure.code : bad.kind).toBe('INVALID_CONFIG')
    await ctx.credentials.set(credentialRef('TOKAMAK_LISTING_URL'), server.url)
    expect((await ctx.llm.listModels('tokamak')).map(model => model.id)).toEqual(['tokamak/auto', 'anthropic/opus'])
  })

  it('shares one request between concurrent reads', async () => {
    const server = await router()
    const gate = Promise.withResolvers<undefined>()
    server.gate = gate.promise
    const { ctx } = await boot(route(server.url), { key: 'tk-one' })

    const reads = [ctx.llm.listModels('tokamak'), ctx.llm.listModels('tokamak')]
    await vi.waitFor(() => { expect(server.listings).toHaveLength(1) })
    gate.resolve(undefined)
    expect((await Promise.all(reads)).map(models => models.length)).toEqual([2, 2])
    expect(server.listings).toHaveLength(1)
  })

  it('discards a listing request that a sign-out superseded, whether it succeeds or fails', async () => {
    const server = await router()
    const { ctx } = await boot(route(server.url), { key: 'tk-one' })
    for (const fail of [undefined, 503]) {
      const gate = Promise.withResolvers<undefined>()
      server.gate = gate.promise
      server.fail = fail
      await ctx.credentials.set(credentialRef('TOKAMAK_LISTING_KEY'), 'tk-one')
      const stale = ctx.llm.listModels('tokamak')
      await vi.waitFor(() => { expect(server.listings.length).toBeGreaterThan(0) })
      await ctx.credentials.unset(credentialRef('TOKAMAK_LISTING_KEY'))
      await expect(ctx.llm.listModels('tokamak')).rejects.toMatchObject({ code: 'MISSING_CREDENTIAL' })
      gate.resolve(undefined)
      // The superseded request stores nothing; its reader answers for the signed-out state.
      await expect(stale).rejects.toMatchObject({ code: 'MISSING_CREDENTIAL' })
      server.listings.length = 0
    }
  })

  it('settles an in-flight listing request when the plugin unloads', async () => {
    const server = await router()
    server.hang = true
    const { ctx } = await boot(route(server.url), { key: 'tk-one' })
    const pending = ctx.llm.listModels('tokamak')
    await vi.waitFor(() => { expect(server.listings.length).toBeGreaterThan(0) })
    const adapter = pending.catch((error: unknown) => error)
    await ctx.fiber.dispose()
    expect(await adapter).toMatchObject({ code: 'ABORTED' })
  })

  it('stops the background refresh when settings remove the last listing route', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const server = await router()
    vi.stubEnv('TOKAMAK_LISTING_KEY', '')
    const dir = await mkdtemp(join(tmpdir(), 'jan-pi-listing-'))
    cleanups.push(() => rm(dir, { recursive: true, force: true }))
    await writeFile(join(dir, '.credentials.yaml'), 'version: 1\nrefs:\n  TOKAMAK_LISTING_KEY: tk-one\n', { mode: 0o600 })
    const ctx = new Context()
    cleanups.push(async () => { await ctx.fiber.dispose() })
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LocalCredentialProvider, { path: join(dir, '.credentials.yaml'), watch: false })
    const live = await liveConfig(ctx, LlmPiAi, route(server.url, { refreshIntervalMs: 20 }))
    const scheduled = vi.getTimerCount()
    await vi.waitFor(() => { expect(server.listings).toHaveLength(1) })
    vi.advanceTimersByTime(20)
    await vi.waitFor(() => { expect(server.listings).toHaveLength(2) })

    await live.replace({ providers: { tokamak: { api: 'openai-completions', baseURL: server.url, models: [{ id: 'fixed' }] } } })
    expect(vi.getTimerCount()).toBe(scheduled - 1)
    vi.advanceTimersByTime(100)
    expect((await ctx.llm.listModels('tokamak')).map(model => model.id)).toEqual(['fixed'])
    expect(server.listings).toHaveLength(2)
  })

  it('bounds a listing request by its timeout', async () => {
    const server = await router()
    server.hang = true
    const { ctx } = await boot(route(server.url, { timeoutMs: 50 }), { key: 'tk-one' })

    await expect(ctx.llm.listModels('tokamak')).rejects.toMatchObject({
      code: 'DISCOVERY_FAILED',
      message: `${server.url} did not list its models within 50 ms`,
    })
  })

  it('refreshes in the background and announces a changed model set', async () => {
    const server = await router()
    const { ctx, updates } = await boot(route(server.url, { refreshIntervalMs: 40 }), { key: 'tk-one' })
    await vi.waitFor(() => { expect(server.listings.length).toBeGreaterThan(0) })
    const before = updates()

    server.models = [{ id: 'tokamak/auto' }, { id: 'openai/new', context_window: 64000 }]
    await vi.waitFor(() => { expect(updates()).toBeGreaterThan(before) })
    expect((await ctx.llm.listModels('tokamak')).map(model => model.id)).toEqual(['tokamak/auto', 'openai/new'])
    expect((await ctx.llm.resolveModelInfo('tokamak', 'openai/new')).context?.contextWindow).toBe(64000)
  })

  it('refetches a fresh listing on every background tick of its interval', async () => {
    const server = await router()
    await boot(route(server.url, { refreshIntervalMs: 30 }), { key: 'tk-one' })
    // A tick skipping a listing fetched just under one interval ago would halve the rate.
    await vi.waitFor(() => { expect(server.listings.length).toBeGreaterThanOrEqual(5) }, { timeout: 2000 })
  })

  it('reschedules a route whose interval changes, keeping one timer per route', async () => {
    const server = await router()
    vi.stubEnv('TOKAMAK_LISTING_KEY', '')
    const dir = await mkdtemp(join(tmpdir(), 'jan-pi-listing-'))
    cleanups.push(() => rm(dir, { recursive: true, force: true }))
    await writeFile(join(dir, '.credentials.yaml'), 'version: 1\nrefs:\n  TOKAMAK_LISTING_KEY: tk-one\n', { mode: 0o600 })
    const ctx = new Context()
    cleanups.push(async () => { await ctx.fiber.dispose() })
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LocalCredentialProvider, { path: join(dir, '.credentials.yaml'), watch: false })
    const live = await liveConfig(ctx, LlmPiAi, route(server.url, { refreshIntervalMs: 600000 }))
    await vi.waitFor(() => { expect(server.listings).toHaveLength(1) })
    // An unrelated edit keeps the schedule.
    await live.update({ providers: { tokamak: { displayName: 'Tokamak router' } } })
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(server.listings).toHaveLength(1)

    await live.update({ providers: { tokamak: { modelListing: { refreshIntervalMs: 20 } } } })
    await vi.waitFor(() => { expect(server.listings.length).toBeGreaterThan(3) })
  })

  it('stops refreshing when the plugin unloads', async () => {
    const server = await router()
    const { ctx } = await boot(route(server.url, { refreshIntervalMs: 20 }), { key: 'tk-one' })
    await vi.waitFor(() => { expect(server.listings.length).toBeGreaterThan(0) })
    await ctx.fiber.dispose()
    const settled = server.listings.length
    await new Promise(resolve => setTimeout(resolve, 80))
    expect(server.listings.length).toBe(settled)
  })

  it('moves an unlisted agent default to the first preferred served model', async () => {
    const server = await router()
    server.models = [{ id: 'openai/gpt-image-2' }, ...server.models]
    const { defaults } = await boot(route(server.url, {
      preferredDefaults: ['missing', 'openai/gpt-image-2', 'anthropic/opus'],
      exclude: ['openai/gpt-image-*'],
    }), { key: 'tk-one', defaults: true })

    await vi.waitFor(() => { expect(defaults?.saves).toEqual([{ provider: 'tokamak', model: 'anthropic/opus' }]) })
  })

  it('moves an unlisted agent default to the first listed model without a listed preference, and leaves a listed one', async () => {
    const server = await router()
    const { ctx, defaults } = await boot(route(server.url), { key: 'tk-one', defaults: true })
    await vi.waitFor(() => { expect(defaults?.saves).toEqual([{ provider: 'tokamak', model: 'tokamak/auto' }]) })

    server.keys.add('tk-two')
    server.models = [{ id: 'anthropic/opus' }, { id: 'tokamak/auto' }]
    await ctx.credentials.set(credentialRef('TOKAMAK_LISTING_KEY'), 'tk-two')
    await ctx.llm.listModels('tokamak')
    expect(defaults?.saves).toHaveLength(1)
  })

  it('logs a default it could not move', async () => {
    const server = await router()
    const ctx = new Context()
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => undefined)
    const failing = class extends FakeDefaults {
      override saveSelection(): Promise<void> { return Promise.reject(new Error('profile is read-only')) }
    }
    vi.stubEnv('TOKAMAK_LISTING_KEY', 'tk-one')
    cleanups.push(async () => { await ctx.fiber.dispose() })
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(failing)
    await ctx.plugin(LlmPiAi, route(server.url))
    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalledWith('llm-pi-ai: could not move the default model to a model provider route "tokamak" lists')
    })
  })

  it('moves no default when every listed model is excluded', async () => {
    const server = await router()
    const { ctx, defaults } = await boot(route(server.url, { exclude: ['*'] }), { key: 'tk-one', defaults: true })
    expect(await ctx.llm.listModels('tokamak')).toEqual([])
    expect(defaults?.saves).toEqual([])
  })

  it('serves the stored listing after a restart while the endpoint is down, then replaces it at launch', async () => {
    const server = await router()
    const root = await storageRoot()
    const first = await boot(route(server.url), { key: 'tk-one', storage: root })
    expect((await first.ctx.llm.listModels('tokamak')).map(model => model.id)).toEqual(['tokamak/auto', 'anthropic/opus'])
    await first.saved
    await first.ctx.fiber.dispose()

    // Offline restart: the stored listing answers.
    server.fail = 503
    const offline = await boot(route(server.url), { key: 'tk-one', storage: root })
    await vi.waitFor(async () => {
      expect((await offline.ctx.llm.listModels('tokamak')).map(model => model.id)).toEqual(['tokamak/auto', 'anthropic/opus'])
    })
    await offline.ctx.fiber.dispose()

    // Online restart: launch refetches even though the stored listing is fresh.
    server.fail = undefined
    server.models = [{ id: 'tokamak/auto' }]
    const before = server.listings.length
    const online = await boot(route(server.url), { key: 'tk-one', storage: root })
    await vi.waitFor(async () => {
      expect((await online.ctx.llm.listModels('tokamak')).map(model => model.id)).toEqual(['tokamak/auto'])
    })
    expect(server.listings.length).toBeGreaterThan(before)
  })

  it('serves the stored listing while a slow launch refresh runs, without moving the default', async () => {
    const server = await router()
    const root = await storageRoot()
    const first = await boot(route(server.url, { refreshIntervalMs: 1 }), { key: 'tk-one', storage: root })
    await first.ctx.llm.listModels('tokamak')
    await first.saved
    await first.ctx.fiber.dispose()

    server.hang = true
    const restarted = await boot(route(server.url, { refreshIntervalMs: 60000, timeoutMs: 60000 }), { key: 'tk-one', defaults: true })
    // Storage opening announces the stored listing.
    const booted = restarted.updates()
    await mountStorage(restarted.ctx, root)
    await vi.waitFor(() => { expect(restarted.updates()).toBeGreaterThan(booted) })
    expect((await restarted.ctx.llm.listModels('tokamak')).map(model => model.id)).toEqual(['tokamak/auto', 'anthropic/opus'])
    // The default names an unlisted model, but only a fetched listing may move it.
    expect(restarted.defaults?.saves).toEqual([])
  })

  it('moves a stale default after an unchanged fetch of a stored listing', async () => {
    const server = await router()
    const root = await storageRoot()
    const first = await boot(route(server.url), { key: 'tk-one', storage: root })
    await first.ctx.llm.listModels('tokamak')
    await first.saved
    await first.ctx.fiber.dispose()

    // The launch fetch returns the stored models unchanged, yet still re-checks the default.
    const restarted = await boot(route(server.url), { key: 'tk-one', storage: root, defaults: true })
    await vi.waitFor(() => { expect(restarted.defaults?.saves).toEqual([{ provider: 'tokamak', model: 'tokamak/auto' }]) })
  })

  it('does not serve another account\'s stored listing, and forgets it on sign-out', async () => {
    const server = await router()
    server.keys.add('tk-two')
    const root = await storageRoot()
    const first = await boot(route(server.url), { key: 'tk-one', storage: root })
    await first.ctx.llm.listModels('tokamak')
    await first.saved
    await first.ctx.fiber.dispose()

    server.models = [{ id: 'anthropic/opus' }]
    const other = await boot(route(server.url), { key: 'tk-two', storage: root })
    expect((await other.ctx.llm.listModels('tokamak')).map(model => model.id)).toEqual(['anthropic/opus'])
    await other.saved
    await other.ctx.credentials.unset(credentialRef('TOKAMAK_LISTING_KEY'))
    await expect(other.ctx.llm.listModels('tokamak')).rejects.toMatchObject({ code: 'MISSING_CREDENTIAL' })
    await other.ctx.fiber.dispose()

    // Nothing remains to serve offline for the signed-out route.
    server.fail = 503
    const offline = await boot(route(server.url), { key: 'tk-two', storage: root })
    await expect(offline.ctx.llm.listModels('tokamak')).rejects.toMatchObject({ code: 'DISCOVERY_FAILED' })
  })

  it('keeps serving from memory when its storage cannot open or write', async () => {
    const server = await router()
    const ctx = new Context()
    cleanups.push(async () => { await ctx.fiber.dispose() })
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => undefined)
    vi.stubEnv('TOKAMAK_LISTING_KEY', 'tk-one')
    await ctx.plugin(LlmRuntime)
    const broken = class extends Service {
      constructor(scope: Context) { super(scope, 'storageDomain') }
      open(): Promise<never> { return Promise.reject(new Error('already-open')) }
    }
    await ctx.plugin(broken)
    await ctx.plugin(LlmPiAi, route(server.url))
    expect((await ctx.llm.listModels('tokamak')).map(model => model.id)).toEqual(['tokamak/auto', 'anthropic/opus'])
    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalledWith('llm-pi-ai: model listings will not survive a restart; their storage did not open')
    })
  })

  it('writes a listing held before its storage opened, keeps the newer one, and reports a failed write', async () => {
    const server = await router()
    const gate = Promise.withResolvers<undefined>()
    const saved: string[] = []
    const closed = vi.fn()
    const ctx = new Context()
    cleanups.push(async () => { await ctx.fiber.dispose() })
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => undefined)
    vi.stubEnv('TOKAMAK_LISTING_KEY', 'tk-one')
    await ctx.plugin(LlmRuntime)
    const slow = class extends Service {
      constructor(scope: Context) { super(scope, 'storageDomain') }
      async open(): Promise<unknown> {
        await gate.promise
        const stale = { fingerprint: '0'.repeat(64), fetchedAt: 1, models: [{ id: 'stale' }] }
        return {
          table: () => ({
            entries: () => new Map([['tokamak', stale]]).entries(),
            put: (key: string) => { saved.push(key); return Promise.reject(new Error('disk full')) },
            delete: () => Promise.resolve(true),
          }),
          close: () => { closed(); return Promise.resolve() },
        }
      }
    }
    await ctx.plugin(slow)
    await ctx.plugin(LlmPiAi, route(server.url))
    expect((await ctx.llm.listModels('tokamak')).map(model => model.id)).toEqual(['tokamak/auto', 'anthropic/opus'])
    gate.resolve(undefined)
    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalledWith('llm-pi-ai: could not save the model listing of provider route "tokamak"')
    })
    expect(saved).toEqual(['tokamak'])
    // The fetched listing wins over the older stored one.
    expect((await ctx.llm.listModels('tokamak')).map(model => model.id)).toEqual(['tokamak/auto', 'anthropic/opus'])
    await ctx.fiber.dispose()
    expect(closed).toHaveBeenCalledTimes(1)
  })

  it('closes storage that opens only after the plugin unloaded', async () => {
    const server = await router()
    const gate = Promise.withResolvers<undefined>()
    const closed = vi.fn()
    const ctx = new Context()
    vi.stubEnv('TOKAMAK_LISTING_KEY', 'tk-one')
    await ctx.plugin(LlmRuntime)
    const slow = class extends Service {
      constructor(scope: Context) { super(scope, 'storageDomain') }
      async open(): Promise<unknown> {
        await gate.promise
        return { table: () => ({ entries: () => [][Symbol.iterator]() }), close: () => { closed(); return Promise.resolve() } }
      }
    }
    await ctx.plugin(slow)
    const fiber = await ctx.plugin(LlmPiAi, route(server.url))
    const unloading = fiber.dispose()
    gate.resolve(undefined)
    await unloading
    await vi.waitFor(() => { expect(closed).toHaveBeenCalledTimes(1) })
    await ctx.fiber.dispose()
  })

  it('stores a listing so that it reads back field for field', async () => {
    const root = await storageRoot()
    const listing = {
      fingerprint: 'a'.repeat(64),
      fetchedAt: 5,
      models: [
        { id: 'bare' },
        { id: 'full', name: 'Full', contextWindow: 64000, maxTokens: 4000, inputModalities: ['text', 'image'] as const },
      ],
    }
    for (const step of ['write', 'read'] as const) {
      const ctx = new Context()
      await mountStorage(ctx, root)
      const { store, close } = await openListingStore(ctx.storageDomain)
      if (step === 'write') await store.save('tokamak', listing)
      else expect([...store.entries()]).toEqual([['tokamak', listing]])
      await close()
      await ctx.fiber.dispose()
    }
  })

  it('leaves an agent default on another route alone', async () => {
    const server = await router()
    const { ctx, defaults } = await boot(route(server.url), { key: 'tk-one', defaults: true })
    defaults!.selection = { provider: 'local', model: 'local' }
    await ctx.llm.listModels('tokamak')
    expect(defaults?.saves).toEqual([])
  })
})
