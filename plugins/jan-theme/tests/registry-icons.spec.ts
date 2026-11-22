import { describe, expect, it, vi } from 'vitest'
import { createIconFetcher, iconSources, linkedIcons, publicHttpsUrl } from '../registry-icons.mjs'

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
