/** Native onboarding reuses authenticated Web RPC and never reads credential values. */
import { describe, expect, it, vi } from 'vitest'
import { connectDesktopWelcome } from '../src/welcome-backend.ts'

function transport(preference?: string, llamaCpp?: Record<string, unknown>) {
  const keys = new Map<string, string>()
  const installs: string[] = []
  const namespaces: Array<{ ns: string; value: Record<string, unknown> }> = [
    { ns: 'llm-deepseek', value: { apiKeyEnv: 'CUSTOM_DEEPSEEK_KEY' } },
    { ns: 'llm-pi-ai', value: { profiles: { example: { apiKeyEnv: 'EXAMPLE_API_KEY' } } } },
    { ns: 'locale', value: preference === undefined ? {} : { preference } },
  ]
  const send = vi.fn<NonNullable<Parameters<typeof connectDesktopWelcome>[2]>>(async (_input, init) => {
    const { rpcId, method, payload } = JSON.parse(init!.body as string) as {
      rpcId: string
      method: string
      payload: { args: { ref: string; value: string; refs: string[] } }
    }
    let value: unknown
    if (method === 'account/getState') value = { links: { usageUrl: 'http://localhost/usage', topUpUrl: 'http://localhost/top_up' }, status: 'signed-out', attempt: null }
    else if (method === 'settings/describe') value = { namespaces }
    else if (method === 'llm/listConfigurableProviders') value = [{ settingsNs: 'llm-pi-ai', settingsPath: ['profiles', 'example'] }]
    else if (method === 'productAnalytics/enabled') value = true
    else if (method === 'productAnalytics/report') value = undefined
    else if (method === 'credentials/set') keys.set(payload.args.ref, payload.args.value)
    else if (method.startsWith('llamaCpp/')) {
      if (llamaCpp === undefined) return Response.json({ type: 'server-response', rpcId, result: { ok: false, error: { code: 'not-found' } } })
      if (method === 'llamaCpp/beginInstall') installs.push(method)
      value = llamaCpp
    }
    else value = Object.fromEntries(payload.args.refs.map(ref => [ref, { configured: keys.has(ref), writable: true }]))
    return Response.json({ type: 'server-response', rpcId, result: { ok: true, value } })
  })
  return { send, keys, namespaces, installs }
}

const url = 'http://127.0.0.1:19387/'
const cookie = 'dsh-auth-fixture=signed'

describe('desktop welcome local model', () => {
  const state = {
    phase: 'downloading', provider: 'local', error: 'kept only in failed',
    model: { id: 'jan-v3.5-4b', name: 'Jan v3.5 4B', modelBytes: 2_000, engineBytes: 500, backend: 'metal', engineVersion: 'b1' },
    progress: { phase: 'model', receivedBytes: 100, totalBytes: 2_000, overallReceivedBytes: 600, overallTotalBytes: 2_500, bytesPerSecond: 50 },
    models: [], downloads: [], catalog: [], logTail: '/private/path',
  }

  it('reports no local model when the build mounts none', async () => {
    const backend = connectDesktopWelcome(url, cookie, transport().send)
    expect(await backend.localModel.read()).toBeUndefined()
    expect(await backend.read()).toMatchObject({ hasLocalModel: false })
  })

  it('starts the first-run download and projects only the safe state', async () => {
    const host = transport(undefined, state)
    const backend = connectDesktopWelcome(url, cookie, host.send)
    await backend.localModel.start()
    expect(host.installs).toEqual(['llamaCpp/beginInstall'])
    expect(await backend.localModel.read()).toEqual({
      phase: 'downloading', name: 'Jan v3.5 4B', totalBytes: 2_500, error: 'kept only in failed',
      progress: { step: 'model', receivedBytes: 600, totalBytes: 2_500, bytesPerSecond: 50 },
    })
    expect(await backend.read()).toMatchObject({ hasLocalModel: false })
  })

  it('counts an installed local model as a way into the workspace', async () => {
    const backend = connectDesktopWelcome(url, cookie, transport(undefined, { ...state, phase: 'running', models: [{ id: 'jan-v3.5-4b' }] }).send)
    expect(await backend.read()).toMatchObject({ hasLocalModel: true, hasApiKey: false })
  })
})

