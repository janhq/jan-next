import { lookup } from 'node:dns'
import { get } from 'node:https'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { proxyRouteFor } from '@janhq/jan-http-proxy'
import { createIconFetcher, iconSources, linkedIcons, publicHttpsUrl } from '../registry-icons.mjs'

vi.mock('node:dns', () => ({ lookup: vi.fn() }))
vi.mock('node:https', () => ({ get: vi.fn() }))
vi.mock('@janhq/jan-http-proxy', () => ({ proxyRouteFor: vi.fn(() => ({ proxied: false })) }))
afterEach(() => { vi.resetAllMocks(); vi.unstubAllGlobals() })

const png = (bytes = 4) => new Response(new Uint8Array(bytes).fill(7), { status: 200, headers: { 'content-type': 'image/png' } })
const html = (body: string) => new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })
const missing = () => new Response('<html>not found</html>', { status: 404, headers: { 'content-type': 'text/html' } })
const redirect = (location: string) => new Response(null, { status: 302, headers: { location } })

describe('logo sources', () => {
  it('orders declared icons, then the GitHub avatar, then the publisher sites', () => {
    expect(iconSources({
      name: 'io.github.acme/tool',
      icons: [{ src: 'https://acme.dev/16.png', sizes: ['16x16'] }, { src: 'https://acme.dev/logo.svg', sizes: ['any'] }, { src: 'http://acme.dev/plain.png' }],
      websiteUrl: 'https://docs.acme.dev/mcp',
    })).toEqual({
      icons: ['https://acme.dev/logo.svg', 'https://acme.dev/16.png', 'https://github.com/acme.png?size=128'],
      sites: ['docs.acme.dev', 'acme.dev'],
    })
    expect(iconSources({ name: 'com.figma.mcp/mcp' })).toEqual({ icons: [], sites: ['mcp.figma.com', 'figma.com'] })
    expect(iconSources({ websiteUrl: 'https://github.com/nexu-io/openmotion' })).toEqual({ icons: ['https://github.com/nexu-io.png?size=128'], sites: [] })
  })

  it('fetches only public https hosts named by DNS', () => {
    for (const bad of ['http://acme.dev/a.png', 'https://localhost/a.png', 'https://127.0.0.1/a.png', 'https://[::1]/a.png', 'https://printer.local/a.png', 'https://router/a.png', 'https://u:p@acme.dev/a.png']) {
      expect(publicHttpsUrl(bad)).toBeUndefined()
    }
    expect(publicHttpsUrl('/icon.png', 'https://acme.dev/')?.href).toBe('https://acme.dev/icon.png')
  })

  it('prefers apple-touch icons and larger sizes a homepage links', () => {
    const page = `<link rel="icon" href="/favicon.ico" sizes="16x16 32x32"><link rel="stylesheet" href="/a.css">
      <link href='/big.png' rel='icon' sizes='192x192'><link rel="apple-touch-icon" href="/touch.png?a=1&amp;b=2">`
    expect(linkedIcons(page, 'https://acme.dev/')).toEqual(['https://acme.dev/touch.png?a=1&b=2', 'https://acme.dev/big.png', 'https://acme.dev/favicon.ico'])
  })
})

