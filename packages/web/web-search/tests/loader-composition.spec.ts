/**
 * Real Loader composition: `jan-web-search` mounted from a cordis.yml row beside the web service
 * and the model-facing web tools, with only the provider endpoints replaced by a loopback stand-in
 * and the Tokamak account by an in-memory service.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Context } from '@janhq/cordis'
import Include from '@janhq/cordis-plugin-include'
import Loader from '@janhq/cordis-plugin-loader'
import type { Agent } from '@janhq/jan-agent'
import { ToolCallId } from '@janhq/jan-llm'
import { createScope } from '@janhq/jan-scope'
import { SessionId } from '@janhq/jan-session'
import { executeToolFixture } from '@janhq/jan-tool-testkit'
import { FakeTokamakAccount } from './fake-account.ts'
import { json, sse, startLoopback, toolText } from './loopback.ts'
import type { Loopback } from './loopback.ts'

// Keep workspace imports in Vitest's source graph even when the config has a package scope.
vi.mock('@janhq/cordis-plugin-loader/src/resolve.ts', () => ({ createResolve: () => undefined }))

const agent = { id: SessionId('web-search-composition') } as Agent

let loopback: Loopback
let ctx: Context | undefined
let root: string | undefined

beforeEach(async () => { loopback = await startLoopback() })
afterEach(async () => {
  await ctx?.fiber.dispose()
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  vi.unstubAllEnvs()
  await loopback.close()
  ctx = undefined
  root = undefined
})

const SELECT_YOU_AND_EXA = ['    searchProvider: you', '    fetchProvider: exa']

async function boot(selection = SELECT_YOU_AND_EXA, providers = '[exa, tavily, searxng, you]'): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'jan-web-search-composition-'))
  await writeFile(join(root, 'package.json'), JSON.stringify({ type: 'module' }))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@janhq/jan-system-prompt'",
    "- name: '@janhq/jan-tools'",
    "- name: '@janhq/jan-tool-executor-native'",
    "- name: '@janhq/jan-web'",
    '  config:',
    ...selection,
    "- name: '@janhq/jan-web-search'",
    '  config:',
    `    providers: ${providers}`,
    '    tokamak:',
    `      apiUrl: ${loopback.base}/tokamak/v1`,
    '    searxng:',
    `      url: ${loopback.base}/searx`,
    '    exa:',
    `      mcpUrl: ${loopback.base}/exa/mcp`,
    `      apiUrl: ${loopback.base}/exa`,
    '      apiKeyEnv: JAN_WEB_SEARCH_COMPOSITION_EXA',
    '    you:',
    `      mcpUrl: ${loopback.base}/you/mcp`,
    `      apiUrl: ${loopback.base}/you`,
    '      apiKeyEnv: JAN_WEB_SEARCH_COMPOSITION_YDC',
    "- name: '@janhq/jan-tool-web'",
    '',
  ].join('\n'))
  const context = ctx = new Context()
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  context.loader.internal = undefined
  await context.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await context.loader.await()
  for (const entry of context.loader.entries()) await entry.fiber?.await()
  expect([...context.loader.entries()].filter(entry => entry.fiber === undefined && !entry.disabled)).toEqual([])
  await context.plugin(Object.assign((inner: Context) => { createScope(inner, agent) }, { inject: ['tools'] }))
  return context
}

let counter = 0
async function callTool(context: Context, name: string, args: Record<string, unknown>): Promise<string> {
  const signal = new AbortController().signal
  const toolSet = await context.tools.resolve({ agent, modelSelection: { provider: 'test', model: 'test' }, signal })
  try {
    const out = await executeToolFixture(context, { agent, toolSet, signal, callId: ToolCallId(`call-${String(++counter)}`), name, arguments: args })
    expect(out.isError).toBe(false)
    return out.content.map(block => (block.type === 'text' ? block.text : '')).join('')
  } finally {
    toolSet.dispose()
  }
}

it('serves web_search through keyed You.com and web_fetch through keyless Exa from cordis.yml', async () => {
  vi.stubEnv('JAN_WEB_SEARCH_COMPOSITION_YDC', 'ydc-key')
  loopback.handler = (request, res) => {
    if (request.path === '/you/v1/search') {
      json(res, { results: { web: [{ url: 'https://jan.example/notes', title: 'Jan release notes', description: 'What changed in Jan.' }] } })
    } else {
      sse(res, toolText('# Notes\nURL: https://jan.example/notes\n\nThe page body.'))
    }
  }
  const context = await boot()
  expect(context.web.listProviders().search.map(provider => provider.id)).toEqual(['exa', 'tavily', 'searxng', 'you'])

  const searched = await callTool(context, 'web_search', { queries: ['jan release notes'] })
  expect(searched).toContain('[Jan release notes](https://jan.example/notes)')
  expect(searched).toContain('What changed in Jan.')
  const fetched = await callTool(context, 'web_fetch', { url: 'https://jan.example/notes' })
  expect(fetched).toContain('The page body.')

  expect(loopback.calls.map(call => call.path)).toEqual(['/you/v1/search', '/exa/mcp'])
  expect(loopback.calls[0]?.headers['x-api-key']).toBe('ydc-key')
  expect(loopback.calls[1]?.headers['x-api-key']).toBeUndefined()
})

it('serves web_search and web_fetch through Tokamak while the account is signed in, else through Exa', async () => {
  loopback.handler = (request, res) => {
    if (request.path === '/tokamak/v1/web_search') json(res, { results: [{ url: 'https://tokamak.example/a', title: 'Tokamak result', snippet: 'From Tokamak.' }] })
    else if (request.path === '/tokamak/v1/web_fetch') json(res, { url: 'https://jan.example/notes', content: 'Tokamak page body.', truncated: false })
    else if (JSON.stringify(request.body).includes('web_fetch_exa')) sse(res, toolText('# Notes\nURL: https://jan.example/notes\n\nExa page body.'))
    else sse(res, toolText('Title: Exa result\nURL: https://exa.example/a\nHighlights:\nFrom Exa.'))
  }
  const context = await boot(['    searchProvider: [tokamak, exa]', '    fetchProvider: [tokamak, exa]'], '[tokamak, exa]')
  expect(await callTool(context, 'web_search', { queries: ['q'] })).toContain('[Exa result](https://exa.example/a)')

  await context.plugin(FakeTokamakAccount)
  const account = context.get('tokamakAccount') as FakeTokamakAccount
  account.issuer = loopback.base
  account.setToken('tk-1')
  await vi.waitFor(() => { expect(context.web.listProviders().search.map(provider => provider.id)).toEqual(['exa', 'tokamak']) })
  await vi.waitFor(async () => { expect(await callTool(context, 'web_search', { queries: ['q'] })).toContain('[Tokamak result](https://tokamak.example/a)') })
  expect(await callTool(context, 'web_fetch', { url: 'https://jan.example/notes' })).toContain('Tokamak page body.')
  expect(loopback.calls.filter(call => call.path.startsWith('/tokamak')).every(call => call.headers.authorization === 'Bearer tk-1')).toBe(true)

  account.setToken(undefined)
  await vi.waitFor(async () => { expect(await callTool(context, 'web_fetch', { url: 'https://jan.example/notes' })).toContain('Exa page body.') })
})