describe('desktop welcome Web operations', () => {
  it('authenticates with the explicit Host cookie and stores only through the configured credential reference', async () => {
    const host = transport()
    const backend = connectDesktopWelcome(url, cookie, host.send)
    expect(await backend.analyticsEnabled()).toBe(true)
    expect(await backend.save('sk-example')).toEqual({ ok: true })
    expect(host.keys.get('CUSTOM_DEEPSEEK_KEY')).toBe('sk-example')
    expect(await backend.read()).toEqual({ loggedIn: false, hasApiKey: true, hasLocalModel: false, writable: true, localePreference: null })
    for (const [input, init] of host.send.mock.calls) {
      expect(input).toMatch(/^http:\/\/127\.0\.0\.1:19387\/api\//u)
      expect(init).toMatchObject({ redirect: 'error', headers: { cookie } })
      expect(init).not.toHaveProperty('credentials')
    }
  })

  it('reads the explicit language preference and recognizes another provider key', async () => {
    const host = transport('zh')
    host.keys.set('EXAMPLE_API_KEY', 'sk-other')
    const backend = connectDesktopWelcome(url, cookie, host.send)
    expect(await backend.read()).toMatchObject({ localePreference: 'zh', hasApiKey: true })
    host.keys.clear()
    expect(await backend.read()).toMatchObject({ hasApiKey: false })
    expect(host.send.mock.calls.every(([, init]) => !(init?.body as string | undefined)?.includes('credentials/set'))).toBe(true)
  })

  it('reads language without querying account or model providers', async () => {
    const host = transport('zh')
    const backend = connectDesktopWelcome(url, cookie, host.send)
    host.send.mockClear()
    expect(await backend.readLocalePreference()).toBe('zh')
    expect(host.send).toHaveBeenCalledOnce()
    expect(host.send.mock.calls[0]![0]).toContain('/api/settings/describe')
  })

  it('allows profiles without the official provider and retains custom key detection', async () => {
    const host = transport()
    host.namespaces.splice(0, 1)
    const backend = connectDesktopWelcome(url, cookie, host.send)
    expect(await backend.read()).toMatchObject({ hasApiKey: false, writable: false })
    host.keys.set('EXAMPLE_API_KEY', 'custom-key')
    expect(await backend.read()).toMatchObject({ hasApiKey: true, writable: false })
    expect(await backend.save('official-key')).toEqual({ ok: false })
    expect(host.keys.has('undefined')).toBe(false)
  })

  it('stores the welcome key on the Tokamak route when the official provider is not mounted', async () => {
    const host = transport()
    host.namespaces.splice(0, 2, { ns: 'llm-pi-ai', value: { providers: { tokamak: { apiKeyEnv: 'TOKAMAK_API_KEY' } } } })
    const backend = connectDesktopWelcome(url, cookie, host.send)
    expect(await backend.read()).toMatchObject({ hasApiKey: false, writable: true })
    expect(await backend.save('sk_live_example')).toEqual({ ok: true })
    expect(host.keys.get('TOKAMAK_API_KEY')).toBe('sk_live_example')
    expect(await backend.read()).toMatchObject({ hasApiKey: true })
  })

  it.each(['', 'bad key', 'key\n'])('rejects malformed keys without contacting a provider: %s', async (value) => {
    const host = transport()
    const backend = connectDesktopWelcome(url, cookie, host.send)
    host.send.mockClear()
    expect(await backend.save(value)).toEqual({ ok: false })
    expect(host.send).not.toHaveBeenCalled()
  })

  it('keeps provider diagnostics out of failures and rejects unmatched RPC envelopes', async () => {
    const host = transport()
    const backend = connectDesktopWelcome(url, cookie, host.send)
    host.send.mockRejectedValueOnce(new Error('private credential sk-must-not-leak'))
    expect(await backend.save('sk-example')).toEqual({ ok: false })
    host.send.mockResolvedValueOnce(Response.json({ type: 'server-response', rpcId: 'other', result: { ok: true } }))
    await expect(backend.read()).rejects.toThrow('Web RPC failed')
  })

  it('submits native analytics through authenticated RPC with a bounded request', async () => {
    const host = transport()
    const backend = connectDesktopWelcome(url, cookie, host.send)
    const event = { eventName: 'desktop_app_launch' as const, timestamp: 100, attributes: {} }
    await backend.report(event)
    const [input, init] = host.send.mock.calls.at(-1)!
    expect(input).toBe('http://127.0.0.1:19387/api/productAnalytics/report')
    expect(init?.headers).toMatchObject({ cookie })
    expect(init?.signal).toBeInstanceOf(AbortSignal)
    expect(JSON.parse(init!.body as string)).toMatchObject({ payload: { args: { event } } })
  })
})
