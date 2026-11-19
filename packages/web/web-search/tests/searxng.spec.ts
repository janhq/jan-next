import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SearxngSearchProvider, normalizeSearxngSearch } from '../src/searxng.ts'
import { json, specsFor, startLoopback } from './loopback.ts'
import type { Loopback } from './loopback.ts'

let loopback: Loopback

beforeEach(async () => { loopback = await startLoopback() })
afterEach(async () => { await loopback.close() })

function searxng(overrides: Parameters<typeof specsFor>[1] = {}): ReturnType<typeof specsFor>['searxng'] {
  return specsFor(loopback.base, overrides).searxng
}

const REPLY = {
  results: [
    { title: 'One', url: 'https://a.example', content: 'first', publishedDate: '2024-01-01' },
    { title: 'Two', url: 'https://b.example', content: 'second', publishedDate: null },
    { title: 'Three', url: 'https://c.example', content: 'third' },
  ],
}

describe('SearXNG search', () => {
  it('maps results and cuts them to the requested count', () => {
    expect(normalizeSearxngSearch(REPLY, 2)).toEqual([
      { url: 'https://a.example', title: 'One', snippet: 'first', summary: 'first', publishedAt: '2024-01-01' },
      { url: 'https://b.example', title: 'Two', snippet: 'second', summary: 'second' },
    ])
    expect(normalizeSearxngSearch({ results: [{ url: 'relative' }, { url: 'https://d.example', title: ' ' }] }, 5)).toEqual([{ url: 'https://d.example' }])
  })

  it('sends a keyless GET to the instance\'s JSON search API', async () => {
    loopback.handler = (_request, res) => { json(res, REPLY) }
    const provider = new SearxngSearchProvider(searxng())
    expect(provider.available()).toBe(true)
    const result = await provider.search({ query: 'llama cpp', maxResults: 1 })
    expect(loopback.calls[0]?.path).toBe('/searx/search?q=llama+cpp&format=json')
    expect(loopback.calls[0]?.headers.authorization).toBeUndefined()
    expect(result).toEqual({ sources: [{ url: 'https://a.example', title: 'One', snippet: 'first', summary: 'first', publishedAt: '2024-01-01' }], truncated: false })
  })

  it('follows an instance redirect', async () => {
    loopback.handler = (request, res) => {
      if (request.path.startsWith('/searx/')) res.writeHead(301, { location: request.path.replace('/searx/', '/moved/') }).end()
      else json(res, REPLY)
    }
    expect((await new SearxngSearchProvider(searxng()).search({ query: 'q' })).sources[0]).toMatchObject({ url: 'https://a.example' })
    expect(loopback.calls.map(call => call.path)).toEqual(['/searx/search?q=q&format=json', '/moved/search?q=q&format=json'])
  })

  it('points at the JSON format setting when the instance answers HTML, and reports HTTP failures', async () => {
    loopback.handler = (_request, res) => { res.writeHead(200, { 'content-type': 'text/html' }).end('<html></html>') }
    await expect(new SearxngSearchProvider(searxng()).search({ query: 'q' }))
      .rejects.toThrow('SearXNG returned invalid JSON; enable the json format in the instance\'s search.formats setting')
    loopback.handler = (_request, res) => { res.writeHead(403).end('Forbidden') }
    await expect(new SearxngSearchProvider(searxng()).search({ query: 'q' })).rejects.toThrow('SearXNG request failed (HTTP 403): Forbidden')
  })
})