describe('logo fetcher', () => {
  it('falls through a missing declared icon to the homepage link and caches the answer', async () => {
    const fetch = vi.fn(async (url: string) => ({
      'https://acme.dev/gone.png': missing(),
      'https://acme.dev/': html(`<head><link rel="apple-touch-icon" href="/touch.png"></head>${'x'.repeat(600 * 1024)}`),
      'https://acme.dev/touch.png': png(),
    } as Record<string, Response>)[url] ?? missing())
    const logos = createIconFetcher({ fetch: fetch as never })
    const sources = { icons: ['https://acme.dev/gone.png'], sites: ['acme.dev'] }
    expect(await logos.icon('acme', sources)).toBe(`data:image/png;base64,${Buffer.from(new Uint8Array(4).fill(7)).toString('base64')}`)
    await logos.icon('acme', sources)
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(['https://acme.dev/gone.png', 'https://acme.dev/', 'https://acme.dev/touch.png'])
  })

  it('refuses redirects to local hosts, non-images and oversized images', async () => {
    const fetch = vi.fn(async (url: string) => ({
      'https://a.dev/r.png': redirect('https://127.0.0.1/secret.png'),
      'https://a.dev/page.png': html('<p>hi</p>'),
      'https://a.dev/huge.png': png(300 * 1024),
      'https://a.dev/hop.png': redirect('/ok.png'),
      'https://a.dev/ok.png': png(),
    } as Record<string, Response>)[url] ?? missing())
    const logos = createIconFetcher({ fetch: fetch as never })
    expect(await logos.icon('bad', { icons: ['https://a.dev/r.png', 'https://a.dev/page.png', 'https://a.dev/huge.png'], sites: [] })).toBeUndefined()
    expect(fetch.mock.calls.map(([url]) => url)).not.toContain('https://127.0.0.1/secret.png')
    expect(await logos.icon('hop', { icons: ['https://a.dev/hop.png'], sites: [] })).toMatch(/^data:image\/png;base64,/)
  })

  it.each([
    { address: '127.0.0.1', family: 4 },
    { address: '10.1.2.3', family: 4 },
    { address: '169.254.1.1', family: 4 },
    { address: '::1', family: 6 },
    { address: '::ffff:127.0.0.1', family: 6 },
    { address: 'fd00::1', family: 6 },
    { address: 'fe80::1', family: 6 },
  ])('does not connect to a hostname resolved to $address', async address => {
    const connect = stubIconTransport({ 'logo.example.com': address })
    const logos = createIconFetcher()
    expect(await logos.icon('icon', { icons: ['https://logo.example.com/icon.png'], sites: [] })).toBeUndefined()
    expect(lookup).toHaveBeenCalledTimes(1)
    expect(connect).not.toHaveBeenCalled()
  })

  it('returns the image from a validated public address', async () => {
    const connect = stubIconTransport({ 'logo.example.com': { address: '2606:4700::1111', family: 6 } })
    const logos = createIconFetcher()
    expect(await logos.icon('icon', { icons: ['https://logo.example.com/icon.png'], sites: [] })).toBe('data:image/png;base64,BwcHBw==')
    expect(connect).toHaveBeenCalledTimes(1)
  })

  it('does not bypass an applicable proxy for a redirect destination', async () => {
    vi.mocked(proxyRouteFor).mockImplementation(url => url.hostname === 'other.example.com'
      ? { proxied: true, proxy: 'https://proxy.example.com', dispatcher: {} as never }
      : { proxied: false })
    const connect = stubIconTransport({ 'logo.example.com': { address: '93.184.215.14', family: 4 } })
    const logos = createIconFetcher()
    expect(await logos.icon('icon', { icons: ['https://logo.example.com/to-other'], sites: [] })).toBeUndefined()
    expect(connect).toHaveBeenCalledTimes(1)
    expect(lookup).toHaveBeenCalledTimes(1)
  })

  it('rechecks DNS on every redirect and caps the number of hops', async () => {
    const connect = stubIconTransport({
      'logo.example.com': { address: '93.184.215.14', family: 4 },
      'other.example.com': { address: '172.16.0.1', family: 4 },
    })
    const logos = createIconFetcher()
    expect(await logos.icon('redirect', { icons: ['https://logo.example.com/to-other'], sites: [] })).toBeUndefined()
    expect(connect.mock.calls.map(([url]) => url.hostname)).toEqual(['logo.example.com'])
    expect(lookup).toHaveBeenLastCalledWith('other.example.com', expect.anything(), expect.any(Function))

    connect.mockClear()
    expect(await logos.icon('loop', { icons: ['https://logo.example.com/loop'], sites: [] })).toBeUndefined()
    expect(connect).toHaveBeenCalledTimes(4)
  })

  it('retries a miss caused by a network failure after minutes, and a real absence only after an hour', async () => {
    let clock = 0
    let down = true
    const fetch = vi.fn(async (url: string) => {
      if (url.startsWith('https://flaky.dev/') && down) throw new TypeError('fetch failed')
      return url === 'https://flaky.dev/logo.png' ? png() : missing()
    })
    const logos = createIconFetcher({ fetch: fetch as never, now: () => clock })
    const flaky = { icons: ['https://flaky.dev/logo.png'], sites: ['flaky.dev'] }
    expect(await logos.icon('flaky', flaky)).toBeUndefined()
    // The unreachable host is not tried again for its other icon paths.
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(['https://flaky.dev/logo.png', 'https://flaky.dev/'])
    down = false
    clock = 3 * 60_000
    expect(await logos.icon('flaky', flaky)).toMatch(/^data:image\/png/)
    expect(await logos.icon('absent', { icons: ['https://none.dev/x.png'], sites: [] })).toBeUndefined()
    const calls = fetch.mock.calls.length
    clock += 30 * 60_000
    await logos.icon('absent', { icons: ['https://none.dev/x.png'], sites: [] })
    expect(fetch.mock.calls.length).toBe(calls)
  })
})

// Simulate only the DNS and socket boundaries. No network or external DNS is used here.
function stubIconTransport(addresses: Record<string, { address: string; family: number }>) {
  vi.stubGlobal('fetch', vi.fn(async () => png()))
  const connect = vi.fn((url: URL, respond: (response: PassThrough) => void) => {
    const location = url.pathname === '/to-other' ? 'https://other.example.com/logo.png' : url.pathname === '/loop' ? '/loop' : undefined
    const response = Object.assign(new PassThrough(), location ? { statusCode: 302, headers: { location } }
      : { statusCode: 200, headers: { 'content-type': 'image/png' } })
    respond(response)
    response.end(location ? undefined : Buffer.from([7, 7, 7, 7]))
  })
  vi.mocked(lookup).mockImplementation(((hostname, options, callback) => {
    const answer = addresses[hostname]
    if (!answer) { callback(new Error(`No DNS fixture for ${hostname}`)); return }
    if (options.all) callback(null, [answer])
    else callback(null, answer.address, answer.family)
  }) as typeof lookup)
  vi.mocked(get).mockImplementation(((url: URL, options, respond) => {
    const request = new PassThrough()
    queueMicrotask(() => options.lookup(url.hostname, { all: true }, (error: Error | null) => {
      if (error) request.destroy(error)
      else connect(url, respond)
    }))
    return request
  }) as typeof get)
  return connect
}
