import { describe, expect, it, vi } from 'vitest'
import { createMcpRegistry, FEATURED_MCP_SERVERS, registryEntry } from '../mcp-registry.mjs'
import { installRecommended } from '../recommended-connectors.mjs'

const active = { 'io.modelcontextprotocol.registry/official': { status: 'active' } }

describe('MCP Registry entries', () => {
  it('turns remotes and npm, PyPI and OCI packages into commands Jan can save', () => {
    const entry = registryEntry({
      server: {
        name: 'io.github.acme/Weather Tools', title: 'Weather', description: 'Forecasts', version: '1.2.0',
        remotes: [
          { type: 'streamable-http', url: 'https://mcp.acme.dev/mcp', headers: [{ name: 'Authorization', value: 'Bearer {api_key}', isRequired: true, isSecret: true }] },
          { type: 'sse', url: 'https://mcp.acme.dev/sse' },
          { type: 'streamable-http', url: 'https://mcp.acme.dev/mcp?ref=registry' },
        ],
        packages: [
          { registryType: 'npm', identifier: '@acme/weather', version: '1.2.0', transport: { type: 'stdio' }, environmentVariables: [{ name: 'ACME_KEY', isRequired: true, isSecret: true }] },
          { registryType: 'pypi', identifier: 'acme-weather', version: '1.2.0', transport: { type: 'stdio' }, packageArguments: [{ type: 'named', name: '--units', default: 'metric' }] },
          { registryType: 'oci', identifier: 'ghcr.io/acme/weather', version: '1.2.0', transport: { type: 'stdio' }, environmentVariables: [{ name: 'ACME_KEY' }] },
          { registryType: 'npm', identifier: '@acme/needs-path', version: '1.0.0', transport: { type: 'stdio' }, packageArguments: [{ type: 'positional', isRequired: true, valueHint: 'directory' }] },
          { registryType: 'mcpb', identifier: 'https://acme.dev/weather.mcpb', transport: { type: 'stdio' } },
        ],
      },
      _meta: active,
    })
    expect(entry).toMatchObject({ id: 'io.github.acme/Weather Tools', title: 'Weather', publisher: 'github.com/acme', slug: 'weather-tools' })
    expect(entry.options.map(option => [option.kind, option.command ?? option.url, option.args])).toEqual([
      ['remote', 'https://mcp.acme.dev/mcp', undefined],
      ['npm', 'npx', ['-y', '@acme/weather@1.2.0']],
      ['pypi', 'uvx', ['acme-weather==1.2.0', '--units', 'metric']],
      ['oci', 'docker', ['run', '-i', '--rm', '-e', 'ACME_KEY', 'ghcr.io/acme/weather:1.2.0']],
    ])
    expect(entry.options[0].fields).toEqual([{ target: 'header', name: 'Authorization', description: '', required: true, secret: true, value: 'Bearer {api_key}', placeholder: '' }])
    expect(entry.options[1].fields[0]).toMatchObject({ target: 'env', name: 'ACME_KEY', required: true, secret: true })
  })

  it('drops deleted servers and keeps the domain a namespace was verified against', () => {
    expect(registryEntry({ server: { name: 'com.acme/x', remotes: [{ type: 'streamable-http', url: 'https://a.dev/mcp' }] }, _meta: { 'io.modelcontextprotocol.registry/official': { status: 'deleted' } } })).toBeUndefined()
    const notion = registryEntry({ server: { name: 'com.notion/mcp', remotes: [{ type: 'streamable-http', url: 'https://mcp.notion.com/mcp' }] }, _meta: active })
    expect(notion).toMatchObject({ publisher: 'notion.com', title: 'Notion', slug: 'notion' })
  })
})

