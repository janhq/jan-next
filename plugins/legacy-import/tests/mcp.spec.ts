import { fileURLToPath } from 'node:url'
import { isAbsolute, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readMcpSource, summarizeMcp } from '../mcp.mjs'

const home = fileURLToPath(new URL('./fixtures/mcp/', import.meta.url))
const environment = {
  LINEAR_TOKEN: 'process-claude-token', INHERITED: 'codex-inherited-token',
  CODEX_BEARER: 'codex-bearer-token', CODEX_HEADER: 'codex-header-token',
  OMP_TOKEN: 'omp-fixture-token', CURSOR_TOKEN: 'cursor-fixture-token',
}
const read = (source: string, folder?: string) => readMcpSource(source, { home, env: environment, platform: 'darwin', folder })

describe('migration reads configured MCP servers and connectors', () => {
  it('Claude Code merges user, settings and project entries, with settings env and default expansion', async () => {
    const result = await read('claude')
    expect(Object.keys(result.servers)).toEqual(['linear', 'same-name', 'settings-server', 'local', 'same-name-2'])
    expect(result.servers.linear.headers.Authorization).toBe('Bearer configured-claude-token')
    expect(result.servers['settings-server'].env).toEqual({ API_KEY: 'example-default' })
    expect(result.servers.local.env).toEqual({ TOKEN: 'claude-fixture-token' })
    expect(result.servers.local.cwd).toBe(isAbsolute('/project') ? '/project' : undefined)
    expect(result.rows.find(row => row.name === 'local')?.scope).toBe('/project')
    expect(result.servers['same-name-2'].command).toBe('project')
    expect(result.skipped).toContainEqual({ sourceName: 'linear', reason: 'duplicate definition in this source' })
  })

  it('Claude Desktop reads local server credentials and identifies unsupported SSE', async () => {
    const result = await read('claude-desktop')
    expect(result.servers['Desktop-Files'].env).toEqual({ KEY: 'desktop-fixture-token' })
    expect(result.skipped).toEqual([{ sourceName: 'old-transport', reason: 'unsupported transport' }])
  })

  it('Codex reads quoted TOML tables, env, bearer tokens and both header types', async () => {
    const result = await read('codex')
    expect(result.servers['Quoted-Server']).toMatchObject({ args: ['-y', 'test#server'], env: { INHERITED: 'codex-inherited-token', PRIVATE: 'codex-fixture-token' } })
    expect(result.servers.remote.headers).toEqual({ Authorization: 'Bearer codex-bearer-token', 'X-Static': 'codex-static-token', 'X-Env': 'codex-header-token' })
    expect(result.rows[0].omitted).toContain('remote environment variables')
    expect(result.skipped[0]).toMatchObject({ sourceName: 'missing' })
  })

  it('OMP keeps the server definition but not managed OAuth or shell credential hooks', async () => {
    const result = await read('omp')
    expect(result.servers['OMP-tool'].env).toEqual({ TOKEN: 'omp-fixture-token' })
    expect(result.rows[1].omitted).toContain('app-managed OAuth sign-in')
    expect(result.skipped[0]).toMatchObject({ sourceName: 'helper' })
    expect(JSON.stringify(result.servers)).not.toContain('omp-oauth-not-portable')
  })

  it('Cursor resolves env references and reports workspace variables and URL tokens as unsupported', async () => {
    const result = await read('cursor')
    expect(result.servers.connector.headers.Authorization).toBe('Bearer cursor-fixture-token')
    expect(result.skipped.map(item => item.sourceName)).toEqual(['workspace', 'unsafe-url'])
    expect(JSON.stringify(result.skipped)).not.toContain('cursor-url-token')
  })

  it('earlier Jan exposes only names and masked credential counts to previews, and marks existing names', async () => {
    const result = await read('jan', join(home, 'jan-data'))
    expect(result.servers['Jan-Tool'].env).toEqual({ KEY: 'jan-fixture-token' })
    expect(result.servers.remote.headers).toEqual({ 'X-Token': 'jan-header-token' })
    const summary = summarizeMcp(result, new Set(['Jan-Tool']))
    expect(summary.names).toEqual(['remote'])
    expect(summary.rows).toMatchObject([{ name: 'Jan-Tool', credentials: 1, status: 'already here' }, { name: 'remote', credentials: 1, status: 'ready' }])
    expect(JSON.stringify(summary)).not.toMatch(/fixture-token|header-token|X-Token|example\.com/)
  })
})