describe('MCP Registry search', () => {
  const page = (names: string[], nextCursor?: string) => ({
    servers: names.map(name => ({ server: { name, remotes: [{ type: 'streamable-http', url: `https://${name.split('/')[1]}.dev/mcp` }] }, _meta: active })),
    metadata: { nextCursor },
  })
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

  it('searches the latest versions, pages by cursor and caches a page', async () => {
    const fetch = vi.fn(async (_url: string) => ok(page(['com.a/one', 'com.b/two'], 'com.b/two:1.0.0')))
    const registry = createMcpRegistry({ fetch: fetch as never })
    const first = await registry.search({ query: 'one' })
    expect(first).toMatchObject({ featured: false, nextCursor: 'com.b/two:1.0.0' })
    expect(first.entries.map((entry: { id: string }) => entry.id)).toEqual(['com.a/one', 'com.b/two'])
    const url = new URL(fetch.mock.calls[0][0])
    expect(url.origin + url.pathname).toBe('https://registry.modelcontextprotocol.io/v0/servers')
    expect(Object.fromEntries(url.searchParams)).toEqual({ limit: '30', version: 'latest', search: 'one' })
    await registry.search({ query: 'one' })
    expect(fetch).toHaveBeenCalledTimes(1)
    await registry.search({ query: 'one', cursor: 'com.b/two:1.0.0' })
    expect(new URL(fetch.mock.calls[1][0]).searchParams.get('cursor')).toBe('com.b/two:1.0.0')
  })

  it('lists the featured servers without a query and skips any the registry no longer has', async () => {
    const fetch = vi.fn(async (url: string) => {
      const name = decodeURIComponent(url.split('/v0/servers/')[1].split('/versions/')[0])
      if (name === FEATURED_MCP_SERVERS[1]) return new Response('', { status: 404 })
      return ok({ server: { name, remotes: [{ type: 'streamable-http', url: 'https://example.dev/mcp' }] }, _meta: active })
    })
    const result = await createMcpRegistry({ fetch: fetch as never }).search({})
    expect(result.featured).toBe(true)
    expect(result.entries.map((entry: { id: string }) => entry.id)).toEqual(FEATURED_MCP_SERVERS.filter((_, index) => index !== 1))
  })

  it('reports an unreachable registry in words a person can act on', async () => {
    const registry = createMcpRegistry({ fetch: (async () => { throw new TypeError('fetch failed') }) as never })
    await expect(registry.search({ query: 'x' })).rejects.toThrow('The MCP Registry could not be reached')
    const failing = createMcpRegistry({ fetch: (async () => new Response('', { status: 503 })) as never })
    await expect(failing.search({ query: 'x' })).rejects.toThrow('answered 503')
  })
})

describe('recommended connectors', () => {
  it('runs the pinned OpenMotion setup for Jan and returns its MCP command and skill folder', async () => {
    const run = vi.fn(async () => `progress\n${JSON.stringify({ agentRegistration: { serverName: 'openmotion', transport: { type: 'stdio', command: '/usr/bin/node', args: ['/p/connectors/openmotion/app/run-mcp.mjs'] }, skillsDirectory: '/p/connectors/openmotion/skills' } })}`)
    const result = await installRecommended('openmotion', { baseDir: '/p/connectors', run })
    expect(run).toHaveBeenCalledWith('npx', ['--yes', '--package', '@openmotion/app@0.2.1', '--', 'openmotion', 'setup', '--host', 'jan', '--utm-source', 'jan', '--home', '/p/connectors/openmotion/app', '--skills-dir', '/p/connectors/openmotion/skills'])
    expect(result).toEqual({
      server: { name: 'openmotion', enabled: true, transport: 'stdio', command: '/usr/bin/node', args: ['/p/connectors/openmotion/app/run-mcp.mjs'] },
      skillsDirectory: '/p/connectors/openmotion/skills',
    })
  })

  it('names the missing runtime and refuses a setup result without a local command', async () => {
    const missing = Object.assign(new Error('spawn npx ENOENT'), { code: 'ENOENT' })
    await expect(installRecommended('openmotion', { baseDir: '/p', run: async () => { throw missing } })).rejects.toThrow('needs Node.js 22.18 or later with npm')
    await expect(installRecommended('openmotion', { baseDir: '/p', run: async () => '{"agentRegistration":{}}' })).rejects.toThrow('did not return a local MCP command')
    await expect(installRecommended('other', { baseDir: '/p' })).rejects.toThrow('Choose a recommended connector.')
  })
})
